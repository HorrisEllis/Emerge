'use strict';
/**
 * compiler/gap-field-engine.js
 * UUID: mod-gapfield-v1-0000-0001
 * Version: 1.0.0
 *
 * SEMANTIC DELTA LAYER.
 *
 * Converts invariant violations + KG state into structured semantic gaps.
 * Gaps are derived, never directly authored.
 *
 * SOURCE THEORY (from GapHunter v3.1 — gutted and rebuilt for the compiler):
 *
 *   A gap is not a point event. It is a field property.
 *   Every node has a gap field with four axes:
 *
 *     EXPRESSED    — what the spec declares (exports, gates, contracts)
 *     INFERRED     — what must be true given what's declared
 *     OMITTED      — what should be there but isn't
 *     UNCERTAINTY  — how much the omission costs (= estimated token cost)
 *
 *   Gap pressure = omissions matter × uncertainty weight
 *   This IS the token cost estimate: tokens ∝ unresolved gap pressure
 *
 * NINE REASONS GAPS EXIST (from GapHunter taxonomy):
 *   COMPRESSION       — spec has structure but omits detail
 *   AVOIDANCE         — field exists but wasn't spec'd deliberately
 *   COMPATIBILITY     — dep interface mismatch
 *   ATTENTION         — simply not spec'd yet
 *   BLOCKING          — cycle or invariant failure makes it unreachable
 *   ORPHANED          — referenced but never declared
 *   PROPAGATION       — weak dep poisons downstream readiness
 *   BEHAVIORAL        — behavioral contracts missing
 *   STRUCTURAL        — graph structure broken
 *
 * GAP TYPES:
 *   structural  — missing nodes, broken edges, identity violations
 *   semantic    — spec exists but underdeclared (missing gates/contracts)
 *   behavioral  — behavioral contracts or error paths absent
 *   execution   — blocked build paths, cycles, SKIP nodes
 *
 * SISO PIPELINE:
 *   gap.field.build.requested
 *     → StructuralGapsGate   → gap.structural.done
 *     → SemanticGapsGate     → gap.semantic.done
 *     → BehavioralGapsGate   → gap.behavioral.done
 *     → ExecutionGapsGate    → gap.execution.done
 *     → PropagationGapsGate  → gap.propagation.done
 *     → CostModelGate        → gap.costs.done
 *     → AssembleFieldGate    → gap.field.complete (pending)
 *
 * FEEDS:
 *   → reply-engine  (gap severity drives scheduling decisions)
 *   → ring-buffer   (gap events → causal history)
 *   → tier-contract (blocking gaps prevent T2 dispatch)
 *
 * §1.1  Gaps are signals, not diagnoses.
 * §1.2  Nothing silently fails — every gap has a typed reason.
 * §1.3  Gaps are derived only. Never authored directly.
 */

const { Event, Gate, Stream, StreamLog } = require('../siso');
const { BOUNDARIES } = require('./tier-contract');

// ── Event constants ───────────────────────────────────────────────────────────

const GF = {
  BUILD:       'gap.field.build.requested',
  STRUCTURAL:  'gap.structural.done',
  SEMANTIC:    'gap.semantic.done',
  BEHAVIORAL:  'gap.behavioral.done',
  EXECUTION:   'gap.execution.done',
  PROPAGATION: 'gap.propagation.done',
  SCHEMA:      'gap.schema.done',
  COSTS:       'gap.costs.done',
  COMPLETE:    'gap.field.complete',
  ERROR:       'gap.field.error',
};

// ── Gap types and reasons (from GapHunter taxonomy) ───────────────────────────

const GAP_TYPE = Object.freeze({
  STRUCTURAL:  'structural',   // missing nodes, broken edges, identity violations
  SEMANTIC:    'semantic',     // underdeclared spec (exports/gates missing)
  BEHAVIORAL:  'behavioral',   // behavioral contracts or error paths absent
  EXECUTION:   'execution',    // blocked paths, cycles, SKIP decisions
  PROPAGATION: 'propagation',  // weak dep constraining downstream readiness
});

