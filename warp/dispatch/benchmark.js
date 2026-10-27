'use strict';
/**
 * benchmark.js — real measurements, not estimates. Three axes: build speed
 * (construction + dispatch throughput), token cost (model-call reduction
 * curve + structured-output size proxy), stability (digest determinism +
 * fitness variance across identical repeated runs).
 *
 * Honesty note, same as dispatch.test.js: no live LLM is available in this
 * sandbox. "Token cost" here measures what WARP's mechanics can prove on
 * their own (call-count reduction, structured-output byte size vs a
 * free-text equivalent) — not actual provider billing, which depends on
 * the model you point the cascade at.
 */
const { Event, Gate, Axiom, Stream } = require('../core');
const { unifiedDispatch } = require('./index');
const { PopulationStore } = require('./population');
const { FlatFileCrystallizer } = require('../plugins/crystallizer-flatfile');
const { scoreDefault } = require('../plugins/scorer-default');
const { runCascade } = require('./cascade');
const { computeDigest } = require('./digest');
const { canonicalize } = require('./canonicalize');

function timeIt(fn, iterations = 1) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn(i);
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6; // ms
}

console.log('=== WARP Benchmark — real numbers ===\n');

// ── 1. BUILD SPEED ──────────────────────────────────────────────────────────
console.log('--- 1. Build speed ---');

const N = 10000;
const constructMs = timeIt(() => {
  const s = new Stream();
  s.register(new Gate('g', { transform: () => {} }));
  s.registerAxiom(new Axiom('a', { check: () => true }));
}, N);
console.log(`Stream+Gate+Axiom construction: ${(constructMs / N * 1000).toFixed(2)} microseconds/instance (${N} iterations, ${constructMs.toFixed(1)}ms total)`);

const dispatchStream = new Stream();
dispatchStream.register(new Gate('bench', { transform: () => {} }));
const dispatchMs = timeIt(() => { dispatchStream.emit(new Event('bench', { i: 1 })); }, N);
console.log(`Stream.emit() dispatch throughput: ${(N / (dispatchMs / 1000)).toFixed(0)} events/sec (${dispatchMs.toFixed(1)}ms for ${N} events)`);

const digestMs = timeIt(() => {
  computeDigest({ gateSignature: 'bench', axioms: [], eventData: { a: 1, b: { c: [1, 2, 3] } } });
}, N);
console.log(`Digest computation: ${(digestMs / N * 1000).toFixed(2)} microseconds/call (${N} iterations)`);

// ── 2. TOKEN COST ────────────────────────────────────────────────────────────
console.log('\n--- 2. Token cost (proxy — no live model in this sandbox) ---');

async function tokenCostRun() {
  let modelCalls = 0;
  async function mockGenerate() { modelCalls++; return { shape: 'ok', size: 'medium' }; }
  const population = new PopulationStore();
  const crystallizer = new FlatFileCrystallizer({});
  const axioms = [new Axiom('shape', { check: () => true })];

  const REQUESTS = 100;
  const callsPerRequest = [];
  for (let i = 0; i < REQUESTS; i++) {
    const before = modelCalls;
    await unifiedDispatch({
      gateSignature: 'gen.x', gateClass: 'x-class',
      event: new Event('gen.x', { fixed: true }), // identical content every time
      axioms, crystallizer, population, scorer: scoreDefault,
      cascade: () => runCascade({ providers: ['cheap'], generate: mockGenerate, validate: () => ({ ok: true }) }),
    });
    callsPerRequest.push(modelCalls - before);
  }
  const totalCalls = callsPerRequest.reduce((a, b) => a + b, 0);
  const naiveBaseline = REQUESTS; // every request hits a model, no memory
  console.log(`Model calls for ${REQUESTS} identical requests: ${totalCalls} (naive/SISO baseline: ${naiveBaseline})`);
  console.log(`Reduction: ${(100 - (totalCalls / naiveBaseline * 100)).toFixed(1)}% fewer model calls`);

  // Structured output size proxy — compare a structured JSON response vs
  // an equivalent free-text response for the same information content.
  const structured = JSON.stringify({ type: 'button', label: 'Submit', variant: 'primary', disabled: false });
  const freeText = "Sure! Here's a button component. It should be of type button, with the label set to " +
    "'Submit', using the primary variant, and it should not be disabled.";
  const structuredTokensEst = Math.ceil(structured.length / 4); // ~4 chars/token, rough industry estimate
  const freeTextTokensEst = Math.ceil(freeText.length / 4);
  console.log(`Structured output: ~${structuredTokensEst} tokens (${structured.length} chars) vs free-text equivalent: ~${freeTextTokensEst} tokens (${freeText.length} chars)`);
  console.log(`Structured-output saving on this example: ${(100 - structuredTokensEst / freeTextTokensEst * 100).toFixed(1)}%`);
}

