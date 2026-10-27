'use strict';
/**
 * compiler/invariants-engine.js
 * UUID: mod-invariants-v1-0000-0001
 * Version: 1.0.0
 *
 * STATE VALIDITY KERNEL.
 *
 * Hard guarantees about graph correctness after every build and every mutation.
 * Violations are typed events — not exceptions.
 * check() is synchronous and pure — no side effects.
 * check() always returns a ViolationReport, never throws.
 *
 * THE EIGHT INVARIANTS:
 *
 *   INV-001  nodes.Map key === node.id           (identity consistency)
 *   INV-002  every edge.from exists in nodes     (no phantom sources)
 *   INV-003  every edge.to exists in nodes       (no phantom targets)
 *   INV-004  0 ≤ genReadiness ≤ 1               (bounded propagation)
 *   INV-005  BLACK nodes have genReadiness 0.0  (semantic consistency)
 *   INV-006  cycle group members have equal genReadiness (convergence symmetry)
 *   INV-007  getBuildOrder() is topologically valid (no dep precedes its dependent)
 *   INV-008  no node appears in its own blastRadius (no self-referential blast)
 *
 * SEVERITY:
 *   critical — invalidates the graph. Blocks tier contract execution.
 *   warn     — suspicious state. Logged, not blocking.
 *   info     — advisory. Skipped data or edge cases noted.
 *
 * FEEDS:
 *   → gap-field-engine  (violations → gap triggers)
 *   → reply-engine      (critical violations → block scheduling)
 *   → ring-buffer       (all violations → causal history)
 *
 * SISO PIPELINE:
 *   invariants.check.requested
 *     → INV001Gate → INV002Gate → INV003Gate → INV004Gate
 *     → INV005Gate → INV006Gate → INV007Gate → INV008Gate
 *     → AssembleReportGate → invariants.check.complete (pending)
 */

const { Event, Gate, Stream, StreamLog } = require('../siso');

// ── Event type constants ──────────────────────────────────────────────────────

const INV = {
  CHECK:    'invariants.check.requested',
  PASS_001: 'inv.001.done',
  PASS_002: 'inv.002.done',
  PASS_003: 'inv.003.done',
  PASS_004: 'inv.004.done',
  PASS_005: 'inv.005.done',
  PASS_006: 'inv.006.done',
  PASS_007: 'inv.007.done',
  PASS_008: 'inv.008.done',
  COMPLETE: 'invariants.check.complete',
  ERROR:    'invariants.check.error',
};

// ── Violation factory ─────────────────────────────────────────────────────────

function violation(invariantId, severity, message, nodeId = null, edgeId = null) {
  return { invariantId, severity, message, nodeId, edgeId };
}

// ── Gate 1: INV-001 — Identity Consistency ────────────────────────────────────
// nodes.Map key === node.id for every entry.
// A mismatch means an alias was stored as a primary key — the root cause of the
// phantom BLACK node bug. Critical: invalidates all downstream lookups.

class INV001Gate extends Gate {
  constructor() { super(INV.CHECK); }

  transform(event, stream) {
    const { graph, violations } = event.data;
    const local = [];

    for (const [key, node] of graph.nodes) {
      if (key !== node.id) {
        local.push(violation(
          'INV-001', 'critical',
          `nodes.Map key '${key}' !== node.id '${node.id}' — alias stored as primary key`,
          node.id
        ));
      }
    }

    stream.emit(new Event(INV.PASS_001, {
      ...event.data,
      violations: [...violations, ...local],
    }));
  }
}

// ── Gate 2: INV-002/003 — Edge Validity ──────────────────────────────────────
// Every edge.from and edge.to must exist in nodes.Map.
// A missing source or target means a reference wasn't resolved to a real node.
// Critical: broken edges produce incorrect propagation.

class INV002Gate extends Gate {
  constructor() { super(INV.PASS_001); }

  transform(event, stream) {
    const { graph, violations } = event.data;
    const local = [];

    for (const edge of (graph.edges ?? [])) {
      if (!graph.nodes.has(edge.from)) {
        local.push(violation(
          'INV-002', 'critical',
          `edge.from '${edge.from}' does not exist in nodes.Map`,
          null, `${edge.from}→${edge.to}`
        ));
      }
      if (!graph.nodes.has(edge.to)) {
        local.push(violation(
          'INV-003', 'critical',
          `edge.to '${edge.to}' does not exist in nodes.Map`,
          null, `${edge.from}→${edge.to}`
        ));
      }
    }

    stream.emit(new Event(INV.PASS_002, {
      ...event.data,
      violations: [...violations, ...local],
    }));
  }
}