const GAP_REASON = Object.freeze({
  COMPRESSION:  'compression',  // structure present but detail omitted
  AVOIDANCE:    'avoidance',    // deliberately not spec'd
  ATTENTION:    'attention',    // simply not spec'd yet
  BLOCKING:     'blocking',     // cycle or critical invariant failure
  ORPHANED:     'orphaned',     // referenced but never declared
  PROPAGATION:  'propagation',  // weak dep poisoning downstream
  BEHAVIORAL:   'behavioral',   // contracts/error paths missing
  STRUCTURAL:   'structural',   // graph structure broken
  COMPATIBILITY:'compatibility',// dep interface mismatch
});

// Token cost base rates (calibrated against observed chunk sizes)
// Each gap type has a base cost in tokens that scales with severity and blast radius.
const BASE_TOKEN_COST = Object.freeze({
  [GAP_TYPE.STRUCTURAL]:  150,  // missing node = LLM must invent from scratch
  [GAP_TYPE.SEMANTIC]:     80,  // underdeclared = LLM must fill spec gaps
  [GAP_TYPE.BEHAVIORAL]:   60,  // missing contracts = LLM must infer intent
  [GAP_TYPE.EXECUTION]:    40,  // blocked = no generation, but resolution costs
  [GAP_TYPE.PROPAGATION]:  30,  // propagation = multiplied across blast radius
});

// ── Gap factory ───────────────────────────────────────────────────────────────

let _gapSeq = 0;
function makeGap(nodeId, type, reason, severity, description, blockers = [], blastRadius = 0, expressed = null) {
  // Gap pressure formula (from GapHunter field model):
  // pressure = omitWeight * 0.55 + inferWeight * 0.25 + uncertainty * 0.20
  // We approximate: severity IS the omitWeight, blast radius contributes inferWeight
  const omitWeight  = severity;
  const inferWeight = Math.min(1, blastRadius * 0.1);
  const uncertainty = severity * (1 - Math.min(1, (expressed?.length ?? 0) / 10));
  const pressure    = Math.min(1, omitWeight * 0.55 + inferWeight * 0.25 + uncertainty * 0.20);

  const baseCost = BASE_TOKEN_COST[type] ?? 60;
  const estimatedTokenCost = Math.ceil(baseCost * pressure * (1 + blastRadius * 0.1));

  return {
    gapId:              `gap-${type.slice(0,3)}-${++_gapSeq}-${Date.now()}`,
    nodeId,
    type,
    reason,
    severity:           Math.min(1, severity),
    pressure,           // gap field pressure (composite)
    description,
    blockers,           // node ids blocked by this gap
    blastRadius,        // downstream impact count
    expressed,          // what IS declared (the EXPRESSED axis)
    estimatedTokenCost,
  };
}

// ── Gate 1: StructuralGapsGate ────────────────────────────────────────────────
// Converts invariant violations + BLACK nodes into structural gaps.
// These are the highest-cost gaps — missing structure = LLM invents from scratch.

class StructuralGapsGate extends Gate {
  constructor() { super(GF.BUILD); }

  transform(event, stream) {
    const { graph, violations } = event.data;
    const gaps = [];

    // INV-001/002/003 violations → structural gap (identity or edge broken)
    for (const v of (violations ?? [])) {
      if (['INV-001','INV-002','INV-003'].includes(v.invariantId)) {
        const nodeId = v.nodeId ?? 'graph';
        const blast  = nodeId !== 'graph' ? (graph.getBlastRadius?.(nodeId)?.length ?? 0) : 0;
        gaps.push(makeGap(
          nodeId, GAP_TYPE.STRUCTURAL, GAP_REASON.STRUCTURAL,
          v.severity === 'critical' ? 0.9 : 0.6,
          `Invariant ${v.invariantId}: ${v.message}`,
          [], blast
        ));
      }
    }

    // BLACK nodes → structural gap (referenced but undeclared)
    for (const node of (graph.getBlackNodes?.() ?? [])) {
      const blast = graph.getBlastRadius?.(node.id)?.length ?? 0;
      gaps.push(makeGap(
        node.id, GAP_TYPE.STRUCTURAL, GAP_REASON.ORPHANED,
        0.85,
        `'${node.name}' is referenced but never declared in spec`,
        graph.getBlastRadius?.(node.id)?.map(n => n.id) ?? [],
        blast
      ));
    }

    stream.emit(new Event(GF.STRUCTURAL, { ...event.data, gaps }));
  }
}


