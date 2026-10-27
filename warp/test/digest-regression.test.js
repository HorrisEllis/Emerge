'use strict';
const assert = require('assert');
const { computeDigest } = require('../dispatch/digest');
const { Axiom } = require('../core');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok — ${name}`); }
  catch (e) { fail++; console.log(`  FAIL — ${name}: ${e.message}`); }
}

console.log('WARP digest regression tests (fixing the shape-only-hash bug)');

test('REGRESSION: same shape, different content -> different digests (the bug that was found)', () => {
  const axioms = [new Axiom('a1', { check: () => true })];
  const submit = computeDigest({ gateSignature: 'gen.button', axioms, eventData: { kind: 'button', label: 'Submit' } });
  const cancel = computeDigest({ gateSignature: 'gen.button', axioms, eventData: { kind: 'button', label: 'Cancel' } });
  assert.notStrictEqual(submit, cancel, 'BUG: same-shape different-content events must not collide');
});

test('Identical content -> identical digest, regardless of key insertion order', () => {
  const axioms = [new Axiom('a1', { check: () => true })];
  const d1 = computeDigest({ gateSignature: 'g', axioms, eventData: { a: 1, b: 2 } });
  const d2 = computeDigest({ gateSignature: 'g', axioms, eventData: { b: 2, a: 1 } });
  assert.strictEqual(d1, d2, 'key order must not affect the digest');
});

test('Nested object content is canonicalized recursively, not just top level', () => {
  const axioms = [new Axiom('a1', { check: () => true })];
  const d1 = computeDigest({ gateSignature: 'g', axioms, eventData: { meta: { x: 1, y: 2 } } });
  const d2 = computeDigest({ gateSignature: 'g', axioms, eventData: { meta: { y: 2, x: 1 } } });
  assert.strictEqual(d1, d2, 'nested key order must not affect the digest either');
});

test('Axiom version bump changes the digest — old cache entries do not silently survive a rule change', () => {
  const eventData = { v: 1 };
  const v1 = [new Axiom('rule', { check: () => true, version: '1.0.0' })];
  const v2 = [new Axiom('rule', { check: () => true, version: '2.0.0' })];
  const d1 = computeDigest({ gateSignature: 'g', axioms: v1, eventData });
  const d2 = computeDigest({ gateSignature: 'g', axioms: v2, eventData });
  assert.notStrictEqual(d1, d2, 'a changed axiom version must invalidate old cache entries');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