// ── Gate 3: INV-004 — Readiness Bounds ───────────────────────────────────────
// 0 ≤ genReadiness ≤ 1 for every node.
// Out-of-bounds values indicate a propagation bug or manual mutation.
// Critical: tier contract assumptions break above 1.0 or below 0.0.

class INV003Gate extends Gate {
  constructor() { super(INV.PASS_002); }

  transform(event, stream) {
    const { graph, violations } = event.data;
    const local = [];

    for (const [, node] of graph.nodes) {
      const r = node.generationReadiness;
      if (typeof r !== 'number' || isNaN(r)) {
        local.push(violation(
          'INV-004', 'critical',
          `node '${node.id}' has non-numeric generationReadiness: ${r}`,
          node.id
        ));
      } else if (r < 0 || r > 1) {
        local.push(violation(
          'INV-004', 'critical',
          `node '${node.id}' genReadiness ${r.toFixed(4)} is outside [0, 1]`,
          node.id
        ));
      }
    }

    stream.emit(new Event(INV.PASS_003, {
      ...event.data,
      violations: [...violations, ...local],
    }));
  }
}

// ── Gate 4: INV-005 — BLACK Semantic Consistency ─────────────────────────────
// BLACK nodes must have genReadiness === 0.0.
// A BLACK node with non-zero readiness means it was somehow scored as
// partially specced — which is impossible for a node that doesn't exist.
// Critical: tier contract would incorrectly dispatch a missing node.

class INV004Gate extends Gate {
  constructor() { super(INV.PASS_003); }

  transform(event, stream) {
    const { graph, violations } = event.data;
    const local = [];

    for (const [, node] of graph.nodes) {
      if (node.isBlack && node.generationReadiness !== 0.0) {
        local.push(violation(
          'INV-005', 'critical',
          `BLACK node '${node.id}' has genReadiness ${node.generationReadiness.toFixed(4)} — must be 0.0`,
          node.id
        ));
      }
      // Also check: BLACK confidence should match isBlack flag
      if (node.isBlack && node.confidence !== 'BLACK') {
        local.push(violation(
          'INV-005', 'warn',
          `node '${node.id}' has isBlack=true but confidence='${node.confidence}' — should be 'BLACK'`,
          node.id
        ));
      }
      if (!node.isBlack && node.confidence === 'BLACK') {
        local.push(violation(
          'INV-005', 'warn',
          `node '${node.id}' has confidence='BLACK' but isBlack=false — inconsistent flags`,
          node.id
        ));
      }
    }

    stream.emit(new Event(INV.PASS_004, {
      ...event.data,
      violations: [...violations, ...local],
    }));
  }
}

// ── Gate 5: INV-006 — Cycle Convergence Symmetry ─────────────────────────────
// All members of a cycle group must have the same genReadiness value.
// Asymmetric cycle readiness means the relaxation algorithm didn't converge,
// or a mutation was applied to only part of a cycle.
// Warn: asymmetry doesn't break the system but indicates stale propagation.

class INV005Gate extends Gate {
  constructor() { super(INV.PASS_004); }

  transform(event, stream) {
    const { graph, violations } = event.data;
    const local = [];

    // Detect cycle groups: nodes with genReadiness 0.0 that have mutual deps
    // Use a small tolerance for zero detection — cycle convergence may produce
    // values like 0.0001 due to floating point. Tolerance of 0.005 catches these
    // while still distinguishing zero from meaningful low readiness (0.1+).
    const CYCLE_ZERO_TOLERANCE = 0.005;
    const zeroNodes = [...graph.nodes.values()].filter(n =>
      !n.isBlack && n.generationReadiness <= CYCLE_ZERO_TOLERANCE
    );

    if (zeroNodes.length > 1) {
      // Group by mutual reachability through edges
      const cycleGroups = detectCycleGroups(zeroNodes, graph.edges ?? []);

      for (const group of cycleGroups) {
        if (group.length < 2) continue;
        const readinesses = group.map(n => n.generationReadiness);
        const allEqual = readinesses.every(r => Math.abs(r - readinesses[0]) < 0.001);
        if (!allEqual) {
          local.push(violation(
            'INV-006', 'warn',
            `cycle group [${group.map(n => n.id).join(', ')}] has non-uniform genReadiness values: [${readinesses.map(r => r.toFixed(3)).join(', ')}]`,
            group[0].id
          ));
        }
      }
    }

    stream.emit(new Event(INV.PASS_005, {
      ...event.data,
      violations: [...violations, ...local],
    }));
  }
}

// ── Gate 6: INV-007 — Topological Build Order Validity ───────────────────────
// getBuildOrder() must place every dependency before its dependents.
// A violation means the build order would compile dependents before foundations.
// Critical: would cause T1/T2 emission in wrong order.

class INV006Gate extends Gate {
  constructor() { super(INV.PASS_005); }

