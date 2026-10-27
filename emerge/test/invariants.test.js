'use strict';
/**
 * invariants.test.js — STATE VALIDITY KERNEL tests
 *
 * Tests every invariant against deliberately crafted violations
 * and against clean graphs. Proves:
 *
 *   1. Every invariant catches its specific violation
 *   2. Clean graphs pass all invariants
 *   3. check() never throws — always returns a report
 *   4. INV-007 found a real bug in getBuildOrder() (regression test)
 *   5. checkNode() and checkEdges() work for incremental checking
 *   6. The pipeline produces exactly 9 events (check + 8 gates)
 */

const {
  check, checkNode, checkEdges, checkPropagation,
  violation, createInvariantsPipeline, INV, INVARIANT_VERSION,
} = require('../compiler/invariants-engine');
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
function assert(v, msg) { if (!v) throw new Error(msg ?? 'assertion failed'); }

// ── Fixtures ──────────────────────────────────────────────────────────────────

function full(id, name, deps = []) {
  return {
    id, name, description: 'd',
    exports: ['f() → R'], gate_pipeline: ['G1'],
    behavioral_contracts: ['c'], error_paths: ['e'],
    deps: deps.map(n => ({ name: n })),
  };
}

function buildClean(...modules) {
  return build({ meta: { name: 'test', version: '1' }, modules }).graph;
}

// ── 1. Module structure ───────────────────────────────────────────────────────

test('invariants: INVARIANT_VERSION is a semver string', () => {
  assert(/^\d+\.\d+\.\d+$/.test(INVARIANT_VERSION));
});

test('invariants: pipeline produces 9 events (check + 8 gates)', () => {
  const graph = buildClean(full('A', 'a'));
  const { stream, log } = createInvariantsPipeline('EVENTS');
  stream.emit(new Event(INV.CHECK, { graph, violations: [] }));
  assertEqual(log.sample().count, 9,
    `expected 9 events, got ${log.sample().count}`);
});

test('invariants: INV event constants are all distinct', () => {
  const vals = Object.values(INV);
  assertEqual(new Set(vals).size, vals.length, 'duplicate INV event constant');
});

// ── 2. check() on clean graphs ────────────────────────────────────────────────

test('INV: clean 2-node graph passes all invariants', () => {
  const graph = buildClean(full('A', 'a'), full('B', 'b', ['a']));
  const r = check(graph);
  assert(r.isValid, `expected valid, violations: ${JSON.stringify(r.violations)}`);
  assertEqual(r.criticalCount, 0);
  assertEqual(r.warnCount, 0);
});

test('INV: clean 6-node chain passes all invariants', () => {
  const graph = buildClean(
    full('A','a'), full('B','b',['a']), full('C','c',['b']),
    full('D','d',['c']), full('E','e',['d']), full('F','f',['e'])
  );
  const r = check(graph);
  assert(r.isValid, `chain failed: ${r.violations.map(v=>v.message).join('; ')}`);
});

test('INV: clean diamond passes all invariants', () => {
  const graph = build({ meta: { name: 't', version: '1' }, modules: [
    full('A','a'), full('B','b',['a']), full('C','c',['a']),
    { id:'D', name:'d', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'b'},{name:'c'}] },
  ]}).graph;
  const r = check(graph);
  assert(r.isValid, `diamond failed: ${r.violations.map(v=>v.message).join('; ')}`);
});

test('INV: null graph returns critical violation, never throws', () => {
  const r = check(null);
  assert(!r.isValid);
  assertEqual(r.criticalCount, 1);
  assert(r.violations[0].severity === 'critical');
});

test('INV: check() always returns a report with required fields', () => {
  const graph = buildClean(full('A','a'));
  const r = check(graph);
  for (const field of ['violations','criticalCount','warnCount','infoCount','checkedAt','isValid']) {
    assert(field in r, `report missing field: ${field}`);
  }
});

// ── 3. INV-001 — Identity consistency ────────────────────────────────────────

test('INV-001: clean graph — no key/id mismatches', () => {
  const graph = buildClean(full('A','a'), full('B','b',['a']));
  const r = check(graph);
  const v001 = r.violations.filter(v => v.invariantId === 'INV-001');
  assertEqual(v001.length, 0);
});

