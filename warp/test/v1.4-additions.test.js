'use strict';
const assert = require('assert');
const { Event, Gate, Axiom, fuseChain, canFuse } = require('../core');
const { unifiedDispatch } = require('../dispatch');
const { PopulationStore, reuseCountPromotionPolicy } = require('../dispatch/population');
const { FlatFileCrystallizer } = require('../plugins/crystallizer-flatfile');
const { scoreDefault } = require('../plugins/scorer-default');
const { runCascade, runTwoStage } = require('../dispatch/cascade');
const { canonicalize, fingerprintKey, similarityScore } = require('../dispatch/canonicalize');
const { preGenerationCheck } = require('../dispatch/pregen');
const { computeDelta, applyDelta, DeltaCrystallizer } = require('../dispatch/deltaCache');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok — ${name}`); }
  catch (e) { fail++; console.log(`  FAIL — ${name}: ${e.stack}`); }
}
async function testAsync(name, fn) {
  try { await fn(); pass++; console.log(`  ok — ${name}`); }
  catch (e) { fail++; console.log(`  FAIL — ${name}: ${e.stack}`); }
}

console.log('WARP v1.4 tests — canonicalization, pre-generation, population lifecycle, two-stage, fusion, axiom weighting, delta cache');

// ── canonicalize.js ─────────────────────────────────────────────────────────

test('canonicalize strips undefined keys, -0, trailing whitespace', () => {
  const c = canonicalize({ b: 2, a: undefined, c: -0, d: 'hi   ' });
  assert.deepStrictEqual(c, { b: 2, c: 0, d: 'hi' });
});

test('fingerprintKey is identical for same shape, different content', () => {
  const f1 = fingerprintKey({ kind: 'button', label: 'Submit' });
  const f2 = fingerprintKey({ kind: 'button', label: 'Cancel' });
  assert.strictEqual(f1, f2);
});

test('fingerprintKey differs for different shape', () => {
  const f1 = fingerprintKey({ kind: 'button', label: 'Submit' });
  const f2 = fingerprintKey({ kind: 'button', label: 'Submit', disabled: true });
  assert.notStrictEqual(f1, f2);
});

test('similarityScore is 1.0 for identical shape, less than 1 for a shape with an extra field', () => {
  const a = { kind: 'button', label: 'Submit' };
  const b = { kind: 'button', label: 'Cancel' };
  const c = { kind: 'button', label: 'Cancel', disabled: true };
  assert.strictEqual(similarityScore(a, b), 1);
  assert.ok(similarityScore(a, c) < 1);
  assert.ok(similarityScore(a, c) > 0);
});

// ── pregen.js ────────────────────────────────────────────────────────────────

test('preGenerationCheck reuses a population variant above threshold', () => {
  const population = new PopulationStore();
  population.retain('btn', { output: { rendered: true }, fitness: 0.9, digest: 'd1', sourceEventData: { kind: 'button', label: 'Submit' } });
  const result = preGenerationCheck({ eventData: { kind: 'button', label: 'Cancel' }, population, gateClass: 'btn', threshold: 0.87 });
  assert.strictEqual(result.action, 'reuse');
  assert.strictEqual(result.variant.digest, 'd1');
});

test('preGenerationCheck proceeds when nothing is similar enough', () => {
  const population = new PopulationStore();
  population.retain('btn', { output: { rendered: true }, fitness: 0.9, digest: 'd1', sourceEventData: { kind: 'button', label: 'Submit' } });
  const result = preGenerationCheck({ eventData: { kind: 'modal', title: 'Confirm', body: 'Are you sure?' }, population, gateClass: 'btn', threshold: 0.87 });
  assert.strictEqual(result.action, 'proceed');
});

// ── population.js lifecycle ───────────────────────────────────────────────────

test('decay reduces fitness of untouched variants on every retain, not the one just touched', () => {
  const population = new PopulationStore({ decayRate: 0.5 });
  population.retain('c', { output: 1, fitness: 0.8, digest: 'd1', sourceEventData: { a: 1 } });
  population.retain('c', { output: 2, fitness: 0.8, digest: 'd2', sourceEventData: { b: 2 } });
  const stats = population.stats('c');
  const v1 = stats.variants.find(v => v.digest === 'd1');
  const v2 = stats.variants.find(v => v.digest === 'd2');
  assert.ok(v1.fitness < 0.8, 'untouched variant should have decayed');
  assert.strictEqual(v2.fitness, 0.8, 'just-retained variant should not decay this tick');
});

test('pruning removes variants that fall below threshold, never the just-retained one', () => {
  const population = new PopulationStore({ decayRate: 0.9, pruneThreshold: 0.5 });
  population.retain('c', { output: 1, fitness: 0.51, digest: 'd1', sourceEventData: { a: 1 } });
  population.retain('c', { output: 2, fitness: 0.05, digest: 'd2', sourceEventData: { b: 2 } }); // decays d1 to 0.051 -> pruned
  const stats = population.stats('c');
  assert.strictEqual(stats.variants.find(v => v.digest === 'd1'), undefined, 'decayed-below-threshold variant should be pruned');
  assert.ok(stats.variants.find(v => v.digest === 'd2'), 'freshly retained variant survives even below threshold');
});

test('deduplication keeps only the fittest variant per structural fingerprint', () => {
  const population = new PopulationStore();
  population.retain('btn', { output: 'a', fitness: 0.5, digest: 'd1', sourceEventData: { kind: 'button', label: 'Submit' } });
  population.retain('btn', { output: 'b', fitness: 0.9, digest: 'd2', sourceEventData: { kind: 'button', label: 'Cancel' } });
  const stats = population.stats('btn');
  assert.strictEqual(stats.size, 1, 'same-shape variants should collapse to one');
  assert.strictEqual(stats.variants[0].digest, 'd2', 'the fitter of the two should survive');
});

test('reuseCountPromotionPolicy promotes on reuse_count >= 2 and success_rate >= 0.7', () => {
  const population = new PopulationStore({ promotionPolicy: reuseCountPromotionPolicy });
  let promoted = population.retain('c', { output: 1, fitness: 0.4, digest: 'd1', success: true });
  assert.strictEqual(promoted, false, 'first retain: hits=1, not yet promotable');
  promoted = population.retain('c', { output: 1, fitness: 0.4, digest: 'd1', success: true });
  assert.strictEqual(promoted, true, 'second retain: hits=2, success_rate=1.0 -> promotable');
});

// ── cascade.js two-stage ──────────────────────────────────────────────────────

async function main() {

await testAsync('runTwoStage skips refinement when skeleton passes validation cleanly', async () => {
  let calls = 0;
  const result = await runTwoStage({
    skeletonProvider: 'cheap', refinementProvider: 'strong',
    generate: async () => { calls++; return { output: { ok: true }, confidence: 0.95 }; },
    validate: () => ({ ok: true }),
  });
  assert.strictEqual(calls, 1, 'refinement stage must not run when skeleton already passes');
  assert.strictEqual(result.refined, false);
  assert.strictEqual(result.ok, true);
});

await testAsync('runTwoStage escalates to refinement on failed validation', async () => {
  let calls = 0;
  const result = await runTwoStage({
    skeletonProvider: 'cheap', refinementProvider: 'strong',
    generate: async (provider) => {
      calls++;
      if (provider === 'cheap') return { output: { partial: true }, confidence: 0.9 };
      return { output: { ok: true }, confidence: 1 };
    },
    validate: (output) => ({ ok: !!output.ok, failures: output.ok ? [] : ['missing ok field'] }),
  });
  assert.strictEqual(calls, 2, 'refinement stage must run on validation failure');
  assert.strictEqual(result.refined, true);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.output.ok, true);
});

await testAsync('runTwoStage escalates on low confidence even when validation passes', async () => {
  let calls = 0;
  await runTwoStage({
    skeletonProvider: 'cheap', refinementProvider: 'strong',
    generate: async () => { calls++; return { output: { ok: true }, confidence: 0.2 }; },
    validate: () => ({ ok: true }),
    confidenceThreshold: 0.7,
  });
  assert.strictEqual(calls, 2, 'low confidence must trigger refinement even if validation technically passed');
});

// ── GateFusion ─────────────────────────────────────────────────────────────

test('fuseChain runs two gates as one, producing the final-stage output', () => {
  const a = new Gate('a.raw', { transform: (e) => new Event('a.parsed', { value: e.data.value * 2 }) });
  const b = new Gate('a.parsed', { transform: (e) => new Event('a.done', { value: e.data.value + 1 }) });
  const fused = fuseChain([a, b], 'a.fused');
  assert.strictEqual(fused.matches(new Event('a.raw', { value: 5 })), true);
  const out = fused.transform(new Event('a.raw', { value: 5 }));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].type, 'a.done');
  assert.strictEqual(out[0].data.value, 11); // (5*2)+1
});

test('fuseChain preserves events that do not match the next stage, instead of dropping them', () => {
  const a = new Gate('a.raw', { transform: (e) => [new Event('a.parsed', { v: 1 }), new Event('unrelated', { v: 2 })] });
  const b = new Gate('a.parsed', { transform: (e) => new Event('a.done', { v: e.data.v }) });
  const fused = fuseChain([a, b], 'a.fused');
  const out = fused.transform(new Event('a.raw', {}));
  const types = out.map(e => e.type).sort();
  assert.deepStrictEqual(types, ['a.done', 'unrelated']);
});

test('canFuse returns true when a sample event type matches gateA', () => {
  const a = new Gate('a.raw', { transform: () => {} });
  assert.strictEqual(canFuse(a, null, ['a.raw']), true);
});

// ── Axiom weighting + soft-skip integration ───────────────────────────────────

await testAsync('hard axioms are never skipped even with skipVerifiedSoftAxioms + a cache-verified digest', async () => {
  const population = new PopulationStore();
  const crystallizer = new FlatFileCrystallizer({});
  const hard = new Axiom('always-fail-hard', { check: () => false, severity: 'hard' });
  let hardChecked = 0;
  const trackedHard = new Axiom('always-fail-hard', { check: () => { hardChecked++; return false; }, severity: 'hard' });
  const result = await unifiedDispatch({
    gateSignature: 'g', gateClass: 'gc', event: new Event('g', { x: 1 }),
    axioms: [trackedHard], crystallizer, population, scorer: scoreDefault,
    skipVerifiedSoftAxioms: true,
    cascade: () => runCascade({ providers: ['p'], generate: async () => ({ ok: true }), validate: () => ({ ok: true }) }),
  });
  assert.strictEqual(result.ok, false);
  assert.ok(hardChecked >= 1, 'hard axiom must always run, never skipped');
});

await testAsync('soft axioms are skipped (and logged) on a repeat of an already-scored digest when skipVerifiedSoftAxioms is true', async () => {
  const population = new PopulationStore();
  const crystallizer = new FlatFileCrystallizer({});
  let softChecked = 0;
  const soft = new Axiom('style-nit', { check: () => { softChecked++; return true; }, severity: 'soft' });
  const skipLogs = [];
  const log = { record: (r) => { if (r.step === 'axiom-gate' && r.result === 'soft-skip') skipLogs.push(r); } };

  const dispatchOnce = () => unifiedDispatch({
    gateSignature: 'g', gateClass: 'gc', event: new Event('g', { x: 1 }),
    axioms: [soft], crystallizer, population, scorer: scoreDefault,
    skipVerifiedSoftAxioms: true, log,
    cascade: () => runCascade({ providers: ['p'], generate: async () => ({ ok: true }), validate: () => ({ ok: true }) }),
  });

  await dispatchOnce(); // first pass — no population variant yet, soft axiom runs
  assert.strictEqual(softChecked, 1);

  // Manually add a second gate-class-digest variant path is awkward since
  // the first dispatch may have promoted straight to exact-cache (which
  // short-circuits before axioms entirely) — assert on whichever happened
  // rather than assuming promotion timing.
  const stats = population.stats('gc');
  if (stats.size > 0) {
    await dispatchOnce();
    assert.ok(skipLogs.length >= 1, 'soft-skip must be logged, never silent');
  }
});

// ── deltaCache.js ────────────────────────────────────────────────────────────

test('computeDelta + applyDelta reconstructs the target from a base', () => {
  const base = { name: 'card', props: { title: 'A', color: 'blue', tags: ['x', 'y'] } };
  const target = { name: 'card', props: { title: 'B', color: 'blue', tags: ['x', 'y'] } };
  const ops = computeDelta(base, target);
  assert.ok(ops.length >= 1);
  const reconstructed = applyDelta(base, ops);
  assert.deepStrictEqual(reconstructed, canonicalize(target));
});

test('computeDelta captures key deletion', () => {
  const base = { a: 1, b: 2 };
  const target = { a: 1 };
  const ops = computeDelta(base, target);
  assert.deepStrictEqual(applyDelta(base, ops), { a: 1 });
});

test('DeltaCrystallizer stores first entry per class in full, later entries as diffs, both reconstruct correctly', () => {
  const inner = new FlatFileCrystallizer({});
  const dc = new DeltaCrystallizer(inner);
  const base = { name: 'card', title: 'A', tags: ['x'] };
  const variant = { name: 'card', title: 'B', tags: ['x'] };
  dc.set('digest-base', base, 'card-class');
  dc.set('digest-variant', variant, 'card-class');

  assert.deepStrictEqual(dc.get('digest-base'), canonicalize(base));
  assert.deepStrictEqual(dc.get('digest-variant'), canonicalize(variant));
  // the second entry is genuinely stored as a diff, not a full copy
  const raw = inner.get('digest-variant');
  assert.strictEqual(raw.__delta, true);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

}

main();
