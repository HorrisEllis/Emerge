'use strict';
const assert = require('assert');
const { Event, Gate, Axiom, Stream, StreamLog } = require('../core');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok — ${name}`); }
  catch (e) { fail++; console.log(`  FAIL — ${name}: ${e.message}`); }
}

console.log('WARP core tests');

test('Event is immutable', () => {
  const e = new Event('test.event', { value: 1 });
  assert.throws(() => { e.data.value = 2; }, /* frozen data */);
  assert.strictEqual(e.data.value, 1);
});

test('Event requires a non-empty type', () => {
  assert.throws(() => new Event(''), /type must be a non-empty string/);
});

test('Gate dispatches via signature match by default', () => {
  const g = new Gate('foo.bar', { transform: () => {} });
  assert.strictEqual(g.matches(new Event('foo.bar')), true);
  assert.strictEqual(g.matches(new Event('other')), false);
});

test('Gate.transform is pure — returns events, never touches a stream (testable in total isolation)', () => {
  const g = new Gate('double', { transform: (event) => new Event('doubled', { v: event.data.v * 2 }) });
  const result = g.transform(new Event('double', { v: 21 }));
  assert.strictEqual(result.type, 'doubled');
  assert.strictEqual(result.data.v, 42);
  // No stream object was ever created or passed — this is the whole point.
});

test('Stream signature collision is a hard error', () => {
  const s = new Stream();
  s.register(new Gate('x', { transform: () => {} }));
  assert.throws(() => s.register(new Gate('x', { transform: () => {} })), /Signature collision/);
});

test('Stream depth-first dispatch, matches SISO baseline behavior — gate returns the next event, Stream emits it', () => {
  const s = new Stream();
  const seen = [];
  s.register(new Gate('a', { transform: (e) => { seen.push('a'); return new Event('b'); } }));
  s.register(new Gate('b', { transform: () => { seen.push('b'); } }));
  s.emit(new Event('a'));
  assert.deepStrictEqual(seen, ['a', 'b']);
});

test('Gate returning an array of events emits all of them, depth-first', () => {
  const s = new Stream();
  const seen = [];
  s.register(new Gate('fanout', { transform: () => [new Event('x'), new Event('y')] }));
  s.register(new Gate('x', { transform: () => { seen.push('x'); } }));
  s.register(new Gate('y', { transform: () => { seen.push('y'); } }));
  s.emit(new Event('fanout'));
  assert.deepStrictEqual(seen, ['x', 'y']);
});

test('Unclaimed event lands in pending, same as SISO', () => {
  const s = new Stream();
  s.emit(new Event('unclaimed'));
  assert.strictEqual(s.pending.length, 1);
});

test('Axiom hard failure rejects the transform — never runs, never silent', () => {
  const s = new Stream();
  let ran = false;
  s.register(new Gate('risky', { transform: () => { ran = true; } }));
  s.registerAxiom(new Axiom('no-negative', {
    severity: 'hard',
    check: (event) => (event.data.value ?? 0) >= 0,
  }));
  s.emit(new Event('risky', { value: -5 }));
  assert.strictEqual(ran, false, 'gate must not run on hard axiom failure');
  assert.strictEqual(s.rejected.length, 1);
  assert.strictEqual(s.pending.length, 0, 'rejected is a distinct bucket from pending');
});

test('Axiom soft failure logs but does not block', () => {
  const s = new Stream();
  let ran = false;
  s.register(new Gate('ok', { transform: () => { ran = true; } }));
  s.registerAxiom(new Axiom('style-hint', { severity: 'soft', check: () => false }));
  s.emit(new Event('ok', {}));
  assert.strictEqual(ran, true, 'soft failure must not block execution');
  assert.strictEqual(s.rejected.length, 0);
});

test('StreamLog records every dispatch, including rejections', () => {
  const log = new StreamLog();
  const s = new Stream({ log });
  s.register(new Gate('a', { transform: () => {} }));
  s.registerAxiom(new Axiom('always-fail', { severity: 'hard', check: () => false }));
  s.emit(new Event('a'));
  s.emit(new Event('unclaimed'));
  assert.strictEqual(log.entries().length, 2);
});

test('hook() rejects unknown kinds and non-function plugins', () => {
  const s = new Stream();
  assert.throws(() => s.hook('nonsense', () => {}), /unknown hook kind/);
  assert.throws(() => s.hook('scorer', 'not-a-function'), /must be a function/);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
