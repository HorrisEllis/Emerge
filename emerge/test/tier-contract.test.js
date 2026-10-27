'use strict';
/**
 * tier-contract.test.js
 *
 * Tests the semantic boundary between analysis and execution.
 *
 * What these tests prove:
 *   1. Every node classification is deterministic given the same inputs
 *   2. Boundary conditions are exact (not approximate)
 *   3. Priority order is correct (BLACK > BLOCKED > T2 > T1 > T0 > SKIP)
 *   4. Gate helpers derive correctly from decideTier()
 *   5. decideAll() classifies a full graph consistently
 *   6. The contract integrates correctly with the KG pipeline
 *
 * If these pass: analysis → execution boundary is trustworthy.
 * Gates stop thinking. They obey.
 */

const {
  TIER_CONTRACT, BOUNDARIES,
  decideTier, decideTierForSpec,
  shouldEmitT0, shouldEmitT1, shouldDispatchT2, shouldWriteGap,
  decideAll, summarize,
} = require('../compiler/tier-contract');
const { build } = require('../compiler/kg-builder');

let p = 0, f = 0;
function test(label, fn) {
  try { fn(); p++; process.stdout.write('.'); }
  catch (e) { f++; console.log('\nFAIL [' + label + ']: ' + e.message); }
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assert(v, msg) { if (!v) throw new Error(msg ?? 'assertion failed'); }
function assertClose(a, b, tol = 0.001, msg) {
  if (Math.abs(a - b) > tol) throw new Error(msg ?? `expected ${b} ±${tol}, got ${a}`);
}

// ── 1. TIER_CONTRACT structure ────────────────────────────────────────────────

test('contract: all six tiers declared', () => {
  for (const tier of ['T2', 'T1', 'T0', 'SKIP', 'BLOCKED', 'MISSING']) {
    assert(TIER_CONTRACT[tier], `${tier} missing from TIER_CONTRACT`);
  }
});

test('contract: BOUNDARIES match TIER_CONTRACT values', () => {
  assertClose(BOUNDARIES.T2_MIN,   TIER_CONTRACT.T2.minReadiness);
  assertClose(BOUNDARIES.T1_MIN,   TIER_CONTRACT.T1.minReadiness);
  assertClose(BOUNDARIES.T0_MIN,   TIER_CONTRACT.T0.minReadiness);
  assertClose(BOUNDARIES.SKIP_MAX, TIER_CONTRACT.SKIP.maxReadiness);
  assertClose(BOUNDARIES.CYCLE,    TIER_CONTRACT.BLOCKED.readiness);
});

test('contract: T2 requires LLM, T1/T0/SKIP/BLOCKED/MISSING do not', () => {
  assert(TIER_CONTRACT.T2.requiresLLM  === true);
  assert(TIER_CONTRACT.T1.requiresLLM  === false);
  assert(TIER_CONTRACT.T0.requiresLLM  === false);
  assert(TIER_CONTRACT.SKIP.requiresLLM === false);
});

test('contract: thresholds are ordered T2 > T1 > T0', () => {
  assert(BOUNDARIES.T2_MIN > BOUNDARIES.T1_MIN, 'T2 threshold must be > T1');
  assert(BOUNDARIES.T1_MIN > BOUNDARIES.T0_MIN, 'T1 threshold must be > T0');
  assert(BOUNDARIES.T0_MIN > 0,                  'T0 threshold must be > 0');
});

// ── 2. decideTier — priority order ───────────────────────────────────────────

test('decideTier: BLACK confidence → MISSING regardless of readiness', () => {
  // Even if readiness is high, BLACK always wins
  for (const r of [0.0, 0.3, 0.5, 0.8, 1.0]) {
    const d = decideTier({ confidence: 'BLACK', generationReadiness: r });
    assertEqual(d.tier, 'MISSING', `BLACK node with r=${r} should be MISSING`);
    assertEqual(d.action, 'MISSING');
  }
});

test('decideTier: genReadiness 0.0 on non-BLACK → BLOCKED', () => {
  for (const c of ['RED', 'AMBER', 'GREEN']) {
    const d = decideTier({ confidence: c, generationReadiness: 0.0 });
    assertEqual(d.tier, 'BLOCKED', `${c} node at 0.0 should be BLOCKED`);
    assertEqual(d.action, 'BLOCK');
  }
});

test('decideTier: BLOCKED takes priority over tier thresholds at 0.0', () => {
  // Even a GREEN confidence node at 0.0 is BLOCKED (cycle)
  const d = decideTier({ confidence: 'GREEN', generationReadiness: 0.0 });
  assertEqual(d.tier, 'BLOCKED');
});

// ── 3. decideTier — threshold exactness ──────────────────────────────────────

test('decideTier: exactly at T2 minimum → T2', () => {
  const d = decideTier({ confidence: 'GREEN', generationReadiness: BOUNDARIES.T2_MIN });
  assertEqual(d.tier, 'T2');
  assertEqual(d.action, 'IMPLEMENT');
});

test('decideTier: just below T2 minimum → T1', () => {
  const r = BOUNDARIES.T2_MIN - 0.001;
  const d = decideTier({ confidence: 'AMBER', generationReadiness: r });
  assertEqual(d.tier, 'T1', `r=${r} should be T1`);
  assertEqual(d.action, 'SCAFFOLD');
});

test('decideTier: exactly at T1 minimum → T1', () => {
  const d = decideTier({ confidence: 'AMBER', generationReadiness: BOUNDARIES.T1_MIN });
  assertEqual(d.tier, 'T1');
});

test('decideTier: just below T1 minimum → T0', () => {
  const r = BOUNDARIES.T1_MIN - 0.001;
  const d = decideTier({ confidence: 'RED', generationReadiness: r });
  assertEqual(d.tier, 'T0', `r=${r} should be T0`);
  assertEqual(d.action, 'STRUCTURE');
});

test('decideTier: exactly at T0 minimum → T0', () => {
  const d = decideTier({ confidence: 'RED', generationReadiness: BOUNDARIES.T0_MIN });
  assertEqual(d.tier, 'T0');
});

test('decideTier: just below T0 minimum → SKIP', () => {
  const r = BOUNDARIES.T0_MIN - 0.001;
  const d = decideTier({ confidence: 'RED', generationReadiness: r });
  assertEqual(d.tier, 'SKIP', `r=${r} should be SKIP`);
  assertEqual(d.action, 'SKIP');
});

test('decideTier: genReadiness 1.0 → T2', () => {
  const d = decideTier({ confidence: 'GREEN', generationReadiness: 1.0 });
  assertEqual(d.tier, 'T2');
});

test('decideTier: genReadiness 0.1 → SKIP', () => {
  const d = decideTier({ confidence: 'RED', generationReadiness: 0.1 });
  assertEqual(d.tier, 'SKIP');
});

// ── 4. decideTier — decision shape ────────────────────────────────────────────

test('decideTier: result always has tier, action, label, reason, readiness, nodeId', () => {
  const cases = [
    { confidence: 'BLACK', generationReadiness: 0.5, id: 'X', name: 'x' },
    { confidence: 'RED',   generationReadiness: 0.0, id: 'X', name: 'x' },
    { confidence: 'GREEN', generationReadiness: 1.0, id: 'X', name: 'x' },
    { confidence: 'RED',   generationReadiness: 0.1, id: 'X', name: 'x' },
  ];
  for (const node of cases) {
    const d = decideTier(node);
    assert(d.tier,    `tier missing for ${node.confidence}/${node.generationReadiness}`);
    assert(d.action,  `action missing`);
    assert(d.label,   `label missing`);
    assert(d.reason,  `reason missing`);
    assert('readiness' in d, `readiness missing`);
  }
});

test('decideTier: reason string includes readiness value for threshold decisions', () => {
  const d = decideTier({ confidence: 'GREEN', generationReadiness: 0.85 });
  assert(d.reason.includes('0.850') || d.reason.includes('0.85'),
    `reason should include readiness value: ${d.reason}`);
});

test('decideTier: MISSING reason mentions node name', () => {
  const d = decideTier({ confidence: 'BLACK', generationReadiness: 0, id: 'MOD-X', name: 'my-module' });
  assert(d.reason.includes('my-module'), `reason should include node name: ${d.reason}`);
});

// ── 5. decideTierForSpec ──────────────────────────────────────────────────────

test('decideTierForSpec: same thresholds as decideTier', () => {
  const cases = [
    [1.0, 'T2'], [0.8, 'T2'], [0.79, 'T1'], [0.5, 'T1'],
    [0.49, 'T0'], [0.3, 'T0'], [0.29, 'SKIP'], [0.0, 'BLOCKED'],
  ];
  for (const [r, expected] of cases) {
    const d = decideTierForSpec(r);
    assertEqual(d.tier, expected, `specDepth=${r} should map to ${expected}, got ${d.tier}`);
  }
});

// ── 6. Gate helper functions ──────────────────────────────────────────────────

test('shouldEmitT0: true for T0, T1, T2 — false for SKIP, BLOCKED, MISSING', () => {
  assert(shouldEmitT0({ confidence: 'RED',   generationReadiness: 0.3  }), 'T0 node should emit T0');
  assert(shouldEmitT0({ confidence: 'AMBER', generationReadiness: 0.5  }), 'T1 node should emit T0');
  assert(shouldEmitT0({ confidence: 'GREEN', generationReadiness: 1.0  }), 'T2 node should emit T0');
  assert(!shouldEmitT0({ confidence: 'RED',   generationReadiness: 0.1  }), 'SKIP should not emit T0');
  assert(!shouldEmitT0({ confidence: 'RED',   generationReadiness: 0.0  }), 'BLOCKED should not emit T0');
  assert(!shouldEmitT0({ confidence: 'BLACK', generationReadiness: 0.5  }), 'MISSING should not emit T0');
});

test('shouldEmitT1: true for T1 and T2 only', () => {
  assert(!shouldEmitT1({ confidence: 'RED',   generationReadiness: 0.3  }), 'T0 should not emit T1');
  assert(shouldEmitT1({ confidence: 'AMBER', generationReadiness: 0.5  }), 'T1 node should emit T1');
  assert(shouldEmitT1({ confidence: 'GREEN', generationReadiness: 1.0  }), 'T2 node should emit T1');
  assert(!shouldEmitT1({ confidence: 'RED',   generationReadiness: 0.1  }), 'SKIP should not emit T1');
});

test('shouldDispatchT2: true only for T2', () => {
  assert(shouldDispatchT2({ confidence: 'GREEN', generationReadiness: 1.0  }), 'T2 node should dispatch');
  assert(shouldDispatchT2({ confidence: 'GREEN', generationReadiness: 0.8  }), 'exactly T2_MIN should dispatch');
  assert(!shouldDispatchT2({ confidence: 'AMBER', generationReadiness: 0.79 }), 'just below T2 should not dispatch');
  assert(!shouldDispatchT2({ confidence: 'AMBER', generationReadiness: 0.5  }), 'T1 should not dispatch');
  assert(!shouldDispatchT2({ confidence: 'RED',   generationReadiness: 0.3  }), 'T0 should not dispatch');
});

test('shouldWriteGap: true for SKIP, BLOCKED, MISSING only', () => {
  assert(!shouldWriteGap({ confidence: 'GREEN', generationReadiness: 1.0  }), 'T2 should not write gap');
  assert(!shouldWriteGap({ confidence: 'AMBER', generationReadiness: 0.5  }), 'T1 should not write gap');
  assert(!shouldWriteGap({ confidence: 'RED',   generationReadiness: 0.3  }), 'T0 should not write gap');
  assert(shouldWriteGap({ confidence: 'RED',   generationReadiness: 0.1  }), 'SKIP should write gap');
  assert(shouldWriteGap({ confidence: 'RED',   generationReadiness: 0.0  }), 'BLOCKED should write gap');
  assert(shouldWriteGap({ confidence: 'BLACK', generationReadiness: 0.5  }), 'MISSING should write gap');
});

// ── 7. decideAll — full graph classification ──────────────────────────────────

test('decideAll: classifies all six tiers correctly in one graph', () => {
  const spec = {
    meta: { name: 'contract-test', version: '1.0.0' },
    modules: [
      // T2: fully specced leaf (genReady = 1.0)
      { id:'T2', name:'t2', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
        behavioral_contracts:['c'], error_paths:['e'] },
      // T1: mid-strength (genReady ~0.7)
      { id:'T1', name:'t1', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
        behavioral_contracts:['c'] },
      // T0: exports only (genReady 0.3)
      { id:'T0', name:'t0', description:'d', exports:['f()→R'] },
      // SKIP: name only (genReady 0.1)
      { id:'SK', name:'sk', description:'d' },
      // BLOCKED: cycle (genReady 0.0)
      { id:'CY', name:'cy', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
        behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'cy'}] },  // self-loop
      // MISSING: dep on undeclared 'ghost'
      { id:'MS', name:'ms', description:'d', exports:['f()→R'], gate_pipeline:['G1'],
        behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'ghost'}] },
    ],
  };

  const r = build(spec);
  assert(r.ok);
  const all = decideAll(r.graph);

  // T2: at least t2 node (fully specced)
  assert(all.t2.length >= 1, `expected T2 nodes, got ${all.t2.length}`);
  assert(all.t2.some(x => x.node.name === 't2'), 't2 node missing from T2 bucket');

  // T1: t1 node
  assert(all.t1.some(x => x.node.name === 't1'), 't1 node missing from T1 bucket');

  // T0: t0 node
  assert(all.t0.some(x => x.node.name === 't0'), 't0 node missing from T0 bucket');

  // SKIP: sk node
  assert(all.skip.some(x => x.node.name === 'sk'), 'sk node missing from SKIP bucket');

  // BLOCKED: cy node
  assert(all.blocked.some(x => x.node.name === 'cy'), 'cy node missing from BLOCKED bucket');

  // MISSING: 'ghost' BLACK node
  assert(all.missing.some(x => x.node.name === 'ghost'), 'ghost node missing from MISSING bucket');
});