// ── Gate 1b: SchemaCompletenessGate ──────────────────────────────────────────
// Fires for schema nodes with missing or sparse field declarations.
// A schema with no fields is a named hole — it will produce undefined types at T2.
// Inserted after StructuralGapsGate so structural (BLACK) gaps are already known.

class SchemaCompletenessGate extends Gate {
  constructor() { super(GF.STRUCTURAL); }

  transform(event, stream) {
    const { graph, gaps } = event.data;
    const newGaps = [...gaps];
    const nodes = graph.nodes ? [...graph.nodes.values()] : [];

    for (const node of nodes) {
      if (node.isBlack || node.kind !== 'schema') continue;
      const raw        = node._raw ?? {};
      const fieldCount = Object.keys(raw.fields ?? {}).length;
      const blast      = node.blastRadius?.length ?? 0;

      if (fieldCount === 0) {
        newGaps.push(makeGap(
          node.id, GAP_TYPE.STRUCTURAL, GAP_REASON.ATTENTION,
          0.8,
          `Schema '${node.name}' has no fields declared — T2 will emit an empty interface`,
          node.blastRadius?.map(n => n.id) ?? [],
          blast,
          'fields:0'
        ));
      } else if (fieldCount < 3) {
        newGaps.push(makeGap(
          node.id, GAP_TYPE.SEMANTIC, GAP_REASON.COMPRESSION,
          0.5,
          `Schema '${node.name}' has only ${fieldCount} field(s) — likely underspecified`,
          [], blast,
          `fields:${fieldCount}`
        ));
      } else if (node.specDepth < 1.0) {
        // AMBER schema: fields declared but below FULL depth (< 8 fields)
        // Gap is advisory — spec more fields or confirm schema is intentionally small
        newGaps.push(makeGap(
          node.id, GAP_TYPE.SEMANTIC, GAP_REASON.COMPRESSION,
          0.3,
          `Schema '${node.name}' has ${fieldCount} fields (specDepth ${node.specDepth.toFixed(2)}) — may be incomplete`,
          [], blast,
          `fields:${fieldCount},specDepth:${node.specDepth.toFixed(2)}`
        ));
      }
    }

    stream.emit(new Event(GF.SCHEMA, { ...event.data, gaps: newGaps }));
  }
}

// ── Gate 2: SemanticGapsGate ──────────────────────────────────────────────────
// Nodes with low specDepth — declared but underdeclared.
// The OMITTED axis: what should be there but isn't.

class SemanticGapsGate extends Gate {
  constructor() { super(GF.SCHEMA); }

  transform(event, stream) {
    const { graph, gaps } = event.data;
    const newGaps = [...gaps];
    const nodes = graph.nodes ? [...graph.nodes.values()] : [];

    for (const node of nodes) {
      if (node.isBlack || node.kind === 'event' || node.kind === 'schema') continue;
      const spec   = node.specDepth ?? 0;
      const blast  = node.blastRadius?.length ?? 0;

      // Missing exports — can't generate interface without them
      if ((node.exports?.length ?? 0) === 0 && node.kind === 'module') {
        newGaps.push(makeGap(
          node.id, GAP_TYPE.SEMANTIC, GAP_REASON.ATTENTION,
          0.7,
          `No exports declared — T1 interface cannot be generated`,
          node.blastRadius?.map(n => n.id) ?? [],
          blast,
          `specDepth:${spec.toFixed(2)}`
        ));
      }

      // Missing gate_pipeline — can't generate SISO scaffold
      if ((node.gatePipeline?.length ?? 0) === 0 && node.kind === 'module' && (node.exports?.length ?? 0) > 0) {
        newGaps.push(makeGap(
          node.id, GAP_TYPE.SEMANTIC, GAP_REASON.COMPRESSION,
          0.5,
          `No gate_pipeline declared — SISO wiring cannot be scaffolded`,
          [], blast,
          `exports:${node.exports?.length ?? 0}`
        ));
      }
    }

    stream.emit(new Event(GF.SEMANTIC, { ...event.data, gaps: newGaps }));
  }
}