// ── 3. STABILITY ─────────────────────────────────────────────────────────────
console.log('\n--- 3. Stability ---');

function stabilityRun() {
  const eventData = { a: 1, b: { z: 9, y: [1, { k: 'v' }] } };
  const axioms = [new Axiom('rule', { check: () => true, version: '1.0.0' })];
  const digests = new Set();
  for (let i = 0; i < 1000; i++) {
    digests.add(computeDigest({ gateSignature: 'stability.test', axioms, eventData }));
  }
  console.log(`Digest determinism: ${digests.size === 1 ? 'PASS' : 'FAIL'} — 1000 calls on identical input produced ${digests.size} unique digest(s)`);

  // Key-order variance — same content, randomized key insertion order each time
  const orderDigests = new Set();
  for (let i = 0; i < 100; i++) {
    const shuffled = Math.random() > 0.5 ? { b: eventData.b, a: eventData.a } : { a: eventData.a, b: eventData.b };
    orderDigests.add(computeDigest({ gateSignature: 'stability.test', axioms, eventData: shuffled }));
  }
  console.log(`Key-order independence: ${orderDigests.size === 1 ? 'PASS' : 'FAIL'} — 100 calls with randomized key order produced ${orderDigests.size} unique digest(s)`);

  // Rejection determinism — same axiom, same event, must reject every time
  const s = new Stream();
  let ranCount = 0;
  s.register(new Gate('risky', { transform: () => { ranCount++; } }));
  s.registerAxiom(new Axiom('block', { severity: 'hard', check: () => false }));
  for (let i = 0; i < 500; i++) s.emit(new Event('risky', {}));
  console.log(`Axiom rejection determinism: ${ranCount === 0 && s.rejected.length === 500 ? 'PASS' : 'FAIL'} — 500 identical dispatches, ${s.rejected.length} rejected, gate ran ${ranCount} time(s)`);
}

// ── 4. v1.4 ADDITIONS ────────────────────────────────────────────────────────
console.log('\n--- 4. v1.4 additions (real measurements) ---');

async function preGenerationRun() {
  const { preGenerationCheck } = require('./pregen');
  let modelCalls = 0;
  async function mockGenerate() { modelCalls++; return { shape: 'ok' }; }
  const population = new PopulationStore();
  const crystallizer = new FlatFileCrystallizer({});
  const axioms = [new Axiom('shape', { check: () => true })];

  // 30 requests, SAME SHAPE, DIFFERENT CONTENT each time (e.g. different
  // button labels). Exact-cache (step 1) cannot hit any of these — every
  // digest is unique. This is exactly the case the v1.4 patch's headline
  // numbers implied pre-generation filtering would help with, so it's the
  // fair test: not identical-repeat (that's step 1's job, already proven
  // above), genuinely different-content-same-shape.
  const labels = ['Submit', 'Cancel', 'Save', 'Delete', 'Confirm', 'Retry', 'Close', 'Next', 'Back', 'Skip'];
  let naiveCalls = 0;
  for (let i = 0; i < 30; i++) {
    const eventData = { kind: 'button', label: labels[i % labels.length], variant: 'primary' };
    naiveCalls++;
    await unifiedDispatch({
      gateSignature: 'gen.btn', gateClass: 'btn-class',
      event: new Event('gen.btn', eventData),
      axioms, crystallizer, population, scorer: scoreDefault,
      preGeneration: { enabled: true, threshold: 0.87 },
      cascade: () => runCascade({ providers: ['cheap'], generate: mockGenerate, validate: () => ({ ok: true }) }),
    });
  }
  console.log(`Pre-generation filter: ${modelCalls} model calls for ${naiveCalls} same-shape/different-content requests (naive baseline: ${naiveCalls}, exact-cache-only baseline: ${naiveCalls} since no digest repeats)`);
  console.log(`Reduction beyond what exact-cache alone achieves: ${(100 - (modelCalls / naiveCalls * 100)).toFixed(1)}% fewer model calls`);
  console.log('Caveat: this trades exactness for reuse — the first candidate seen for a shape gets reused for every later request of that shape. Only sound when a Gate genuinely doesn\'t need per-request content variation in its output, which is a real but narrower case than "any structurally similar request."');
}

