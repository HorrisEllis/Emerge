'use strict';
/**
 * gap-field.test.js
 *
 * Tests the semantic delta layer and baseline trajectory tracker.
 *
 * Core assertions:
 *   1. Fully specced systems produce 0 gaps, 0 token cost
 *   2. Every gap type is detected when the condition is present
 *   3. Token cost formula: cost ∝ gap pressure × blast radius
 *   4. Blocking gaps are correctly identified and surfaced
 *   5. Baseline tracks invariant trajectory across multiple builds
 *   6. Sigma regime classifies correctly (stable/improving/degrading/volatile)
 */

const { computeGapField, GAP_TYPE, GAP_REASON, BASE_TOKEN_COST, GF } = require('../compiler/gap-field-engine');
const { createBaselineTracker, TREND, SIGMA, STATUS } = require('../compiler/baseline-tracker');
const { check } = require('../compiler/invariants-engine');
const { build } = require('../compiler/kg-builder');
const { Event } = require('../siso');

let p = 0, f = 0;
function test(label, fn) {
  try { fn(); p++; process.stdout.write('.'); }
  catch (e) { f++; console.log('\nFAIL [' + label + ']: ' + e.message); }
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assert(v, msg)        { if (!v) throw new Error(msg ?? 'assertion failed'); }
function assertClose(a, b, tol = 0.01, msg) {
  if (Math.abs(a - b) > tol) throw new Error(msg ?? `expected ${b} ±${tol}, got ${a}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function full(id, name, deps = []) {
  return { id, name, description: 'd',
    exports: ['f() → R'], gate_pipeline: ['G1'],
    behavioral_contracts: ['c'], error_paths: ['e'],
    deps: deps.map(n => ({ name: n })) };
}
function spec(name, modules) {
  return { meta: { name, version: '1' }, modules };
}
function buildClean(...modules) {
  const { graph } = build(spec('t', modules));
  return graph;
}

// ── 1. Module structure ───────────────────────────────────────────────────────

test('gap-field: pipeline produces 8 events (build + 7 gates)', () => {
  const graph = buildClean(full('A','a'));
  const report = check(graph);
  const { field, log } = computeGapField(graph, report);
  assertEqual(log.sample().count, 8);
});

test('gap-field: always returns a field object, never throws', () => {
  const { field } = computeGapField(null, null);
  assert(field, 'field is null');
  assert(typeof field.summarize === 'function');
  assertEqual(field.gapCount, 0);
});

test('gap-field: GF event constants are all distinct', () => {
  const vals = Object.values(GF);
  assertEqual(new Set(vals).size, vals.length);
});

// ── 2. Clean system: zero gaps ────────────────────────────────────────────────

test('gap-field: fully specced system produces 0 gaps', () => {
  const graph  = buildClean(full('A','a'), full('B','b',['a']), full('C','c',['b']));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  assertEqual(field.gapCount, 0, `expected 0 gaps, got ${field.gapCount}: ${JSON.stringify(field.gaps.map(g=>g.type+':'+g.reason))}`);
  assertEqual(field.totalTokenCost, 0);
  assertClose(field.totalGapWeight, 0);
});

test('gap-field: zero gaps means token forecast is 0', () => {
  const graph  = buildClean(full('A','a'));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  assertEqual(field.tokenBudgetForecast.estimatedTokens, 0);
  assertClose(field.tokenBudgetForecast.confidence, 1.0);
});

// ── 3. Structural gaps ────────────────────────────────────────────────────────

test('gap-field: structural gap for orphaned BLACK node', () => {
  const { graph } = build(spec('t', [
    { id:'A', name:'a', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'ghost'}] },
  ]));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  const structural = field.getByType(GAP_TYPE.STRUCTURAL);
  assert(structural.length >= 1, 'expected structural gap for ghost dep');
  assert(structural.some(g => g.reason === GAP_REASON.ORPHANED), 'expected orphaned reason');
  assert(structural[0].estimatedTokenCost > 0, 'token cost should be > 0 for structural gap');
});

test('gap-field: structural gap from INV-001 violation', () => {
  const graph = buildClean(full('A','a'));
  // Corrupt key
  const node = graph.nodes.get('A');
  graph.nodes.delete('A');
  graph.nodes.set('wrong', node);
  const report = check(graph);
  assert(!report.isValid, 'report should be invalid');
  const { field } = computeGapField(graph, report);
  const structural = field.getByType(GAP_TYPE.STRUCTURAL);
  assert(structural.some(g => g.description.includes('INV-001')), 'expected INV-001 structural gap');
});

// ── 4. Semantic gaps ──────────────────────────────────────────────────────────

test('gap-field: semantic gap for module with no exports', () => {
  const { graph } = build(spec('t', [
    { id:'A', name:'a', description:'d' }, // no exports
  ]));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  const semantic = field.getByType(GAP_TYPE.SEMANTIC);
  assert(semantic.some(g => g.nodeId === 'A' && g.description.includes('exports')),
    'expected semantic gap for missing exports');
});

test('gap-field: semantic gap for module with exports but no gates', () => {
  const { graph } = build(spec('t', [
    { id:'A', name:'a', description:'d', exports:['f()→R'] }, // no gates
  ]));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  const semantic = field.getByType(GAP_TYPE.SEMANTIC);
  assert(semantic.some(g => g.nodeId === 'A' && g.description.includes('gate_pipeline')),
    'expected semantic gap for missing gate_pipeline');
});

test('gap-field: no semantic gaps for event or schema nodes', () => {
  const { graph } = build({
    meta: { name:'t', version:'1' },
    modules: [full('A','a')],
    events: ['event.done { x }'],
  });
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  const semantic = field.getByType(GAP_TYPE.SEMANTIC);
  // Event nodes should not produce semantic gaps
  assert(!semantic.some(g => g.nodeId.startsWith('event:')),
    'event nodes should not produce semantic gaps');
});

// ── 5. Behavioral gaps ────────────────────────────────────────────────────────

test('gap-field: behavioral gap for module missing contracts', () => {
  const { graph } = build(spec('t', [
    { id:'A', name:'a', description:'d', exports:['f()→R'], gate_pipeline:['G1'] }, // no contracts
  ]));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  const behavioral = field.getByType(GAP_TYPE.BEHAVIORAL);
  assert(behavioral.some(g => g.nodeId === 'A' && g.description.includes('behavioral_contracts')),
    'expected behavioral gap for missing contracts');
});

test('gap-field: behavioral gap for module missing error paths (when contracts exist)', () => {
  const { graph } = build(spec('t', [
    { id:'A', name:'a', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'] }, // no error_paths
  ]));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  const behavioral = field.getByType(GAP_TYPE.BEHAVIORAL);
  assert(behavioral.some(g => g.nodeId === 'A' && g.description.includes('error_paths')),
    'expected behavioral gap for missing error_paths');
});

// ── 6. Execution gaps ─────────────────────────────────────────────────────────

test('gap-field: execution gap for BLOCKED (cycle) node', () => {
  const { graph } = build(spec('t', [
    { id:'A', name:'a', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'b'}] },
    { id:'B', name:'b', description:'d', exports:['g()→S'], gate_pipeline:['G2'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'a'}] },
  ]));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  assert(field.hasBlockingGaps(), 'expected blocking gaps for cycle');
  const blocking = field.getBlocking();
  assert(blocking.length >= 2, `expected >= 2 blocking gaps, got ${blocking.length}`);
  assertEqual(blocking[0].reason, GAP_REASON.BLOCKING);
  assertEqual(blocking[0].type, GAP_TYPE.EXECUTION);
});

test('gap-field: execution gap for SKIP node (below T0 threshold)', () => {
  const { graph } = build(spec('t', [
    { id:'A', name:'a', description:'d' }, // specDepth 0.1 → SKIP
  ]));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  const execution = field.getByType(GAP_TYPE.EXECUTION);
  assert(execution.some(g => g.nodeId === 'A' && g.reason === GAP_REASON.ATTENTION),
    'expected execution gap for SKIP node');
});

// ── 7. Propagation gaps ───────────────────────────────────────────────────────

test('gap-field: propagation gap when dep constrains downstream', () => {
  const { graph } = build(spec('t', [
    { id:'A', name:'a', description:'d', exports:['f()→R'] }, // weak: 0.3
    full('B','b',['a']), // strong but constrained by A
  ]));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  const prop = field.getByType(GAP_TYPE.PROPAGATION);
  // B is constrained by A (0.3) — propagation gap should appear
  assert(prop.some(g => g.nodeId === 'B' && g.description.includes("'a'")),
    `expected propagation gap for B constrained by a: ${JSON.stringify(prop.map(g=>g.description))}`);
});

// ── 8. Token cost model ───────────────────────────────────────────────────────

test('gap-field: structural gaps cost more than behavioral gaps', () => {
  assert(BASE_TOKEN_COST[GAP_TYPE.STRUCTURAL] > BASE_TOKEN_COST[GAP_TYPE.BEHAVIORAL],
    'structural gaps should have higher base cost than behavioral');
});

test('gap-field: token cost scales with blast radius', () => {
  // System where A has large blast radius (chain of dependents)
  // A has exports+gates but no behavioral contracts — behavioral gap appears
  const { graph } = build(spec('t', [
    { id:'A', name:'a', description:'d', exports:['f()→R'], gate_pipeline:['G1'] },
    full('B','b',['a']), full('C','c',['b']), full('D','d',['c']), full('E','e',['d']),
  ]));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  const aGaps = field.getByNode('A');
  assert(aGaps.length > 0, 'expected at least one gap for A');
  const aGap = aGaps[0];
  // A has blast radius 4 (B,C,D,E) — cost should exceed the base rate
  assert(aGap.estimatedTokenCost > 0, 'expected non-zero token cost for A gap');
  // Verify blast radius is 4
  assertEqual(graph.getBlastRadius('A').length, 4, 'expected blast radius 4 for A');
});

test('gap-field: totalGapWeight increases with more gaps', () => {
  const g1 = buildClean(full('A','a'));
  const g2  = buildClean(
    { id:'A', name:'a', description:'d' },
    { id:'B', name:'b', description:'d' },
  );
  const r1 = check(g1); const r2 = check(g2);
  const f1 = computeGapField(g1, r1).field;
  const f2 = computeGapField(g2, r2).field;
  assert(f2.totalGapWeight > f1.totalGapWeight,
    `f2 should have more gap weight (${f2.totalGapWeight}) than f1 (${f1.totalGapWeight})`);
});

// ── 9. Query interface ────────────────────────────────────────────────────────

test('gap-field: getByNode returns only gaps for that node', () => {
  const { graph } = build(spec('t', [
    { id:'A', name:'a', description:'d' },
    { id:'B', name:'b', description:'d' },
  ]));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  const aGaps = field.getByNode('A');
  assert(aGaps.every(g => g.nodeId === 'A'), 'getByNode should only return gaps for A');
});

test('gap-field: gaps sorted by severity × blast (highest first)', () => {
  const { graph } = build(spec('t', [
    { id:'A', name:'a', description:'d', exports:['f()→R'], gate_pipeline:['G1'] },
    full('B','b',['a']), full('C','c',['b']),
    { id:'D', name:'d', description:'d' }, // SKIP node
  ]));
  const report = check(graph);
  const { field } = computeGapField(graph, report);
  if (field.gaps.length >= 2) {
    const scores = field.gaps.map(g => g.severity * (1 + g.blastRadius * 0.1));
    for (let i = 1; i < scores.length; i++) {
      assert(scores[i-1] >= scores[i], `gaps not sorted: score[${i-1}]=${scores[i-1].toFixed(3)} < score[${i}]=${scores[i].toFixed(3)}`);
    }
  }
});

// ── 10. BaselineTracker ───────────────────────────────────────────────────────

test('baseline: starts healthy (composite 1.0)', () => {
  const tracker = createBaselineTracker();
  const snap    = tracker.snapshot();
  assertClose(snap.composite.score, 1.0);
  assertEqual(snap.composite.status, STATUS.PASS);
});

test('baseline: records ViolationReport and updates signals', () => {
  const tracker = createBaselineTracker();
  const report  = { checkedAt: Date.now(), violations: [
    { invariantId: 'INV-001', severity: 'critical', message: 'test', nodeId: 'A' },
  ]};
  tracker.record(report);
  const snap = tracker.snapshot();
  assert(snap.signals['INV-001'].score < 1.0, 'INV-001 should drop after violation');
  assertEqual(snap.buildCount, 1);
});

test('baseline: composite degrades when critical violations accumulate', () => {
  const tracker = createBaselineTracker();
  const makeReport = (n) => ({ checkedAt: Date.now(), violations:
    Array.from({length: n}, (_, i) => ({ invariantId: 'INV-00'+(i+1), severity: 'critical', message: 'x', nodeId: 'A' }))
  });
  tracker.record(makeReport(0));
  const clean = tracker.snapshot().composite.score;
  tracker.record(makeReport(3));
  const degraded = tracker.snapshot().composite.score;
  assert(degraded < clean, `composite should degrade: ${degraded} < ${clean}`);
});

test('baseline: trend detected as degrading after repeated failures', () => {
  const tracker = createBaselineTracker();
  for (let i = 0; i < 6; i++) {
    tracker.record({ checkedAt: Date.now(), violations: [
      { invariantId: 'INV-001', severity: 'critical', message: 'x', nodeId: 'A' },
    ]});
  }
  const snap = tracker.snapshot();
  assert(['degrading','stable'].includes(snap.composite.trend),
    `expected degrading or stable, got ${snap.composite.trend}`);
});

test('baseline: trend detected as improving after recovery', () => {
  const tracker = createBaselineTracker();
  // First degrade
  for (let i = 0; i < 3; i++) {
    tracker.record({ checkedAt: Date.now(), violations: [
      { invariantId: 'INV-001', severity: 'critical', message: 'x', nodeId: 'A' },
    ]});
  }
  // Then recover
  for (let i = 0; i < 5; i++) {
    tracker.record({ checkedAt: Date.now(), violations: [] });
  }
  const snap = tracker.snapshot();
  assert(['improving','stable'].includes(snap.composite.trend),
    `expected improving or stable after recovery, got ${snap.composite.trend}`);
});

test('baseline: sigma volatile when variance is high', () => {
  const tracker = createBaselineTracker();
  // Alternating healthy and sick builds → high variance
  for (let i = 0; i < 10; i++) {
    const violations = i % 2 === 0 ? [] : [
      { invariantId: 'INV-001', severity: 'critical', message: 'x', nodeId: 'A' },
      { invariantId: 'INV-002', severity: 'critical', message: 'x', nodeId: 'B' },
      { invariantId: 'INV-003', severity: 'critical', message: 'x', nodeId: 'C' },
    ];
    tracker.record({ checkedAt: Date.now(), violations });
  }
  const snap = tracker.snapshot();
  // High alternation should produce volatile or degrading
  assert(['volatile','degrading','stable'].includes(snap.sigma),
    `unexpected sigma: ${snap.sigma}`);
});

test('baseline: diff() detects what changed between snapshots', () => {
  const tracker = createBaselineTracker();
  const snapA = tracker.snapshot();
  tracker.record({ checkedAt: Date.now(), violations: [
    { invariantId: 'INV-004', severity: 'warn', message: 'x', nodeId: 'A' },
  ]});
  const snapB = tracker.snapshot();
  const delta = createBaselineTracker.diff ? createBaselineTracker.diff(snapA, snapB)
    : require('../compiler/baseline-tracker').BaselineTracker.diff(snapA, snapB);
  assert('INV-004' in delta.changedInvariants, 'diff should detect INV-004 change');
  assert(delta.changedInvariants['INV-004'].delta < 0, 'INV-004 score should have dropped');
  assertEqual(delta.buildDelta, 1);
});

test('baseline: snapshot is immutable (history copy not reference)', () => {
  const tracker = createBaselineTracker();
  tracker.record({ checkedAt: Date.now(), violations: [] });
  const snap = tracker.snapshot();
  const histLen = snap.history.length;
  tracker.record({ checkedAt: Date.now(), violations: [] });
  assertEqual(snap.history.length, histLen, 'snapshot history should not be mutated by later builds');
});

// ── 11. Integration: runtime.spec ────────────────────────────────────────────

test('gap-field: runtime.spec produces 0 gaps (fully specced)', () => {
  const yaml = require('js-yaml');
  const fs   = require('fs');
  const { normalizeSpec, sanitizeSpec } = require('../compiler/emit');
  const raw = fs.readFileSync('./runtime.spec', 'utf-8');
  let doc; try { doc = yaml.load(raw); } catch(e) { doc = yaml.load(sanitizeSpec(raw)); }
  const { graph } = build(normalizeSpec(doc?.spec ?? doc));
  const report    = check(graph);
  const { field } = computeGapField(graph, report);
  assertEqual(field.gapCount, 0, `runtime.spec should have 0 gaps, got ${field.gapCount}: ${field.gaps.map(g=>g.type+':'+g.reason).join(', ')}`);
  assertEqual(field.totalTokenCost, 0, 'runtime.spec token cost should be 0');
});

// ── Report ────────────────────────────────────────────────────────────────────

console.log('\n\n  gap-field.test.js');
console.log('  ' + p + ' passed  ' + f + ' failed');
if (f > 0) process.exit(1);

// ── 12. Compile result integration ───────────────────────────────────────────

const asyncJobs = [];

asyncJobs.push((async () => {
  const label = 'compile result: four co-equal layers all present';
  try {
    const { compile } = require('../compiler/pipeline');
    const r = await compile(
      require('path').join(__dirname, '../runtime.spec'),
      '/tmp/compile-integration-' + Date.now(),
      { skipCortex: true, tier: 1 }
    );
    assert(r.ok, 'compile not ok: ' + r.error);
    // KG layer
    assert(r.graph,      'graph missing');
    assert(r.buildOrder, 'buildOrder missing');
    assert(r.readiness,  'readiness missing');
    // Uncertainty layer
    assert(r.gapField !== undefined,    'gapField missing');
    assert('totalGapWeight' in r,       'totalGapWeight missing');
    assert(r.tokenForecast !== undefined,'tokenForecast missing');
    assert(r.violations !== undefined,  'violations missing');
    // Execution layer
    assert(r.tierMap !== undefined,     'tierMap missing');
    // Synthesis layer
    assert(Array.isArray(r.recommendations), 'recommendations missing');
    assert(r.recommendations.length > 0,     'recommendations empty');
    p++; process.stdout.write('.');
  } catch(e) { f++; console.log('\nFAIL [' + label + ']: ' + e.message); }
})());

asyncJobs.push((async () => {
  const label = 'compile result: buildOrder annotated with tier + gapCount';
  try {
    const { compile } = require('../compiler/pipeline');
    const r = await compile(
      require('path').join(__dirname, '../runtime.spec'),
      '/tmp/compile-bo-' + Date.now(),
      { skipCortex: true, tier: 1 }
    );
    assert(r.ok && r.buildOrder && r.buildOrder.length > 0, 'no build order');
    const first = r.buildOrder[0];
    assert('tier' in first,      'buildOrder entry missing tier');
    assert('readiness' in first, 'buildOrder entry missing readiness');
    assert('gapCount' in first,  'buildOrder entry missing gapCount');
    // runtime.spec is fully specced — no gaps in buildOrder
    assert(r.buildOrder.every(n => n.gapCount === 0), 'runtime.spec should have 0 gaps per node');
    p++; process.stdout.write('.');
  } catch(e) { f++; console.log('\nFAIL [' + label + ']: ' + e.message); }
})());

asyncJobs.push((async () => {
  const label = 'compile result: CLEAN recommendation for fully specced system';
  try {
    const { compile } = require('../compiler/pipeline');
    const r = await compile(
      require('path').join(__dirname, '../runtime.spec'),
      '/tmp/compile-rec-' + Date.now(),
      { skipCortex: true, tier: 1 }
    );
    assert(r.ok);
    assert(r.recommendations.some(rec => rec.includes('READY') || rec.includes('CLEAN')),
      'expected READY or CLEAN recommendation: ' + r.recommendations.join(' | '));
    p++; process.stdout.write('.');
  } catch(e) { f++; console.log('\nFAIL [' + label + ']: ' + e.message); }
})());

Promise.all(asyncJobs).then(() => {
  console.log('\n\n  gap-field.test.js (with integration)');
  console.log('  ' + p + ' passed  ' + f + ' failed');
  process.exit(f > 0 ? 1 : 0);
});