// ── Gate 3: BehavioralGapsGate ────────────────────────────────────────────────
// Missing behavioral contracts or error paths.
// These are cheaper to fill than structural gaps but create test-blind spots.

class BehavioralGapsGate extends Gate {
  constructor() { super(GF.SEMANTIC); }

  transform(event, stream) {
    const { graph, gaps } = event.data;
    const newGaps = [...gaps];
    const nodes = graph.nodes ? [...graph.nodes.values()] : [];

    for (const node of nodes) {
      if (node.isBlack || node.kind !== 'module') continue;
      const blast = node.blastRadius?.length ?? 0;
      const hasExports = (node.exports?.length ?? 0) > 0;
      if (!hasExports) continue; // semantic gap already covers this

      const contracts  = node.behavioralContracts?.length ?? 0;
      const errorPaths = node.errorPaths?.length          ?? 0;

      if (contracts === 0) {
        newGaps.push(makeGap(
          node.id, GAP_TYPE.BEHAVIORAL, GAP_REASON.BEHAVIORAL,
          0.45,
          `No behavioral_contracts — test scaffold will be empty, LLM must infer intent`,
          [], blast,
          `gates:${node.gatePipeline?.length ?? 0}`
        ));
      }

      if (errorPaths === 0 && contracts > 0) {
        newGaps.push(makeGap(
          node.id, GAP_TYPE.BEHAVIORAL, GAP_REASON.ATTENTION,
          0.35,
          `No error_paths — failure modes unspecified, LLM must guess`,
          [], blast,
          `contracts:${contracts}`
        ));
      }
    }

    stream.emit(new Event(GF.BEHAVIORAL, { ...event.data, gaps: newGaps }));
  }
}

// ── Gate 4: ExecutionGapsGate ─────────────────────────────────────────────────
// SKIP and BLOCKED nodes — nodes the tier contract won't generate.
// These are gaps in the execution plan, not the spec.

class ExecutionGapsGate extends Gate {
  constructor() { super(GF.BEHAVIORAL); }

  transform(event, stream) {
    const { graph, gaps, violations } = event.data;
    const newGaps = [...gaps];
    const { decideTier } = require('./tier-contract');
    const nodes = graph.nodes ? [...graph.nodes.values()] : [];

    for (const node of nodes) {
      if (node.isBlack) continue; // already covered by structural gaps
      if (node.kind === 'event' || node.kind === 'schema' || node.kind === 'interface') continue;
      const decision = decideTier(node);
      const blast    = node.blastRadius?.length ?? 0;

      if (decision.tier === 'BLOCKED') {
        newGaps.push(makeGap(
          node.id, GAP_TYPE.EXECUTION, GAP_REASON.BLOCKING,
          0.8,
          `Circular dependency — genReadiness 0.0, no valid build path`,
          node.blastRadius?.map(n => n.id) ?? [],
          blast
        ));
      } else if (decision.tier === 'SKIP') {
        newGaps.push(makeGap(
          node.id, GAP_TYPE.EXECUTION, GAP_REASON.ATTENTION,
          0.3,
          `Below T0 threshold (${node.generationReadiness?.toFixed(2)} < ${BOUNDARIES.T0_MIN}) — no emission`,
          [], blast
        ));
      }
    }

    // INV-007 build order violation → execution gap
    for (const v of (violations ?? [])) {
      if (v.invariantId === 'INV-007') {
        newGaps.push(makeGap(
          v.nodeId ?? 'graph', GAP_TYPE.EXECUTION, GAP_REASON.STRUCTURAL,
          0.75,
          `Build order violation: ${v.message}`,
          [], 0
        ));
      }
    }

    stream.emit(new Event(GF.EXECUTION, { ...event.data, gaps: newGaps }));
  }
}

