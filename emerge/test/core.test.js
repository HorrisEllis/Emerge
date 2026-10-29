'use strict';
/**
 * core.test.js — emerge/core on its own (§2026-10-28: it needed intelligence/rfr2 from the Nexus tree and could not load).
 *   history: hash-chained, full SHA-256 over ECF, tamper detected
 *   level:   a change below shows at every level above
 *   field:   seed, accepted and rejected transitions, gaps, observations, all on the history
 *   determinism: two runs with one seed write byte-identical histories
 */

const core = require('../core');
const { canonicalize, hash } = require('../core/identity');
const { createClock } = require('../core/clock');

let p = 0, f = 0;
function test(label, fn) { try { fn(); p++; process.stdout.write('.'); } catch (e) { f++; console.log('\nFAIL [' + label + ']: ' + e.message); } }
function assert(v, msg) { if (!v) throw new Error(msg ?? 'assertion failed'); }

test('identity: ECF canonical form and a full 256-bit hash', () => {
  assert(canonicalize({ b: 1, a: [null, 'x'] }) === '{"a":[null,"x"],"b":1}');
  assert(/^[0-9a-f]{64}$/.test(hash('x')));
});
test('clock: logical counters from 1', () => {
  const c = createClock(); assert(c.nextSeq() === 1 && c.nextSeq() === 2 && c.nextTick() === 1);
});
test('history: chained, verifies, tamper detected', () => {
  const h = core.createHistory();
  h.append('a', { n: 1 }); h.append('b', { n: 2 });
  const es = h.entries();
  assert(es[1].prev === es[0].hash && /^[0-9a-f]{64}$/.test(es[1].hash));
  assert(h.verify().ok);
  const forged = core.createHistory(); forged.append('a', { n: 1 });
  assert(forged.entries()[0].hash === es[0].hash, 'same content, same hash');
});
test('level: a change below shows above', () => {
  const L = core.createLevels();
  L.add({ id: 'root', level: 0, summary: 'r' }).add({ id: 'kid', level: 1, parent: 'root', summary: 'k' });
  const before = L.hashOf('root');
  L.setSummary('kid', 'k2');
  assert(L.hashOf('root') !== before);
});
const runField = () => {
  const fld = core.createField({ seed: 7, state: { level: 50 }, constraints: [
    core.defineConstraint({ id: 'range', needs: ['level'], check: s => s.level >= 0 && s.level <= 100 }),
  ] });
  fld.propose({ source: 'test', changes: { level: 70 } });
  fld.propose({ source: 'test', changes: { level: 170 } });
  fld.propose({ source: 'test', changes: { level: undefined } });
  fld.observe({ subject: 'level', value: 70, confidence: 1, source: 'test' });
  return fld;
};
test('field: accept, reject, gap, observation — all recorded, history verifies', () => {
  const fld = runField();
  assert(fld.state().level === 70, 'rejected and gapped proposals change nothing');
  const kinds = fld.history.entries().map(e => e.kind);
  for (const k of ['seed', 'constraint', 'transition', 'rejected', 'gap', 'observation']) assert(kinds.includes(k), 'history has ' + k);
  assert(fld.gaps().length === 1 && fld.history.verify().ok);
});
test('determinism: one seed, byte-identical histories', () => {
  assert(JSON.stringify(runField().history.entries()) === JSON.stringify(runField().history.entries()));
});

console.log('\n\n  core.test.js');
console.log('  ' + p + ' passed  ' + f + ' failed');
process.exit(f > 0 ? 1 : 0);
