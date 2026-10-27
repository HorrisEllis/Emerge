'use strict';
/**
 * compiler/tier-contract.js
 * UUID: spec-compiler-tier-contract-v1-0000-0001
 * Version: 1.0.0
 *
 * THE EXECUTION SEMANTICS OF THE COMPILER.
 *
 * This file is the semantic boundary between analysis and execution.
 * Everything before this point is about graph correctness.
 * This file defines what graph correctness MEANS in terms of action.
 *
 * RULE: No gate, emitter, or pipeline stage may hardcode a readiness
 * threshold. All tier decisions must flow through decideTier().
 *
 * EVOLUTION: adding a new signal (schema completeness, verification
 * status, confidence weighting) means updating TIER_CONTRACT and
 * decideTier() here — and nowhere else.
 *
 * CONTRACT TABLE:
 *
 *   genReadiness >= 0.8  → T2  IMPLEMENT  — full implementation, LLM required
 *   genReadiness >= 0.5  → T1  SCAFFOLD   — typed stubs, gate shapes, test blocks
 *   genReadiness >= 0.3  → T0  STRUCTURE  — directory tree, empty files, barrels
 *   genReadiness <  0.3  → SKIP           — insufficient spec depth, log gap
 *   genReadiness == 0.0  → BLOCKED        — cycle, no resolvable base case
 *   confidence == BLACK  → MISSING        — referenced but never declared
 *
 * §CC-001  Cortex is queried before decideTier() is called.
 * §CC-002  T0 and T1 emit zero LLM tokens. T2 dispatches to LLM.
 * §1.2     Every SKIP, BLOCKED, and MISSING produces a gap record.
 */

// ── Contract table ────────────────────────────────────────────────────────────
// These are the ONLY places these thresholds are declared.
// Read them. Do not duplicate them.

const TIER_CONTRACT = {
  T2: {
    minReadiness: 0.8,
    action:       'IMPLEMENT',
    label:        'full implementation',
    requiresLLM:  true,
    emits:        ['gate logic', 'validation chains', 'error path implementations', 'passing tests'],
  },
  T1: {
    minReadiness: 0.5,
    action:       'SCAFFOLD',
    label:        'scaffold',
    requiresLLM:  false,
    emits:        ['typed interfaces', 'gate stubs', 'SISO wiring', 'test describe blocks'],
  },
  T0: {
    minReadiness: 0.3,
    action:       'STRUCTURE',
    label:        'structure',
    requiresLLM:  false,
    emits:        ['directory tree', 'empty files', 'barrel exports', 'tsconfig', 'package.json'],
  },
  SKIP: {
    maxReadiness: 0.3,
    action:       'SKIP',
    label:        'skipped — insufficient spec depth',
    requiresLLM:  false,
    emits:        ['gap record'],
    gapType:      'insufficient_spec_depth',
    gapSeverity:  'low',
  },
  BLOCKED: {
    readiness:    0.0,
    action:       'BLOCK',
    label:        'blocked — cycle, no resolvable base case',
    requiresLLM:  false,
    emits:        ['gap record'],
    gapType:      'circular_dependency',
    gapSeverity:  'high',
  },
  MISSING: {
    confidence:   'BLACK',
    action:       'MISSING',
    label:        'missing — referenced but never declared',
    requiresLLM:  false,
    emits:        ['gap record'],
    gapType:      'orphaned_reference',
    gapSeverity:  'high',
  },
};

// ── Boundary values ───────────────────────────────────────────────────────────
// Named constants for boundary conditions.
// Use these in tests — never write 0.3, 0.5, 0.8 directly.

const BOUNDARIES = {
  T2_MIN:   TIER_CONTRACT.T2.minReadiness,   // 0.8
  T1_MIN:   TIER_CONTRACT.T1.minReadiness,   // 0.5
  T0_MIN:   TIER_CONTRACT.T0.minReadiness,   // 0.3
  SKIP_MAX: TIER_CONTRACT.SKIP.maxReadiness,  // 0.3
  CYCLE:    TIER_CONTRACT.BLOCKED.readiness,  // 0.0
};

// ── decideTier(node) — the single evaluator ───────────────────────────────────
/**
 * decideTier(node) → TierDecision
 *
 * Takes a KGNode (or any object with .confidence and .generationReadiness).
 * Returns a TierDecision: { tier, action, label, requiresLLM, emits, reason, ... }
 *
 * Priority order (checked top to bottom):
 *   1. BLACK confidence  → MISSING   (referenced but undeclared)
 *   2. genReadiness 0.0  → BLOCKED   (cycle or unresolvable chain)
 *   3. genReadiness >= T2_MIN → T2   (implement)
 *   4. genReadiness >= T1_MIN → T1   (scaffold)
 *   5. genReadiness >= T0_MIN → T0   (structure)
 *   6. otherwise         → SKIP      (insufficient depth)
 *
 * The reason field explains the decision in human-readable terms.
 * Gates should log reason on SKIP/BLOCKED/MISSING decisions.
 */