  transform(event, stream) {
    const { graph, violations } = event.data;
    const local = [];

    try {
      const order     = graph.getBuildOrder().map(n => n.id);
      const position  = new Map(order.map((id, i) => [id, i]));

      for (const edge of (graph.edges ?? [])) {
        if (edge.kind !== 'depends_on') continue;
        const fromPos = position.get(edge.from);
        const toPos   = position.get(edge.to);
        if (fromPos === undefined || toPos === undefined) continue;

        // edge.from depends on edge.to, so edge.to must come BEFORE edge.from
        if (toPos > fromPos) {
          local.push(violation(
            'INV-007', 'critical',
            `build order violation: '${edge.to}' (pos ${toPos}) must precede '${edge.from}' (pos ${fromPos}) but doesn't`,
            edge.from
          ));
        }
      }
    } catch (e) {
      local.push(violation(
        'INV-007', 'critical',
        `getBuildOrder() threw: ${e.message}`,
        null
      ));
    }

    stream.emit(new Event(INV.PASS_006, {
      ...event.data,
      violations: [...violations, ...local],
    }));
  }
}

// ── Gate 7: INV-008 — No Self-Referential Blast Radius ───────────────────────
// No node should appear in its own blastRadius.
// A node in its own blast radius means the BFS traversal looped back — either
// a cycle wasn't handled or the blast radius computation is incorrect.
// Warn: doesn't break generation but blast radius reports will be misleading.

class INV007Gate extends Gate {
  constructor() { super(INV.PASS_006); }

  transform(event, stream) {
    const { graph, violations } = event.data;
    const local = [];

    for (const [id, node] of graph.nodes) {
      if (!Array.isArray(node.blastRadius)) {
        local.push(violation(
          'INV-008', 'info',
          `node '${id}' has no blastRadius array — skipping INV-008 check`,
          id
        ));
        continue;
      }
      const selfInBlast = node.blastRadius.some(b => b.id === id || b.name === node.name);
      if (selfInBlast) {
        local.push(violation(
          'INV-008', 'warn',
          `node '${id}' (${node.name}) appears in its own blastRadius — self-referential blast`,
          id
        ));
      }
    }

    stream.emit(new Event(INV.PASS_007, {
      ...event.data,
      violations: [...violations, ...local],
    }));
  }
}

// ── Gate 8: AssembleReportGate ────────────────────────────────────────────────
// Collects all violations, builds ViolationReport, emits invariants.check.complete.

class AssembleReportGate extends Gate {
  constructor() { super(INV.PASS_007); }

  transform(event, stream) {
    const { violations, graph } = event.data;

    const criticalCount = violations.filter(v => v.severity === 'critical').length;
    const warnCount     = violations.filter(v => v.severity === 'warn').length;
    const infoCount     = violations.filter(v => v.severity === 'info').length;

    const report = {
      violations,
      criticalCount,
      warnCount,
      infoCount,
      checkedAt:    Date.now(),
      nodeCount:    graph.meta?.nodeCount ?? 0,
      edgeCount:    graph.meta?.edgeCount ?? 0,
      isValid:      criticalCount === 0,
    };

    stream.emit(new Event(INV.COMPLETE, { report }));
  }
}

// ── Cycle group detection helper ──────────────────────────────────────────────
// Identifies groups of nodes that are mutually reachable through depends_on edges.
// Used by INV-006 to check convergence symmetry within cycle groups.

function detectCycleGroups(zeroNodes, edges) {
  const zeroIds   = new Set(zeroNodes.map(n => n.id));
  const adjMatrix = new Map(); // id → Set of reachable zero-node ids

  // Build adjacency within zero-node subgraph
  for (const n of zeroNodes) adjMatrix.set(n.id, new Set());
  for (const edge of edges) {
    if (edge.kind !== 'depends_on') continue;
    if (zeroIds.has(edge.from) && zeroIds.has(edge.to)) {
      adjMatrix.get(edge.from)?.add(edge.to);
    }
  }

  // Find strongly connected components (simple union-find for undirected cycles)
  const parent = new Map(zeroNodes.map(n => [n.id, n.id]));
  function find(id) {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)));
    return parent.get(id);
  }
  function union(a, b) { parent.set(find(a), find(b)); }

  for (const [from, targets] of adjMatrix) {
    for (const to of targets) union(from, to);
  }

  // Group by root
  const groups = new Map();
  for (const n of zeroNodes) {
    const root = find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  }

  return [...groups.values()].filter(g => g.length > 1);
}

// ── Pipeline factory ──────────────────────────────────────────────────────────