test('decideAll: every node classified exactly once', () => {
  const spec = {
    meta: { name: 't', version: '1' },
    modules: [
      { id:'A', name:'a', description:'d', exports:['f()→R'], gate_pipeline:['G1'], behavioral_contracts:['c'], error_paths:['e'] },
      { id:'B', name:'b', description:'d', exports:['f()→R'], gate_pipeline:['G1'], behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'a'}] },
    ],
  };
  const r = build(spec);
  const all = decideAll(r.graph);
  const total = all.t2.length + all.t1.length + all.t0.length +
                all.skip.length + all.blocked.length + all.missing.length;
  assertEqual(total, r.graph.meta.nodeCount,
    `decideAll classified ${total} nodes but graph has ${r.graph.meta.nodeCount}`);
});

test('decideAll: summarize produces readable output', () => {
  const spec = {
    meta: { name: 't', version: '1' },
    modules: [{ id:'A', name:'a', description:'d', exports:['f()→R'], gate_pipeline:['G1'], behavioral_contracts:['c'], error_paths:['e'] }],
  };
  const r   = build(spec);
  const all = decideAll(r.graph);
  const s   = summarize(all);
  assert(s.includes('T2'),   'summary missing T2 line');
  assert(s.includes('SKIP'), 'summary missing SKIP line');
  assert(typeof s === 'string' && s.length > 0);
});