function decideTier(node) {
  const r = node.generationReadiness ?? 0.0;
  const c = node.confidence ?? 'RED';

  // 1. BLACK — referenced but never declared
  if (c === 'BLACK') {
    return {
      tier:        'MISSING',
      ...TIER_CONTRACT.MISSING,
      reason:      `'${node.name ?? node.id}' is referenced but never declared in spec`,
      nodeId:      node.id ?? node.name,
      readiness:   r,
    };
  }

  // 2. Cycle / unresolvable chain → BLOCKED
  // genReadiness of exactly 0.0 on a non-BLACK node means:
  //   - self-loop (A depends on A)
  //   - cycle (A→B→C→A collapses all to 0.0)
  //   - chain bottomed out by an unresolvable dep
  if (r === 0.0) {
    return {
      tier:        'BLOCKED',
      ...TIER_CONTRACT.BLOCKED,
      reason:      `genReadiness is 0.0 — circular dependency or unresolvable chain`,
      nodeId:      node.id ?? node.name,
      readiness:   r,
    };
  }

  // 3–5. Readiness thresholds
  if (r >= BOUNDARIES.T2_MIN) {
    return {
      tier:      'T2',
      ...TIER_CONTRACT.T2,
      reason:    `genReadiness ${r.toFixed(3)} >= ${BOUNDARIES.T2_MIN} (T2 threshold)`,
      nodeId:    node.id ?? node.name,
      readiness: r,
    };
  }

  if (r >= BOUNDARIES.T1_MIN) {
    return {
      tier:      'T1',
      ...TIER_CONTRACT.T1,
      reason:    `genReadiness ${r.toFixed(3)} >= ${BOUNDARIES.T1_MIN} (T1 threshold)`,
      nodeId:    node.id ?? node.name,
      readiness: r,
    };
  }

  if (r >= BOUNDARIES.T0_MIN) {
    return {
      tier:      'T0',
      ...TIER_CONTRACT.T0,
      reason:    `genReadiness ${r.toFixed(3)} >= ${BOUNDARIES.T0_MIN} (T0 threshold)`,
      nodeId:    node.id ?? node.name,
      readiness: r,
    };
  }

  // 6. Below T0 minimum → SKIP
  return {
    tier:        'SKIP',
    ...TIER_CONTRACT.SKIP,
    reason:      `genReadiness ${r.toFixed(3)} < ${BOUNDARIES.T0_MIN} (T0 threshold)`,
    nodeId:      node.id ?? node.name,
    readiness:   r,
  };
}

// ── decideTierForSpec(specDepth) — pre-KG variant ─────────────────────────────
/**
 * decideTierForSpec(specDepth)
 *
 * For cases where only specDepth is available (no full KG yet).
 * Used in T0/T1 emit when the KG hasn't been built yet.
 * Uses the same thresholds as decideTier().
 */
function decideTierForSpec(specDepth) {
  return decideTier({ generationReadiness: specDepth, confidence: 'RED' });
}

// ── Gate decision helpers ─────────────────────────────────────────────────────

/** Returns true if this node should have T0 structure emitted. */
function shouldEmitT0(node) {
  const d = decideTier(node);
  return d.tier === 'T0' || d.tier === 'T1' || d.tier === 'T2';
}

/** Returns true if this node should have T1 scaffold emitted. */
function shouldEmitT1(node) {
  const d = decideTier(node);
  return d.tier === 'T1' || d.tier === 'T2';
}

/** Returns true if this node should be dispatched to LLM (T2). */
function shouldDispatchT2(node) {
  return decideTier(node).tier === 'T2';
}

/** Returns true if this node should produce a gap record. */
function shouldWriteGap(node) {
  const d = decideTier(node);
  return d.tier === 'SKIP' || d.tier === 'BLOCKED' || d.tier === 'MISSING';
}

// ── Batch decision — for full graph ──────────────────────────────────────────

/**
 * decideAll(graph) → { t2: KGNode[], t1: KGNode[], t0: KGNode[], skip: TierDecision[], blocked: TierDecision[], missing: TierDecision[] }
 *
 * Classify every node in a KnowledgeGraph in one pass.
 * Returns bucketed arrays for each tier + gap categories.
 */
function decideAll(graph) {
  const result = { t2: [], t1: [], t0: [], skip: [], blocked: [], missing: [] };
  const nodes = graph.nodes ? [...graph.nodes.values()] : [];

  for (const node of nodes) {
    const d = decideTier(node);
    switch (d.tier) {
      case 'T2':      result.t2.push({ node, decision: d });      break;
      case 'T1':      result.t1.push({ node, decision: d });      break;
      case 'T0':      result.t0.push({ node, decision: d });      break;
      case 'SKIP':    result.skip.push({ node, decision: d });    break;
      case 'BLOCKED': result.blocked.push({ node, decision: d }); break;
      case 'MISSING': result.missing.push({ node, decision: d }); break;
    }
  }

  return result;
}

// ── Contract summary ──────────────────────────────────────────────────────────

/**
 * summarize(decideAllResult) → string
 * Human-readable summary of a decideAll() result.
 */
function summarize(all) {
  const lines = [
    `T2 (implement): ${all.t2.length}`,
    `T1 (scaffold):  ${all.t1.length}`,
    `T0 (structure): ${all.t0.length}`,
    `SKIP:           ${all.skip.length}`,
    `BLOCKED:        ${all.blocked.length}`,
    `MISSING:        ${all.missing.length}`,
  ];
  return lines.join('\n');
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  TIER_CONTRACT,
  BOUNDARIES,
  decideTier,
  decideTierForSpec,
  shouldEmitT0,
  shouldEmitT1,
  shouldDispatchT2,
  shouldWriteGap,
  decideAll,
  summarize,
};