// ── Gate 5: PropagationGapsGate ───────────────────────────────────────────────
// Nodes constrained by weak deps — the chain is only as strong as its weakest link.
// These gaps explain WHY downstream nodes have low readiness.

class PropagationGapsGate extends Gate {
  constructor() { super(GF.EXECUTION); }

  transform(event, stream) {
    const { graph, gaps } = event.data;
    const newGaps = [...gaps];
    const nodes   = graph.nodes ? [...graph.nodes.values()] : [];
    const edges   = graph.edges ?? [];

    for (const node of nodes) {
      if (node.isBlack || node.kind !== 'module') continue;
      const r = node.generationReadiness ?? 0;
      if (r >= BOUNDARIES.T1_MIN) continue; // only flag constrained nodes

      // Find the weakest dep causing the constraint
      const depEdges = edges.filter(e => e.from === node.id && e.kind === 'depends_on');
      let weakestDep = null, weakestR = 1.0;

      for (const edge of depEdges) {
        const dep = graph.nodes.get(edge.to);
        if (dep && (dep.generationReadiness ?? 0) < weakestR) {
          weakestR  = dep.generationReadiness ?? 0;
          weakestDep = dep;
        }
      }

      if (weakestDep && weakestR < r + 0.01) {
        // This node's readiness is being constrained by a dep
        const blast = node.blastRadius?.length ?? 0;
        newGaps.push(makeGap(
          node.id, GAP_TYPE.PROPAGATION, GAP_REASON.PROPAGATION,
          Math.min(0.7, 1 - weakestR),
          `genReadiness constrained to ${r.toFixed(2)} by dep '${weakestDep.name}' (${weakestR.toFixed(2)})`,
          node.blastRadius?.map(n => n.id) ?? [],
          blast,
          `weakest_dep:${weakestDep.name}:${weakestR.toFixed(2)}`
        ));
      }
    }

    stream.emit(new Event(GF.PROPAGATION, { ...event.data, gaps: newGaps }));
  }
}

// ── Gate 6: CostModelGate ─────────────────────────────────────────────────────
// Computes totalGapWeight and token budget forecast.
// totalGapWeight = Σ(gap.pressure × blast_factor) — the system's ambiguity load.
// This IS the token budget proxy: tokens ∝ totalGapWeight.

class CostModelGate extends Gate {
  constructor() { super(GF.PROPAGATION); }

