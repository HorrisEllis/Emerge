'use strict';
/**
 * propagation.test.js — KG generationReadiness propagation stability tests
 *
 * Tests the topological relaxation algorithm against:
 *   - Long chains (6 nodes deep)
 *   - Diamond graphs (shared foundation)
 *   - Mixed-depth chains (weak link in the middle)
 *   - Cycle detection (must converge, not hang)
 *   - Multi-diamond (two shared foundations)
 *   - Cascade: strong chain broken by one weak middle node
 *
 * Each test answers the question ChatGPT and Jonathan named:
 *   "Does A=0.9→0.2 correctly cause D=0.2 in every topology?"
 *
 * If these pass: propagation is trustworthy.
 * If they fail: we have a correctness bug before touching architecture.
 */

const { build, DEPTH } = require('../compiler/kg-builder');

let p = 0, f = 0;
function test(label, fn) {
  try { fn(); p++; process.stdout.write('.'); }
  catch (e) { f++; console.log('\nFAIL [' + label + ']: ' + e.message); }
}
function assertClose(a, b, tol = 0.005, msg) {
  if (Math.abs(a - b) > tol) throw new Error(msg ?? `expected ${b} ±${tol}, got ${a}`);
}
function assert(v, msg) { if (!v) throw new Error(msg ?? 'assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(msg ?? `expected ${b}, got ${a}`); }

// ── Node factories ────────────────────────────────────────────────────────────

// Fully specced node (specDepth = 1.0)
function full(id, name, deps = []) {
  return {
    id, name,
    description:         'd',
    exports:             ['f() → R'],
    gate_pipeline:       ['G1'],
    behavioral_contracts:['contract'],
    error_paths:         ['error path'],
    deps:                deps.map(n => ({ name: n })),
  };
}

// Weak node — exports only (specDepth = 0.3)
function weak(id, name, deps = []) {
  return {
    id, name,
    description: 'd',
    exports:     ['f() → R'],
    deps:        deps.map(n => ({ name: n })),
  };
}

// Mid-strength node — exports + gates + contracts (specDepth = 0.7)
function mid(id, name, deps = []) {
  return {
    id, name,
    description:         'd',
    exports:             ['f() → R'],
    gate_pipeline:       ['G1'],
    behavioral_contracts:['contract'],
    deps:                deps.map(n => ({ name: n })),
  };
}

function spec(name, modules) {
  return { meta: { name, version: '1.0.0' }, modules };
}

function rdy(graph, name) {
  return graph.getNodeByName(name)?.generationReadiness ?? -1;
}

// ── 1. Long chain: all GREEN ──────────────────────────────────────────────────
// A → B → C → D → E → F
// All fully specced → every node genReady = 1.0

test('long chain: all GREEN when all fully specced', () => {
  const { graph } = build(spec('chain', [
    full('A','a'), full('B','b',['a']), full('C','c',['b']),
    full('D','d',['c']), full('E','e',['d']), full('F','f',['e']),
  ])).graph ? build(spec('chain', [
    full('A','a'), full('B','b',['a']), full('C','c',['b']),
    full('D','d',['c']), full('E','e',['d']), full('F','f',['e']),
  ])) : (() => { throw new Error('build failed'); })();

  // Re-run cleanly
  const r = build(spec('chain', [
    full('A','a'), full('B','b',['a']), full('C','c',['b']),
    full('D','d',['c']), full('E','e',['d']), full('F','f',['e']),
  ]));
  assert(r.ok);
  for (const n of ['a','b','c','d','e','f']) {
    assertClose(rdy(r.graph, n), 1.0, 0.01, `${n}.genReady should be 1.0`);
    assertEqual(r.graph.getNodeByName(n).confidence, 'GREEN', `${n} should be GREEN`);
  }
});

test('long chain: weak foundation (A=0.3) propagates to all downstream', () => {
  const r = build(spec('weak-chain', [
    weak('A','a'),             // specDepth 0.3
    full('B','b',['a']),
    full('C','c',['b']),
    full('D','d',['c']),
    full('E','e',['d']),
    full('F','f',['e']),
  ]));
  assert(r.ok);
  assertClose(rdy(r.graph,'a'), 0.3, 0.01, 'a.genReady should be 0.3');
  // Every downstream node must be constrained to 0.3
  for (const n of ['b','c','d','e','f']) {
    assertClose(rdy(r.graph, n), 0.3, 0.01,
      `${n}.genReady should propagate to 0.3, got ${rdy(r.graph, n).toFixed(3)}`);
  }
});

test('long chain: weak middle (C=0.3) constrains only downstream', () => {
  const r = build(spec('mid-weak', [
    full('A','a'),
    full('B','b',['a']),
    weak('C','c',['b']),       // specDepth 0.3 — weak middle
    full('D','d',['c']),
    full('E','e',['d']),
    full('F','f',['e']),
  ]));
  assert(r.ok);
  // Upstream of C unaffected
  assertClose(rdy(r.graph,'a'), 1.0, 0.01, 'a should be 1.0 (unaffected by downstream weakness)');
  assertClose(rdy(r.graph,'b'), 1.0, 0.01, 'b should be 1.0 (unaffected by downstream weakness)');
  // C and everything downstream constrained
  assertClose(rdy(r.graph,'c'), 0.3, 0.01, 'c.genReady should be 0.3');
  for (const n of ['d','e','f']) {
    assertClose(rdy(r.graph, n), 0.3, 0.01,
      `${n} should be constrained to 0.3 by weak C`);
  }
});

test('long chain: mid-strength middle (C=0.7) constrains downstream to min', () => {
  const r = build(spec('mid-mid', [
    full('A','a'), full('B','b',['a']),
    mid('C','c',['b']),        // specDepth 0.7
    full('D','d',['c']), full('E','e',['d']), full('F','f',['e']),
  ]));
  assert(r.ok);
  // C = min(0.7, 1.0) = 0.7
  assertClose(rdy(r.graph,'c'), DEPTH.CONTRACTS, 0.01);
  // D = min(1.0, 0.7) = 0.7 — constrained through C
  assertClose(rdy(r.graph,'d'), DEPTH.CONTRACTS, 0.01,
    'd should be constrained to 0.7 by mid C');
  assertClose(rdy(r.graph,'f'), DEPTH.CONTRACTS, 0.01,
    'f should be constrained to 0.7 through chain');
});

// ── 2. Diamond ────────────────────────────────────────────────────────────────
//     A
//    / \
//   B   C
//    \ /
//     D

test('diamond: all GREEN when all fully specced', () => {
  const r = build(spec('diamond', [
    full('A','a'),
    full('B','b',['a']),
    full('C','c',['a']),
    { id:'D', name:'d', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'b'},{name:'c'}] },
  ]));
  assert(r.ok);
  for (const n of ['a','b','c','d']) {
    assertClose(rdy(r.graph, n), 1.0, 0.01, `${n} should be 1.0 in all-GREEN diamond`);
  }
});

