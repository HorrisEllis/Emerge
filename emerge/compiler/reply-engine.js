'use strict';
/**
 * compiler/reply-engine.js
 * UUID: mod-replyengine-v1-0000-0001
 * Version: 1.0.0
 *
 * EXECUTION SCHEDULER.
 *
 * Decides what runs next. No interpretation — only scheduling.
 * The gap field already did the interpretation.
 * The tier contract already made the execution decision.
 * The reply engine reads both and produces an ordered execution plan.
 *
 * RULE: plan() is pure and deterministic. Same inputs → same plan. Always.
 *
 * FOUR BUCKETS:
 *
 *   run    — ready to execute now, sorted by priority
 *   defer  — has tier decision but blocked by open gaps — spec first
 *   skip   — below T0 threshold, no emission
 *   block  — cycle, missing dep, or critical invariant violation
 *
 * PRIORITY within run bucket:
 *   Primary:   highest readiness first (most complete spec → lowest risk)
 *   Secondary: highest blast radius first (highest leverage — unblocks the most)
 *   Tertiary:  lowest gap count first (fewest unknowns)
 *
 * DEFER vs BLOCK distinction (important):
 *   BLOCK = cannot proceed regardless of what you do to the spec
 *           (cycle, missing dep, critical invariant)
 *   DEFER = can proceed once you fill specific gaps in the spec
 *           (missing contracts, missing error paths, low readiness)
 *   This distinction is what makes the reply engine useful:
 *   deferred nodes have a clear path to becoming runnable.
 *   blocked nodes need structural intervention.
 *
 * SISO PIPELINE:
 *   reply.plan.requested
 *     → BlockGate      → reply.block.done
 *     → SkipGate       → reply.skip.done
 *     → DeferGate      → reply.defer.done
 *     → RunGate        → reply.run.done
 *     → PrioritizeGate → reply.prioritize.done
 *     → AssembleGate   → reply.plan.ready (pending)
 *
 * §1.1  plan() never throws. Always returns an ExecutionPlan.
 * §1.2  Every bucket entry carries a reason string.
 * §1.3  The ExecutionPlan is the only input to execution gates.
 *       Gates do not query the KG or gap field directly.
 */

const { Event, Gate, Stream, StreamLog } = require('../siso');
const { decideTier, BOUNDARIES }         = require('./tier-contract');
const { GAP_TYPE, GAP_REASON }           = require('./gap-field-engine');

// ── Event constants ───────────────────────────────────────────────────────────

const RE = {
  REQUEST:    'reply.plan.requested',
  BLOCK_DONE: 'reply.block.done',
  SKIP_DONE:  'reply.skip.done',
  DEFER_DONE: 'reply.defer.done',
  RUN_DONE:   'reply.run.done',
  PRI_DONE:   'reply.prioritize.done',
  COMPLETE:   'reply.plan.ready',
  ERROR:      'reply.plan.error',
};

// ── Entry factory ─────────────────────────────────────────────────────────────

function entry(node, reason, meta = {}) {
  return {
    id:        node.id,
    name:      node.name,
    kind:      node.kind,
    tier:      decideTier(node).tier,
    readiness: node.generationReadiness ?? 0,
    blast:     node.blastRadius?.length ?? 0,
    reason,
    ...meta,
  };
}

// ── Gate 1: BlockGate ─────────────────────────────────────────────────────────
// BLOCKED + MISSING nodes → block bucket.
// These cannot proceed regardless of spec changes.
// Cycles (genReadiness 0.0) and BLACK nodes only.

class BlockGate extends Gate {
  constructor() { super(RE.REQUEST); }

  transform(event, stream) {
    const { nodes, gapField, violations } = event.data;
    const block   = [];
    const remaining = [];

    // Critical invariant violations → everything is suspect, flag all
    const hasCritical = (violations?.criticalCount ?? 0) > 0;

    for (const node of nodes) {
      const d = decideTier(node);

      if (d.tier === 'MISSING') {
        block.push(entry(node, `referenced but never declared in spec`));
        continue;
      }

      if (d.tier === 'BLOCKED') {
        block.push(entry(node, `genReadiness 0.0 — circular dependency or unresolvable chain`));
        continue;
      }

      // Critical violation on this specific node
      const nodeViolation = violations?.violations?.some(v =>
        v.nodeId === node.id && v.severity === 'critical'
      );
      if (nodeViolation) {
        block.push(entry(node, `critical invariant violation — graph state invalid`));
        continue;
      }

      remaining.push(node);
    }

    stream.emit(new Event(RE.BLOCK_DONE, { ...event.data, block, remaining }));
  }
}

// ── Gate 2: SkipGate ──────────────────────────────────────────────────────────
// SKIP nodes → skip bucket.
// Below T0 minimum — not enough spec to emit anything.
// These are informational: spec them to move them to defer or run.

class SkipGate extends Gate {
  constructor() { super(RE.BLOCK_DONE); }