  transform(event, stream) {
    const { gaps } = event.data;

    // Deduplicate gaps by nodeId+type — keep highest severity
    const deduped = new Map();
    for (const g of gaps) {
      const key = `${g.nodeId}::${g.type}`;
      const existing = deduped.get(key);
      if (!existing || g.severity > existing.severity) deduped.set(key, g);
    }
    const uniqueGaps = [...deduped.values()];

    // totalGapWeight: gap pressure weighted by blast radius
    // From GapHunter field theory: uncertainty weight IS the generative potential
    let totalGapWeight    = 0;
    let totalTokenCost    = 0;

    for (const g of uniqueGaps) {
      const blastFactor = 1 + g.blastRadius * 0.15;
      totalGapWeight   += g.pressure * blastFactor;
      totalTokenCost   += g.estimatedTokenCost;
    }

    totalGapWeight = Math.round(totalGapWeight * 1000) / 1000;

    // Risk factors for the forecast
    const riskFactors = [];
    const critGaps    = uniqueGaps.filter(g => g.severity >= 0.8);
    const blockGaps   = uniqueGaps.filter(g => g.type === GAP_TYPE.EXECUTION && g.reason === GAP_REASON.BLOCKING);
    const orphGaps    = uniqueGaps.filter(g => g.reason === GAP_REASON.ORPHANED);

    if (critGaps.length)  riskFactors.push(`${critGaps.length} critical severity gaps`);
    if (blockGaps.length) riskFactors.push(`${blockGaps.length} cycle/blocked nodes`);
    if (orphGaps.length)  riskFactors.push(`${orphGaps.length} orphaned references`);

    // Confidence: high if gaps are mostly behavioral (LLM can fill), low if structural
    const structuralFraction = uniqueGaps.filter(g => g.type === GAP_TYPE.STRUCTURAL).length / Math.max(1, uniqueGaps.length);
    const confidence         = Math.round((1 - structuralFraction * 0.6) * 100) / 100;

    const tokenBudgetForecast = {
      estimatedTokens: totalTokenCost,
      confidence,
      riskFactors,
      breakdown: {
        [GAP_TYPE.STRUCTURAL]:  uniqueGaps.filter(g => g.type === GAP_TYPE.STRUCTURAL).reduce((s,g)=>s+g.estimatedTokenCost,0),
        [GAP_TYPE.SEMANTIC]:    uniqueGaps.filter(g => g.type === GAP_TYPE.SEMANTIC).reduce((s,g)=>s+g.estimatedTokenCost,0),
        [GAP_TYPE.BEHAVIORAL]:  uniqueGaps.filter(g => g.type === GAP_TYPE.BEHAVIORAL).reduce((s,g)=>s+g.estimatedTokenCost,0),
        [GAP_TYPE.EXECUTION]:   uniqueGaps.filter(g => g.type === GAP_TYPE.EXECUTION).reduce((s,g)=>s+g.estimatedTokenCost,0),
        [GAP_TYPE.PROPAGATION]: uniqueGaps.filter(g => g.type === GAP_TYPE.PROPAGATION).reduce((s,g)=>s+g.estimatedTokenCost,0),
      },
    };

    stream.emit(new Event(GF.COSTS, {
      ...event.data,
      gaps:                uniqueGaps,
      totalGapWeight,
      totalTokenCost,
      tokenBudgetForecast,
    }));
  }
}

// ── Gate 7: AssembleFieldGate ─────────────────────────────────────────────────
// Packages everything into the final GapField object.

class AssembleFieldGate extends Gate {
  constructor() { super(GF.COSTS); }

  transform(event, stream) {
    const { gaps, totalGapWeight, totalTokenCost, tokenBudgetForecast, graph } = event.data;

    // Index gaps by type for fast lookup
    const gapsByType = {};
    for (const type of Object.values(GAP_TYPE)) {
      gapsByType[type] = gaps.filter(g => g.type === type);
    }

    // Sort all gaps by severity × blast (most impactful first)
    const sorted = [...gaps].sort((a, b) => {
      const scoreA = a.severity * (1 + a.blastRadius * 0.1);
      const scoreB = b.severity * (1 + b.blastRadius * 0.1);
      return scoreB - scoreA;
    });

    const field = {
      gaps:               sorted,
      gapsByType,
      totalGapWeight,
      totalTokenCost,
      tokenBudgetForecast,
      gapCount:           sorted.length,
      blockingGaps:       sorted.filter(g => g.type === GAP_TYPE.EXECUTION && g.reason === GAP_REASON.BLOCKING),
      criticalGaps:       sorted.filter(g => g.severity >= 0.8),
      computedAt:         Date.now(),
      nodeCount:          graph.meta?.nodeCount ?? 0,

      // Query interface
      getByNode: (nodeId)  => sorted.filter(g => g.nodeId === nodeId),
      getByType: (type)    => gapsByType[type] ?? [],
      getBlocking: ()      => sorted.filter(g => g.type === GAP_TYPE.EXECUTION && g.reason === GAP_REASON.BLOCKING),
      hasBlockingGaps: ()  => sorted.some(g => g.type === GAP_TYPE.EXECUTION && g.reason === GAP_REASON.BLOCKING),
      topN: (n = 5)        => sorted.slice(0, n),
      summarize: ()        => [
        `gaps: ${sorted.length} | weight: ${totalGapWeight.toFixed(3)} | ~${totalTokenCost} tokens`,
        `structural: ${gapsByType[GAP_TYPE.STRUCTURAL]?.length ?? 0}`,
        `semantic: ${gapsByType[GAP_TYPE.SEMANTIC]?.length ?? 0}`,
        `behavioral: ${gapsByType[GAP_TYPE.BEHAVIORAL]?.length ?? 0}`,
        `execution: ${gapsByType[GAP_TYPE.EXECUTION]?.length ?? 0}`,
        `propagation: ${gapsByType[GAP_TYPE.PROPAGATION]?.length ?? 0}`,
      ].join(' | '),
    };

    stream.emit(new Event(GF.COMPLETE, { field }));
  }
}