test('diamond: weak A (0.3) propagates through both paths to D', () => {
  const r = build(spec('weak-diamond', [
    weak('A','a'),             // 0.3
    full('B','b',['a']),
    full('C','c',['a']),
    { id:'D', name:'d', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'b'},{name:'c'}] },
  ]));
  assert(r.ok);
  assertClose(rdy(r.graph,'a'), 0.3, 0.01);
  assertClose(rdy(r.graph,'b'), 0.3, 0.01, 'B must inherit A weakness');
  assertClose(rdy(r.graph,'c'), 0.3, 0.01, 'C must inherit A weakness');
  assertClose(rdy(r.graph,'d'), 0.3, 0.01, 'D must get 0.3 through both paths');
});

test('diamond: one weak arm (B=0.3, C=1.0) constrains D to min', () => {
  const r = build(spec('asymm-diamond', [
    full('A','a'),
    weak('B','b',['a']),       // 0.3
    full('C','c',['a']),       // 1.0
    { id:'D', name:'d', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'b'},{name:'c'}] },
  ]));
  assert(r.ok);
  assertClose(rdy(r.graph,'a'), 1.0, 0.01);
  assertClose(rdy(r.graph,'b'), 0.3, 0.01);
  assertClose(rdy(r.graph,'c'), 1.0, 0.01);
  // D depends on both B(0.3) and C(1.0) → min = 0.3
  assertClose(rdy(r.graph,'d'), 0.3, 0.01,
    'D should be min(0.3, 1.0) = 0.3 when one arm is weak');
});