  transform(event, stream) {
    const { remaining, gapField } = event.data;
    const skip      = [];
    const stillLeft = [];

    for (const node of remaining) {
      const d = decideTier(node);
      if (d.tier === 'SKIP') {
        const gaps    = gapField ? gapField.getByNode(node.id) : [];
        const topGap  = gaps[0];
        skip.push(entry(node,
          `genReadiness ${node.generationReadiness.toFixed(2)} below T0 minimum (${BOUNDARIES.T0_MIN})`,
          { topGap: topGap ? topGap.description.slice(0, 80) : null }
        ));
      } else {
        stillLeft.push(node);
      }
    }

    stream.emit(new Event(RE.SKIP_DONE, { ...event.data, skip, remaining: stillLeft }));
  }
}

// ── Gate 3: DeferGate ─────────────────────────────────────────────────────────
// T0/T1/T2 nodes with open blocking gaps → defer bucket.
// These have a tier decision but a specific gap must be resolved first.
// DEFER ≠ BLOCK: deferred nodes have a clear path to run.

class DeferGate extends Gate {
  constructor() { super(RE.SKIP_DONE); }

  transform(event, stream) {
    const { remaining, gapField } = event.data;
    const defer     = [];
    const stillLeft = [];

    for (const node of remaining) {
      if (!gapField) { stillLeft.push(node); continue; }

      const nodeGaps = gapField.getByNode(node.id);

      // Blocking gaps (cycles already handled in BlockGate — these are spec gaps)
      const blockingGaps = nodeGaps.filter(g =>
        g.type === GAP_TYPE.STRUCTURAL ||
        (g.type === GAP_TYPE.SEMANTIC && g.severity >= 0.6)
      );

      if (blockingGaps.length > 0) {
        defer.push(entry(node,
          `${blockingGaps.length} blocking gap(s) — spec required before emission`,
          {
            gaps:          blockingGaps.slice(0, 3).map(g => ({ type: g.type, description: g.description.slice(0, 80) })),
            tokenCostToFix: blockingGaps.reduce((s, g) => s + g.estimatedTokenCost, 0),
          }
        ));
      } else {
        stillLeft.push(node);
      }
    }

    stream.emit(new Event(RE.DEFER_DONE, { ...event.data, defer, remaining: stillLeft }));
  }
}

// ── Gate 4: RunGate ───────────────────────────────────────────────────────────
// Everything remaining goes into the run bucket.
// These are cleared for emission — T0, T1, or T2 depending on tier.

class RunGate extends Gate {
  constructor() { super(RE.DEFER_DONE); }

  transform(event, stream) {
    const { remaining, gapField } = event.data;
    const run = [];

    for (const node of remaining) {
      const d       = decideTier(node);
      const nodeGaps = gapField ? gapField.getByNode(node.id) : [];

      run.push(entry(node,
        `cleared for ${d.action} (${d.tier})`,
        {
          action:       d.action,
          openGapCount: nodeGaps.length,
          tokenEstimate: nodeGaps.reduce((s, g) => s + g.estimatedTokenCost, 0),
        }
      ));
    }

    stream.emit(new Event(RE.RUN_DONE, { ...event.data, run }));
  }
}

// ── Gate 5: PrioritizeGate ────────────────────────────────────────────────────
// Sort run bucket by priority:
//   1. Highest readiness first (most complete → lowest generation risk)
//   2. Highest blast radius first (unblocks the most downstream nodes)
//   3. Lowest gap count first (fewest unknowns)
// This order ensures foundations are built before what depends on them,
// and high-leverage nodes (large blast radius) are prioritised.

class PrioritizeGate extends Gate {
  constructor() { super(RE.RUN_DONE); }

  transform(event, stream) {
    const { run } = event.data;

    const prioritized = [...run].sort((a, b) => {
      // Primary: readiness descending
      const rDiff = b.readiness - a.readiness;
      if (Math.abs(rDiff) > 0.001) return rDiff;
      // Secondary: blast radius descending
      const bDiff = b.blast - a.blast;
      if (bDiff !== 0) return bDiff;
      // Tertiary: gap count ascending
      return (a.openGapCount ?? 0) - (b.openGapCount ?? 0);
    });

    stream.emit(new Event(RE.PRI_DONE, { ...event.data, run: prioritized }));
  }
}

// ── Gate 6: AssembleGate ──────────────────────────────────────────────────────
// Assembles final ExecutionPlan from all four buckets.

class AssembleGate extends Gate {
  constructor() { super(RE.PRI_DONE); }