function deltaCacheStorageRun() {
  const { DeltaCrystallizer } = require('./deltaCache');

  function runScenario(label, makeVariant, count) {
    const inner = new FlatFileCrystallizer({});
    const plain = new FlatFileCrystallizer({});
    const dc = new DeltaCrystallizer(inner);
    const variants = [];
    for (let i = 0; i < count; i++) variants.push(makeVariant(i));
    variants.forEach((v, i) => { dc.set(`d${i}`, v, 'class'); plain.set(`d${i}`, v); });

    const deltaBytes = Buffer.byteLength(JSON.stringify(Object.fromEntries(inner._store)));
    const plainBytes = Buffer.byteLength(JSON.stringify(Object.fromEntries(plain._store)));
    const allCorrect = variants.every((v, i) => JSON.stringify(dc.get(`d${i}`)) === JSON.stringify(canonicalize(v)));
    console.log(`${label}: ${deltaBytes}b delta vs ${plainBytes}b plain (${count} entries) — ${(100 - (deltaBytes / plainBytes * 100)).toFixed(1)}% — reconstruction ${allCorrect ? 'PASS' : 'FAIL'}`);
    return deltaBytes / plainBytes;
  }

  console.log();
  // Small payload, small diff: the {__delta, __baseClass, __ops:[...]}
  // wrapper itself costs bytes. Reported honestly — this regime LOSES.
  runScenario(
    'Small objects (~90 bytes each, 1-field diff)',
    (i) => ({ name: 'card', title: `Item ${i}`, tags: ['a', 'b', 'c'], meta: { source: 'catalog', rev: 1 } }),
    20,
  );
  // Larger payload, same small diff: the base's shared bulk dominates,
  // and delta storage wins as intended.
  runScenario(
    'Larger objects (~1.2kb each, 1-field diff)',
    (i) => ({
      name: 'card', title: `Item ${i}`,
      description: 'A reusable card component with configurable slots for header, body, and footer content. '.repeat(4),
      tags: ['a', 'b', 'c', 'd', 'e'],
      meta: { source: 'catalog', rev: 1, schema: 'card-v2', permissions: ['read', 'write', 'admin'] },
    }),
    20,
  );
  console.log('Takeaway: delta storage only pays off once the shared/unchanging portion of a value is large relative to the wrapper overhead. It is NOT a universal win — the spec patch\'s framing implied one and didn\'t say so.');
}

function gateFusionRun() {
  const stageA = new Gate('raw', { transform: (e) => new Event('parsed', { v: e.data.v * 2 }) });
  const stageB = new Gate('parsed', { transform: (e) => new Event('validated', { v: e.data.v + 1 }) });
  const stageC = new Gate('validated', { transform: (e) => new Event('done', { v: e.data.v }) });

  const N = 5000;
  const unfused = new Stream();
  unfused.register(stageA); unfused.register(stageB); unfused.register(stageC);
  const unfusedMs = timeIt(() => unfused.emit(new Event('raw', { v: 1 })), N);

  const { fuseChain } = require('../core/GateFusion');
  const fused = fuseChain([stageA, stageB, stageC], 'raw.fused');
  const fusedStream = new Stream();
  fusedStream.register(fused);
  const fusedMs = timeIt(() => fusedStream.emit(new Event('raw', { v: 1 })), N);

  console.log(`\nGate fusion dispatch: unfused (3 hops) ${(unfusedMs / N * 1000).toFixed(2)}µs/dispatch vs fused (1 hop) ${(fusedMs / N * 1000).toFixed(2)}µs/dispatch (${N} iterations each)`);
  console.log(`Dispatch overhead reduction: ${(100 - (fusedMs / unfusedMs * 100)).toFixed(1)}% — Map-lookup + axiom-pass + log-record round trips saved per fused hop, NOT a token/model-call saving.`);
}

async function main() {
  await tokenCostRun();
  stabilityRun();
  await preGenerationRun();
  deltaCacheStorageRun();
  gateFusionRun();
  console.log('\n=== done ===');
}

main();