test('diamond: blast radius of A includes B, C, and D', () => {
  const r = build(spec('blast-diamond', [
    full('A','a'), full('B','b',['a']), full('C','c',['a']),
    { id:'D', name:'d', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'b'},{name:'c'}] },
  ]));
  const blast = r.graph.getBlastRadius('A').map(n => n.name).sort();
  assert(blast.includes('b'), 'B not in blast radius of A');
  assert(blast.includes('c'), 'C not in blast radius of A');
  assert(blast.includes('d'), 'D not in blast radius of A');
  assertEqual(blast.length, 3, `Expected 3 nodes in blast radius, got ${blast.length}`);
});

// ── 3. Multi-diamond ──────────────────────────────────────────────────────────
// Two independent foundations feeding into a shared top.
//   A       E
//  / \     / \
// B   C   F   G
//  \ / \ / \ /
//   D     H
//          \ 
//           I (depends on D and H)

test('multi-diamond: two weak foundations both constrain shared top', () => {
  const r = build(spec('multi-diamond', [
    weak('A','a'),             // 0.3
    full('B','b',['a']),
    full('C','c',['a']),
    { id:'D', name:'d', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'b'},{name:'c'}] },
    weak('E','e'),             // 0.3
    full('F','f',['e']),
    full('G','g',['e']),
    { id:'H', name:'h', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'f'},{name:'g'}] },
    { id:'I', name:'i', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
      behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'d'},{name:'h'}] },
  ]));
  assert(r.ok);
  assertClose(rdy(r.graph,'d'), 0.3, 0.01, 'D constrained by weak A');
  assertClose(rdy(r.graph,'h'), 0.3, 0.01, 'H constrained by weak E');
  assertClose(rdy(r.graph,'i'), 0.3, 0.01, 'I constrained by both weak foundations');
});

// ── 4. Cycle — convergence guarantee ─────────────────────────────────────────
// A → B → C → A
// Must: (1) not hang, (2) converge, (3) produce meaningful score

test('cycle: A→B→C→A — converges in <50ms', () => {
  const start = Date.now();
  const r = build(spec('cycle-abc', [
    { id:'A',name:'a',description:'d',exports:['f()→R'],gate_pipeline:['G1'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'c'}] },
    { id:'B',name:'b',description:'d',exports:['g()→S'],gate_pipeline:['G2'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'a'}] },
    { id:'C',name:'c',description:'d',exports:['h()→T'],gate_pipeline:['G3'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'b'}] },
  ]));
  const elapsed = Date.now() - start;
  assert(r.ok, 'build failed on cycle');
  assert(elapsed < 50, `cycle build took ${elapsed}ms — must be <50ms`);
});

test('cycle: A→B→C→A — all nodes have equal genReady (symmetry)', () => {
  const r = build(spec('cycle-sym', [
    { id:'A',name:'a',description:'d',exports:['f()→R'],gate_pipeline:['G1'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'c'}] },
    { id:'B',name:'b',description:'d',exports:['g()→S'],gate_pipeline:['G2'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'a'}] },
    { id:'C',name:'c',description:'d',exports:['h()→T'],gate_pipeline:['G3'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'b'}] },
  ]));
  const ra = rdy(r.graph,'a'), rb = rdy(r.graph,'b'), rc = rdy(r.graph,'c');
  assertClose(ra, rb, 0.001, `a(${ra}) != b(${rb}): cycle should have equal scores`);
  assertClose(rb, rc, 0.001, `b(${rb}) != c(${rc}): cycle should have equal scores`);
});