function createInvariantsPipeline(logLevel = 'EVENTS') {
  const log    = new StreamLog(logLevel);
  const stream = new Stream({ log });

  stream.register(new INV001Gate());
  stream.register(new INV002Gate());
  stream.register(new INV003Gate());
  stream.register(new INV004Gate());
  stream.register(new INV005Gate());
  stream.register(new INV006Gate());
  stream.register(new INV007Gate());
  stream.register(new AssembleReportGate());

  return { stream, log };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * check(graph, options) → ViolationReport
 *
 * Runs all 8 invariant gates over the graph synchronously.
 * Always returns a report — never throws.
 * isValid = true only if criticalCount === 0.
 */
function check(graph, options = {}) {
  if (!graph) {
    return {
      violations:     [violation('INV-000', 'critical', 'graph is null or undefined')],
      criticalCount:  1,
      warnCount:      0,
      infoCount:      0,
      checkedAt:      Date.now(),
      nodeCount:      0,
      edgeCount:      0,
      isValid:        false,
    };
  }

  const { logLevel = 'EVENTS' } = options;
  const { stream, log } = createInvariantsPipeline(logLevel);

  try {
    stream.emit(new Event(INV.CHECK, { graph, violations: [] }));
  } catch (e) {
    return {
      violations:    [violation('INV-000', 'critical', `invariants pipeline threw: ${e.message}`)],
      criticalCount: 1,
      warnCount:     0,
      infoCount:     0,
      checkedAt:     Date.now(),
      nodeCount:     graph.meta?.nodeCount ?? 0,
      edgeCount:     graph.meta?.edgeCount ?? 0,
      isValid:       false,
    };
  }

  const { pending } = stream.sampleHere();
  const complete    = pending.find(e => e.type === INV.COMPLETE);

  if (complete) return { ...complete.data.report, log };

  // Should not happen — AssembleReportGate always fires
  return {
    violations:    [violation('INV-000', 'critical', 'invariants pipeline produced no result')],
    criticalCount: 1,
    warnCount:     0,
    infoCount:     0,
    checkedAt:     Date.now(),
    nodeCount:     graph.meta?.nodeCount ?? 0,
    edgeCount:     graph.meta?.edgeCount ?? 0,
    isValid:       false,
  };
}

/**
 * checkNode(node, graph) → Violation[]
 * Run all node-level invariants for a single node.
 * Used for incremental re-checking after a mutation.
 */
function checkNode(node, graph) {
  if (!node || !graph) return [violation('INV-000', 'critical', 'node or graph is null')];
  const violations = [];

  // INV-001
  const key = [...graph.nodes.entries()].find(([, n]) => n === node)?.[0];
  if (key && key !== node.id) {
    violations.push(violation('INV-001', 'critical',
      `nodes.Map key '${key}' !== node.id '${node.id}'`, node.id));
  }

  // INV-004
  const r = node.generationReadiness;
  if (typeof r !== 'number' || isNaN(r) || r < 0 || r > 1) {
    violations.push(violation('INV-004', 'critical',
      `node '${node.id}' genReadiness ${r} is outside [0, 1]`, node.id));
  }

  // INV-005
  if (node.isBlack && r !== 0.0) {
    violations.push(violation('INV-005', 'critical',
      `BLACK node '${node.id}' has genReadiness ${r} — must be 0.0`, node.id));
  }

  // INV-008
  if (Array.isArray(node.blastRadius)) {
    const selfInBlast = node.blastRadius.some(b => b.id === node.id || b.name === node.name);
    if (selfInBlast) {
      violations.push(violation('INV-008', 'warn',
        `node '${node.id}' appears in its own blastRadius`, node.id));
    }
  }

  return violations;
}

/**
 * checkEdges(edges, nodes) → Violation[]
 * Run edge validity invariants (INV-002/003) on a subset of edges.
 */
function checkEdges(edges, nodes) {
  const violations = [];
  for (const edge of (edges ?? [])) {
    if (!nodes.has(edge.from)) {
      violations.push(violation('INV-002', 'critical',
        `edge.from '${edge.from}' not in nodes.Map`, null, `${edge.from}→${edge.to}`));
    }
    if (!nodes.has(edge.to)) {
      violations.push(violation('INV-003', 'critical',
        `edge.to '${edge.to}' not in nodes.Map`, null, `${edge.from}→${edge.to}`));
    }
  }
  return violations;
}

/**
 * checkPropagation(graph) → Violation[]
 * Run propagation-specific invariants (INV-004, INV-005, INV-006).
 */
function checkPropagation(graph) {
  if (!graph) return [violation('INV-000', 'critical', 'graph is null')];
  const report = check(graph);
  return report.violations.filter(v =>
    ['INV-004', 'INV-005', 'INV-006'].includes(v.invariantId)
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  check,
  checkNode,
  checkEdges,
  checkPropagation,
  createInvariantsPipeline,
  violation,
  INV,
  INVARIANT_VERSION: require('../version').INVARIANTS,
};