// ── Pipeline factory ──────────────────────────────────────────────────────────

function createGapFieldPipeline(logLevel = 'EVENTS') {
  const log    = new StreamLog(logLevel);
  const stream = new Stream({ log });

  stream.register(new StructuralGapsGate());
  stream.register(new SchemaCompletenessGate());
  stream.register(new SemanticGapsGate());
  stream.register(new BehavioralGapsGate());
  stream.register(new ExecutionGapsGate());
  stream.register(new PropagationGapsGate());
  stream.register(new CostModelGate());
  stream.register(new AssembleFieldGate());

  return { stream, log };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * computeGapField(graph, violationReport, options) → GapField
 *
 * Synchronous. Runs all 7 gates over the graph state.
 * Always returns a GapField — never throws.
 *
 * violationReport is optional — pass null if invariants engine not run yet.
 */
function computeGapField(graph, violationReport = null, options = {}) {
  if (!graph) {
    const empty = buildEmptyField('graph is null');
    return { ok: false, field: empty, error: 'graph is null' };
  }

  const violations = violationReport?.violations ?? [];
  const { logLevel = 'EVENTS' } = options;
  const { stream, log } = createGapFieldPipeline(logLevel);

  try {
    stream.emit(new Event(GF.BUILD, { graph, violations }));
  } catch (e) {
    const empty = buildEmptyField(e.message);
    return { ok: false, field: empty, error: e.message };
  }

  const { pending } = stream.sampleHere();
  const complete    = pending.find(e => e.type === GF.COMPLETE);

  if (complete) return { ok: true, field: complete.data.field, log };

  const empty = buildEmptyField('gap field pipeline produced no result');
  return { ok: false, field: empty, error: 'no result' };
}

function buildEmptyField(reason = '') {
  const emptyType = {};
  for (const t of Object.values(GAP_TYPE)) emptyType[t] = [];
  return {
    gaps: [], gapsByType: emptyType, totalGapWeight: 0, totalTokenCost: 0,
    gapCount: 0, blockingGaps: [], criticalGaps: [],
    tokenBudgetForecast: { estimatedTokens: 0, confidence: 1, riskFactors: [reason], breakdown: {} },
    computedAt: Date.now(), nodeCount: 0,
    getByNode: () => [], getByType: () => [], getBlocking: () => [],
    hasBlockingGaps: () => false, topN: () => [], summarize: () => `empty: ${reason}`,
  };
}

/**
 * estimateTokenCost(gapField) → TokenBudgetForecast
 * Convenience accessor — returns the forecast from a computed field.
 */
function estimateTokenCost(gapField) {
  return gapField?.tokenBudgetForecast ?? { estimatedTokens: 0, confidence: 1, riskFactors: [] };
}

/**
 * getGapsByType(gapField, type) → Gap[]
 */
function getGapsByType(gapField, type) {
  return gapField?.gapsByType?.[type] ?? [];
}

/**
 * getBlockingGaps(gapField) → Gap[]
 */
function getBlockingGaps(gapField) {
  return gapField?.blockingGaps ?? [];
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  computeGapField,
  estimateTokenCost,
  getGapsByType,
  getBlockingGaps,
  createGapFieldPipeline,
  buildEmptyField,
  GAP_TYPE,
  GAP_REASON,
  BASE_TOKEN_COST,
  GF,
  GAP_FIELD_VERSION: require('../version').GAP_FIELD,
};