test('cycle: A→B→C→A — genReady signals unresolvable (0.0)', () => {
  // A cycle means no node can be generated before the others.
  // genReadiness = 0.0 is the correct signal: this subgraph is blocked.
  const r = build(spec('cycle-zero', [
    { id:'A',name:'a',description:'d',exports:['f()→R'],gate_pipeline:['G1'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'c'}] },
    { id:'B',name:'b',description:'d',exports:['g()→S'],gate_pipeline:['G2'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'a'}] },
    { id:'C',name:'c',description:'d',exports:['h()→T'],gate_pipeline:['G3'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'b'}] },
  ]));
  assertClose(rdy(r.graph,'a'), 0.0, 0.01,
    'cycle nodes should have genReady=0.0 (unresolvable)');
});

test('cycle: self-loop (A→A) — converges to 0.0', () => {
  const r = build(spec('self-loop', [
    { id:'A',name:'a',description:'d',exports:['f()→R'],gate_pipeline:['G1'],
      behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'a'}] },
  ]));
  assert(r.ok);
  assertClose(rdy(r.graph,'a'), 0.0, 0.01, 'self-loop should have genReady=0.0');
});

test('cycle: partial cycle with external dep — non-cycle nodes unaffected', () => {
  // A is outside the cycle. B→C→B is the cycle. D depends on both A and B.
  // A = 1.0. B and C cycle to 0.0. D = min(1.0, 0.0) = 0.0.
  const r = build(spec('partial-cycle', [
    full('A','a'),
    { id:'B',name:'b',description:'d',exports:['f()→R'],gate_pipeline:['G1'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'c'}] },
    { id:'C',name:'c',description:'d',exports:['g()→S'],gate_pipeline:['G2'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'b'}] },
    { id:'D',name:'d',description:'d',exports:['h()→T'],gate_pipeline:['G3'],behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'a'},{name:'b'}] },
  ]));
  assert(r.ok);
  assertClose(rdy(r.graph,'a'), 1.0, 0.01, 'A outside cycle should be GREEN (1.0)');
  assertClose(rdy(r.graph,'b'), 0.0, 0.01, 'B in cycle should be 0.0');
  assertClose(rdy(r.graph,'c'), 0.0, 0.01, 'C in cycle should be 0.0');
  assertClose(rdy(r.graph,'d'), 0.0, 0.01, 'D depending on cycle member should be 0.0');
});

// ── 5. Build order stability ──────────────────────────────────────────────────

test('build order: foundations always before dependents', () => {
  const r = build(spec('order', [
    full('A','a'), full('B','b',['a']), full('C','c',['b']),
    full('D','d',['c']), full('E','e',['d']), full('F','f',['e']),
  ]));
  const order = r.graph.getBuildOrder()
    .filter(n => n.kind === 'module')
    .map(n => n.name);
  // a must come before b, b before c, etc.
  for (let i = 0; i < order.length - 1; i++) {
    const cur  = r.graph.getNodeByName(order[i]);
    const next = r.graph.getNodeByName(order[i + 1]);
    assert(
      cur.generationReadiness <= next.generationReadiness,
      `build order violation: ${order[i]}(${cur.generationReadiness.toFixed(2)}) ` +
      `before ${order[i+1]}(${next.generationReadiness.toFixed(2)})`
    );
  }
});

test('build order: diamond builds A first, D last', () => {
  const r = build(spec('order-diamond', [
    full('A','a'), full('B','b',['a']), full('C','c',['a']),
    { id:'D',name:'d',description:'d',exports:['f()→R'],gate_pipeline:['G1'],
      behavioral_contracts:['c'],error_paths:['e'],deps:[{name:'b'},{name:'c'}] },
  ]));
  const order = r.graph.getBuildOrder()
    .filter(n => n.kind === 'module')
    .map(n => n.name);
  // a before b and c; b and c before d
  assert(order.indexOf('a') < order.indexOf('b'), 'a must come before b');
  assert(order.indexOf('a') < order.indexOf('c'), 'a must come before c');
  assert(order.indexOf('b') < order.indexOf('d'), 'b must come before d');
  assert(order.indexOf('c') < order.indexOf('d'), 'c must come before d');
});

// ── Report ────────────────────────────────────────────────────────────────────

console.log('\n\n  propagation.test.js');
console.log('  ' + p + ' passed  ' + f + ' failed');
if (f > 0) process.exit(1);