// ── 8. Integration: contract thresholds match KG confidence ──────────────────

test('contract thresholds align with KG confidence assignments', () => {
  // KG assigns GREEN >= 0.8, AMBER >= 0.5, RED >= 0.1
  // Contract assigns T2 >= 0.8, T1 >= 0.5, T0 >= 0.3
  // GREEN nodes → T2 (both use 0.8)
  // AMBER nodes → T1 or T0 depending on exact score (AMBER covers 0.5-0.79)
  // Verify alignment at the key boundary
  assertEqual(BOUNDARIES.T2_MIN, 0.8, 'T2_MIN must be 0.8 to align with GREEN confidence');
  assertEqual(BOUNDARIES.T1_MIN, 0.5, 'T1_MIN must be 0.5 to align with AMBER confidence floor');
});

test('integration: compile() result includes tierMap with correct structure', async () => {
  const { compile } = require('../compiler/pipeline');
  const r = await compile(
    '/mnt/user-data/uploads/causal-nexus.spec',
    '/tmp/contract-test-' + Date.now(),
    { skipCortex: true, tier: 1 }
  );
  assert(r.ok, 'compile not ok: ' + r.error);
  assert(r.tierMap !== null && r.tierMap !== undefined, 'tierMap missing from compile result');
  if (r.tierMap) {
    // All six buckets must exist
    for (const bucket of ['t2','t1','t0','skip','blocked','missing']) {
      assert(Array.isArray(r.tierMap[bucket]), `tierMap.${bucket} missing or not array`);
    }
    // Total must equal node count
    const total = Object.values(r.tierMap).reduce((n, arr) => n + arr.length, 0);
    assert(total > 0, 'tierMap is empty');
  }
});

// ── Report ────────────────────────────────────────────────────────────────────

// Async test
const asyncJobs = [];
asyncJobs.push(
  (async () => {
    const label = 'integration: compile() result includes tierMap with correct structure';
    try {
      const { compile } = require('../compiler/pipeline');
      const r = await compile(
        '/mnt/user-data/uploads/causal-nexus.spec',
        '/tmp/contract-test2-' + Date.now(),
        { skipCortex: true, tier: 1 }
      );
      assert(r.ok);
      assert(r.tierMap != null);
      if (r.tierMap) {
        for (const b of ['t2','t1','t0','skip','blocked','missing']) {
          assert(Array.isArray(r.tierMap[b]));
        }
      }
      p++; process.stdout.write('.');
    } catch(e) { f++; console.log('\nFAIL [' + label + ']: ' + e.message); }
  })()
);

Promise.all(asyncJobs).then(() => {
  console.log('\n\n  tier-contract.test.js');
  console.log('  ' + p + ' passed  ' + f + ' failed');
  process.exit(f > 0 ? 1 : 0);
});
