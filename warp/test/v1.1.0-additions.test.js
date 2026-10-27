'use strict';
const assert = require('assert');
const { Event, Gate, Axiom, StreamLog } = require('../core');
const { unifiedDispatch } = require('../dispatch');
const { PopulationStore } = require('../dispatch/population');
const { FlatFileCrystallizer } = require('../plugins/crystallizer-flatfile');
const { scoreDefault, estimateTokens } = require('../plugins/scorer-default');
const { runCascade } = require('../dispatch/cascade');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok — ${name}`); }
  catch (e) { fail++; console.log(`  FAIL — ${name}: ${e.message}`); }
}
async function testAsync(name, fn) {
  try { await fn(); pass++; console.log(`  ok — ${name}`); }
  catch (e) { fail++; console.log(`  FAIL — ${name}: ${e.message}`); }
}

console.log('WARP v1.1.0 tests — token axis, recursive exploration, rollback, schema');

test('estimateTokens scales with output size', () => {
  const small = estimateTokens({ a: 1 });
  const large = estimateTokens({ a: 1, b: 'x'.repeat(200) });
  assert.ok(large > small);
});

test('scoreDefault rewards staying under token budget, penalizes exceeding it', () => {
  const efficient = scoreDefault({ output: { a: 1 }, tokenBudget: 100 });
  const bloated = scoreDefault({ output: { a: 'x'.repeat(1000) }, tokenBudget: 100 });
  assert.ok(efficient > bloated, `expected efficient (${efficient}) > bloated (${bloated})`);
});

test('Gate.schema validates required keys and types without any external dependency', () => {
  const g = new Gate('typed', {
    transform: () => {},
    schema: { requiredKeys: ['label', 'count'], types: { label: 'string', count: 'number' } },
  });
  const good = g.validateOutput({ label: 'x', count: 1 });
  const badType = g.validateOutput({ label: 'x', count: 'not a number' });
  const missing = g.validateOutput({ label: 'x' });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(badType.ok, false);
  assert.deepStrictEqual(badType.wrongType, [{ key: 'count', expected: 'number', actual: 'string' }]);
  assert.strictEqual(missing.ok, false);
  assert.deepStrictEqual(missing.missing, ['count']);
});

test('crystallizer.invalidate() rolls back a promoted entry, logged by presence of a real deletion', () => {
  const c = new FlatFileCrystallizer({});
  c.set('digest-x', { output: 'bad' });
  assert.strictEqual(c.get('digest-x').output, 'bad');
  const removed = c.invalidate('digest-x');
  assert.strictEqual(removed, true);
  assert.strictEqual(c.get('digest-x'), null);
  assert.strictEqual(c.invalidate('never-existed'), false, 'invalidating a non-existent digest must not lie about it');
});

async function main() {

await testAsync('exploreWidth > 1 picks the best-scoring candidate, not just the first passing one', async () => {
  const population = new PopulationStore();
  const crystallizer = new FlatFileCrystallizer({});
  const axioms = [new Axiom('any', { check: () => true })];
  let callN = 0;
  // Candidates get progressively smaller (fewer tokens) as callN increases —
  // the best one by token-efficiency should be the last one generated.
  async function variableSizeGenerate() {
    callN++;
    return { size: 'x'.repeat(100 - callN * 20) }; // shrinks each call
  }
  const result = await unifiedDispatch({
    gateSignature: 'explore.test', gateClass: 'explore-class',
    event: new Event('explore.test', { fixed: true }),
    axioms, crystallizer, population, scorer: scoreDefault,
    tokenBudget: 5, // tight budget — favors the smallest candidate strongly
    exploreWidth: 3,
    cascade: () => runCascade({ providers: ['p'], generate: variableSizeGenerate, validate: () => ({ ok: true }) }),
  });
  assert.strictEqual(callN, 3, 'exploreWidth=3 must generate exactly 3 candidates, not 1');
  assert.ok(result.ok);
  // The smallest output (callN=3 -> 40 chars) should have won on tokenEfficiency
  assert.strictEqual(result.output.size.length, 40, `expected the smallest/best candidate to win, got size length ${result.output.size.length}`);
});

await testAsync('exploreWidth defaults to 1 — no behavior change, no extra cost, for existing callers', async () => {
  const population = new PopulationStore();
  const crystallizer = new FlatFileCrystallizer({});
  const axioms = [new Axiom('any', { check: () => true })];
  let callN = 0;
  async function generate() { callN++; return { v: 1 }; }
  await unifiedDispatch({
    gateSignature: 'default.test', gateClass: 'default-class',
    event: new Event('default.test', {}),
    axioms, crystallizer, population, scorer: scoreDefault,
    cascade: () => runCascade({ providers: ['p'], generate, validate: () => ({ ok: true }) }),
  });
  assert.strictEqual(callN, 1, 'default exploreWidth must not change cost for existing callers');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

}

main();