  transform(event, stream) {
    const { run, defer, skip, block, gapField } = event.data;

    // T2 nodes in run bucket — the actual generation targets
    const t2Nodes = run.filter(n => n.tier === 'T2');
    const t1Nodes = run.filter(n => n.tier === 'T1');
    const t0Nodes = run.filter(n => n.tier === 'T0');

    const plan = {
      // The four buckets
      run,
      defer,
      skip,
      block,

      // Generation targets by tier
      t2: t2Nodes,
      t1: t1Nodes,
      t0: t0Nodes,

      // Summary counts
      counts: {
        run:   run.length,
        defer: defer.length,
        skip:  skip.length,
        block: block.length,
        total: run.length + defer.length + skip.length + block.length,
      },

      // Execution readiness
      isExecutable:   run.length > 0,
      hasBlockers:    block.length > 0,
      hasDeferrals:   defer.length > 0,
      nextNode:       run[0] ?? null,   // highest priority ready node

      // Token forecast for the run bucket
      runTokenEstimate: run.reduce((s, n) => s + (n.tokenEstimate ?? 0), 0),

      // Query interface
      getByTier:  (tier)   => run.filter(n => n.tier === tier),
      getBlocked: ()       => block,
      getDeferred: ()      => defer,

      // Human-readable summary
      summarize: () => [
        `run: ${run.length} (T2:${t2Nodes.length} T1:${t1Nodes.length} T0:${t0Nodes.length})`,
        `defer: ${defer.length}`,
        `skip: ${skip.length}`,
        `block: ${block.length}`,
        run[0] ? `next: ${run[0].name} [${run[0].tier}]` : 'next: nothing ready',
      ].join(' | '),
    };

    stream.emit(new Event(RE.COMPLETE, { plan }));
  }
}

// ── Pipeline factory ──────────────────────────────────────────────────────────

function createReplyPipeline(logLevel = 'EVENTS') {
  const log    = new StreamLog(logLevel);
  const stream = new Stream({ log });

  stream.register(new BlockGate());
  stream.register(new SkipGate());
  stream.register(new DeferGate());
  stream.register(new RunGate());
  stream.register(new PrioritizeGate());
  stream.register(new AssembleGate());

  return { stream, log };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * plan(tierMap, gapField, graph, violationReport, options) → ExecutionPlan
 *
 * Synchronous. Deterministic. Same inputs → same plan.
 * Never throws — always returns an ExecutionPlan.
 *
 * tierMap         — from decideAll(graph)
 * gapField        — from computeGapField(graph, violations)
 * graph           — KnowledgeGraph
 * violationReport — from check(graph), optional
 */
function plan(tierMap, gapField, graph, violationReport = null, options = {}) {
  if (!tierMap || !graph) {
    return buildEmptyPlan('missing tierMap or graph');
  }

  const { logLevel = 'EVENTS' } = options;

  // Collect all non-event, non-schema nodes from graph
  const allNodes = graph.nodes
    ? [...graph.nodes.values()].filter(n => n.kind === 'module' || n.kind === 'unknown' || n.isBlack)
    : [];

  if (allNodes.length === 0) return buildEmptyPlan('no module nodes in graph');

  const { stream, log } = createReplyPipeline(logLevel);

  try {
    stream.emit(new Event(RE.REQUEST, {
      nodes:      allNodes,
      tierMap,
      gapField,
      violations: violationReport,
    }));
  } catch (e) {
    return buildEmptyPlan(`reply pipeline threw: ${e.message}`);
  }

  const { pending } = stream.sampleHere();
  const complete    = pending.find(e => e.type === RE.COMPLETE);

  if (complete) return { ok: true, ...complete.data.plan, log };

  return buildEmptyPlan('pipeline produced no result');
}

/**
 * selectReadyNodes(graph, tierMap) → KGNode[]
 * Returns nodes with T2/T1/T0 tier decisions and no blocking gaps.
 * Lightweight version of plan() for when you only need the run list.
 */
function selectReadyNodes(graph, tierMap) {
  if (!graph || !tierMap) return [];
  return [
    ...(tierMap.t2 ?? []),
    ...(tierMap.t1 ?? []),
    ...(tierMap.t0 ?? []),
  ].map(x => x.node ?? graph.getNode(x.id)).filter(Boolean);
}

/**
 * prioritize(nodes, gapField) → KGNode[]
 * Apply priority sort to a node list.
 * Same ordering as PrioritizeGate.
 */
function prioritize(nodes, gapField) {
  return [...nodes].sort((a, b) => {
    const rDiff = (b.generationReadiness ?? 0) - (a.generationReadiness ?? 0);
    if (Math.abs(rDiff) > 0.001) return rDiff;
    const bDiff = (b.blastRadius?.length ?? 0) - (a.blastRadius?.length ?? 0);
    if (bDiff !== 0) return bDiff;
    const aGaps = gapField ? (gapField.getByNode(a.id)?.length ?? 0) : 0;
    const bGaps = gapField ? (gapField.getByNode(b.id)?.length ?? 0) : 0;
    return aGaps - bGaps;
  });
}

function buildEmptyPlan(reason = '') {
  return {
    ok:      false,
    reason,
    run:     [], defer: [], skip: [], block: [],
    t2: [], t1: [], t0: [],
    counts:  { run: 0, defer: 0, skip: 0, block: 0, total: 0 },
    isExecutable:    false,
    hasBlockers:     false,
    hasDeferrals:    false,
    nextNode:        null,
    runTokenEstimate:0,
    getByTier:  () => [],
    getBlocked: () => [],
    getDeferred:() => [],
    summarize:  () => `empty: ${reason}`,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  plan,
  selectReadyNodes,
  prioritize,
  createReplyPipeline,
  buildEmptyPlan,
  RE,
  REPLY_ENGINE_VERSION: require('../version').REPLY,
};