test('INV-001: detects key !== node.id mismatch', () => {
  const graph = buildClean(full('A','a'));
  // Manually corrupt: store under wrong key
  const node = graph.nodes.get('A');
  graph.nodes.delete('A');
  graph.nodes.set('wrong_key', node);
  const r = check(graph);
  const v001 = r.violations.filter(v => v.invariantId === 'INV-001');
  assertEqual(v001.length, 1, 'expected 1 INV-001 violation');
  assertEqual(v001[0].severity, 'critical');
  assert(v001[0].message.includes('wrong_key'));
});

// ── 4. INV-002/003 — Edge validity ────────────────────────────────────────────

test('INV-002/003: clean graph — all edges valid', () => {
  const graph = buildClean(full('A','a'), full('B','b',['a']));
  const r = check(graph);
  const edgeViolations = r.violations.filter(v => ['INV-002','INV-003'].includes(v.invariantId));
  assertEqual(edgeViolations.length, 0);
});

test('INV-002: detects phantom edge.from', () => {
  const graph = buildClean(full('A','a'));
  graph.edges.push({ from: 'PHANTOM', to: 'A', kind: 'depends_on' });
  const r = check(graph);
  const v002 = r.violations.filter(v => v.invariantId === 'INV-002');
  assertEqual(v002.length, 1);
  assertEqual(v002[0].severity, 'critical');
  assert(v002[0].message.includes('PHANTOM'));
});

test('INV-003: detects phantom edge.to', () => {
  const graph = buildClean(full('A','a'));
  graph.edges.push({ from: 'A', to: 'GHOST', kind: 'depends_on' });
  const r = check(graph);
  const v003 = r.violations.filter(v => v.invariantId === 'INV-003');
  assertEqual(v003.length, 1);
  assertEqual(v003[0].severity, 'critical');
  assert(v003[0].message.includes('GHOST'));
});

// ── 5. INV-004 — Readiness bounds ────────────────────────────────────────────

test('INV-004: clean graph — all readiness in [0,1]', () => {
  const graph = buildClean(full('A','a'), full('B','b',['a']));
  const r = check(graph);
  assertEqual(r.violations.filter(v => v.invariantId === 'INV-004').length, 0);
});

test('INV-004: detects readiness > 1', () => {
  const graph = buildClean(full('A','a'));
  graph.nodes.get('A').generationReadiness = 1.5;
  const r = check(graph);
  const v004 = r.violations.filter(v => v.invariantId === 'INV-004');
  assertEqual(v004.length, 1);
  assertEqual(v004[0].severity, 'critical');
});

test('INV-004: detects readiness < 0', () => {
  const graph = buildClean(full('A','a'));
  graph.nodes.get('A').generationReadiness = -0.1;
  const r = check(graph);
  const v004 = r.violations.filter(v => v.invariantId === 'INV-004');
  assertEqual(v004.length, 1);
  assertEqual(v004[0].severity, 'critical');
});

test('INV-004: detects NaN readiness', () => {
  const graph = buildClean(full('A','a'));
  graph.nodes.get('A').generationReadiness = NaN;
  const r = check(graph);
  assertEqual(r.violations.filter(v => v.invariantId === 'INV-004').length, 1);
});

// ── 6. INV-005 — BLACK semantic consistency ───────────────────────────────────

test('INV-005: BLACK node with readiness 0.0 passes', () => {
  const graph = build({ meta:{name:'t',version:'1'}, modules:[
    { id:'B', name:'b', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'ghost'}] },
  ]}).graph;
  // 'ghost' is a BLACK node with readiness 0.0 — should pass INV-005
  const r = check(graph);
  const v005 = r.violations.filter(v => v.invariantId === 'INV-005');
  assertEqual(v005.length, 0, `unexpected INV-005 violations: ${v005.map(v=>v.message)}`);
});

test('INV-005: detects BLACK node with non-zero readiness', () => {
  const graph = buildClean(full('A','a'));
  const node = graph.nodes.get('A');
  node.isBlack = true;
  node.confidence = 'BLACK';
  node.generationReadiness = 0.5; // corrupt
  const r = check(graph);
  const v005 = r.violations.filter(v => v.invariantId === 'INV-005' && v.severity === 'critical');
  assertEqual(v005.length, 1);
  assert(v005[0].message.includes('0.5'));
});

test('INV-005: detects confidence/isBlack flag mismatch', () => {
  const graph = buildClean(full('A','a'));
  const node = graph.nodes.get('A');
  node.confidence = 'BLACK';  // says BLACK but isBlack is false
  const r = check(graph);
  const v005 = r.violations.filter(v => v.invariantId === 'INV-005' && v.severity === 'warn');
  assertEqual(v005.length, 1);
});

// ── 7. INV-006 — Cycle convergence symmetry ───────────────────────────────────

test('INV-006: cycle A→B→C→A has equal readiness — passes', () => {
  const graph = build({ meta:{name:'t',version:'1'}, modules:[
    { id:'A',name:'a',description:'d',exports:['f()→R'],gate_pipeline:['G1'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'c'}] },
    { id:'B',name:'b',description:'d',exports:['g()→S'],gate_pipeline:['G2'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'a'}] },
    { id:'C',name:'c',description:'d',exports:['h()→T'],gate_pipeline:['G3'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'b'}] },
  ]}).graph;
  const r = check(graph);
  const v006 = r.violations.filter(v => v.invariantId === 'INV-006');
  assertEqual(v006.length, 0, `unexpected INV-006 violations: ${v006.map(v=>v.message)}`);
});

test('INV-006: detects asymmetric cycle readiness when both members still at 0.0 band', () => {
  // INV-006 scope: cycle groups where BOTH members are at readiness 0.0.
  // It catches divergence within that group — e.g., A=0.0 vs B=0.001.
  // Post-mutation drift where one member moves OUT of the zero band (e.g., 0.3)
  // is a different condition: INV-004 is satisfied (0.3 is in [0,1]), and INV-006
  // cannot detect it without full cycle identification independent of readiness.
  // This is a known scope limitation, documented here as a regression anchor.
  const graph = build({ meta:{name:'t',version:'1'}, modules:[
    { id:'A',name:'a',description:'d',exports:['f()→R'],gate_pipeline:['G1'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'b'}] },
    { id:'B',name:'b',description:'d',exports:['g()→S'],gate_pipeline:['G2'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'a'}] },
  ]}).graph;
  // Both are at 0.0 — now make them unequal within the zero group
  graph.nodes.get('A').generationReadiness = 0.004; // > 0.001 tolerance // still near zero but different
  graph.nodes.get('B').generationReadiness = 0.0;
  const r = check(graph);
  const v006 = r.violations.filter(v => v.invariantId === 'INV-006');
  assertEqual(v006.length, 1, 'expected 1 INV-006 warning for asymmetric values within cycle group');
  assertEqual(v006[0].severity, 'warn');
});

// ── 8. INV-007 — Topological build order (REGRESSION TEST) ───────────────────

test('INV-007: clean chain has valid build order', () => {
  const graph = buildClean(
    full('A','a'), full('B','b',['a']), full('C','c',['b'])
  );
  const r = check(graph);
  const v007 = r.violations.filter(v => v.invariantId === 'INV-007');
  assertEqual(v007.length, 0, `unexpected INV-007: ${v007.map(v=>v.message)}`);
});

test('INV-007: REGRESSION — pipeline before cortex-query was a real bug', () => {
  // This is the exact bug INV-007 caught on runtime.spec.
  // pipeline depends on cortex-query. Before the fix, getBuildOrder() sometimes
  // placed pipeline before cortex-query when both had equal readiness.
  // After the fix, deps always come before dependents at equal readiness.
  const graph = buildClean(
    full('A','a'),
    full('B','b',['a']),
    { id:'C', name:'c', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'a'},{name:'b'}] },
  );
  const r = check(graph);
  const v007 = r.violations.filter(v => v.invariantId === 'INV-007');
  assertEqual(v007.length, 0, `INV-007 regression: ${v007.map(v=>v.message)}`);

  // Verify A and B come before C in build order
  const order = graph.getBuildOrder().filter(n=>n.kind==='module').map(n=>n.name);
  assert(order.indexOf('a') < order.indexOf('c'), 'a must come before c');
  assert(order.indexOf('b') < order.indexOf('c'), 'b must come before c');
});

test('INV-007: detects manually corrupted build order', () => {
  const graph = buildClean(full('A','a'), full('B','b',['a']));
  // Override getBuildOrder to return wrong order (B before A, but B depends on A)
  graph.getBuildOrder = () => [graph.nodes.get('B'), graph.nodes.get('A')];
  const r = check(graph);
  const v007 = r.violations.filter(v => v.invariantId === 'INV-007');
  assertEqual(v007.length, 1);
  assertEqual(v007[0].severity, 'critical');
});

// ── 9. INV-008 — No self-referential blast radius ─────────────────────────────

test('INV-008: clean graph — no node in own blast radius', () => {
  const graph = buildClean(full('A','a'), full('B','b',['a']));
  const r = check(graph);
  assertEqual(r.violations.filter(v => v.invariantId === 'INV-008').length, 0);
});

test('INV-008: detects self in blastRadius', () => {
  const graph = buildClean(full('A','a'));
  const node = graph.nodes.get('A');
  node.blastRadius = [{ id: 'A', name: 'a', kind: 'module' }]; // self-reference
  const r = check(graph);
  const v008 = r.violations.filter(v => v.invariantId === 'INV-008');
  assertEqual(v008.length, 1);
  assertEqual(v008[0].severity, 'warn');
});

test('INV-008: missing blastRadius array → info violation, not critical', () => {
  const graph = buildClean(full('A','a'));
  graph.nodes.get('A').blastRadius = null; // missing
  const r = check(graph);
  const v008 = r.violations.filter(v => v.invariantId === 'INV-008');
  assertEqual(v008.length, 1);
  assertEqual(v008[0].severity, 'info');
});

// ── 10. Incremental checking ──────────────────────────────────────────────────

test('checkNode: returns violations for specific node', () => {
  const graph = buildClean(full('A','a'));
  const node = graph.nodes.get('A');
  node.generationReadiness = 1.5; // corrupt
  const violations = checkNode(node, graph);
  assert(violations.some(v => v.invariantId === 'INV-004'),
    'checkNode should catch INV-004 for out-of-bounds readiness');
});

test('checkEdges: returns violations for specific edges', () => {
  const graph = buildClean(full('A','a'));
  const badEdges = [{ from: 'PHANTOM', to: 'A', kind: 'depends_on' }];
  const violations = checkEdges(badEdges, graph.nodes);
  assert(violations.some(v => v.invariantId === 'INV-002'),
    'checkEdges should catch INV-002 for phantom source');
});

test('checkPropagation: returns only propagation violations', () => {
  const graph = buildClean(full('A','a'));
  graph.nodes.get('A').generationReadiness = -0.1;
  const violations = checkPropagation(graph);
  assert(violations.some(v => v.invariantId === 'INV-004'));
  // Should not include structural violations
  assert(!violations.some(v => v.invariantId === 'INV-001'));
});

// ── 11. runtime.spec integration ─────────────────────────────────────────────

test('INV: runtime.spec passes all invariants after build order fix', () => {
  const yaml = require('js-yaml');
  const fs   = require('fs');
  const { normalizeSpec, sanitizeSpec } = require('../compiler/emit');
  const raw = fs.readFileSync('./runtime.spec', 'utf-8');
  let doc; try { doc = yaml.load(raw); } catch(e) { doc = yaml.load(sanitizeSpec(raw)); }
  const { graph } = build(normalizeSpec(doc?.spec ?? doc));
  const r = check(graph);
  assert(r.isValid,
    `runtime.spec failed invariants: ${r.violations.map(v=>'['+v.invariantId+'] '+v.message).join('; ')}`);
});

// ── Report ────────────────────────────────────────────────────────────────────

console.log('\n\n  invariants.test.js');
console.log('  ' + p + ' passed  ' + f + ' failed');
if (f > 0) process.exit(1);
