'use strict';
// emerge/test/debug.test.js — CIE-EG §13.7: debugging a run from its ledger (why, at, follow, diff, blame, clip, the CLI, ledger_why).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../lang/ledger');
const D = require('../observe/debug');
const cli = require('../observe/cli');
const { both } = require('../lang/test/harness');

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); } catch (e) { failed++; process.stdout.write(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}\n`); } };
process.stdout.write('debug: why, at, follow, diff, blame, clip (CIE-EG §13.7)\n');

function chain(items) {
  const out = []; let prev = L.ZERO;
  for (const [kind, body] of [['genesis', { seed: 0 }], ...items]) { const e = { seq: out.length + 1, kind, body, prev }; e.hash = L.hashEntry(e); out.push(e); prev = e.hash; }
  return out;
}
const decl = (name = 'Door', state = { key: null, opened: 0 }) => ['compartment', { name, id: 'co-1', state }];
const set = (c, changes, sig = 'cut') => ['transition', { compartment: c, signal: sig, changes, violations: [], spent: 0 }];
const needsKey = ['gap', { compartment: 'Door', signal: 'open', constraint: 'needs_key', missing: 'key', gap: 'g1', discarded: [] }];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-debug-'));
const write = (name, es) => { const f = path.join(tmp, name); fs.writeFileSync(f, JSON.stringify(es, (k, v) => typeof v === 'bigint' ? (JSON.rawJSON ? JSON.rawJSON(String(v)) : String(v)) : v)); return f; };
const runCli = (...a) => { let out = '', err = ''; const code = cli.run(a, { out: s => { out += s; }, err: s => { err += s; } }); return { out, err, code }; };

t('why: a null field walks back to the declaration, and says so', () => {
  const es = chain([decl(), needsKey]);
  const w = D.why(es, 3);
  assert.deepStrictEqual(w.chain.map(c => c.seq), [3, 2]);
  assert.match(w.chain[1].via, /null since Door was declared/); assert.strictEqual(w.root.seq, 2); assert.strictEqual(w.chain[1].inferred, true);
});
t('why: a field that was set walks back to the entry that set it, not to the declaration', () => {
  const es = chain([decl(), set('Door', { key: 'k' }), set('Door', { opened: 1 }, 'open'), needsKey]);
  const w = D.why(es, 5);
  assert.strictEqual(w.chain[1].seq, 3); assert.match(w.chain[1].via, /last set here/);
});
t('why: an observe gap leads to the reading it was opened from; a gap.close leads to its gap', () => {
  const es = chain([decl(), set('Door', { opened: 1 }, 'open'),
    ['gap', { gap: 'go', message: 'sigma: degraded', pressure: 0.5, type: 'temporal', line: 1, source: 'observe', dedup_key: 'a'.repeat(32), evidence: { pattern: 'sigma', from: 2, to: 3 } }],
    ['gap.close', { gap: 'go' }]]);
  assert.strictEqual(D.why(es, 4).chain[1].seq, 3); assert.strictEqual(D.why(es, 5).chain[1].seq, 4);
});
t('why: refuses a missing entry; never follows a cycle; a chain stops at the root', () => {
  const es = chain([decl(), needsKey]);
  assert.strictEqual(D.why(es, 99).ok, false);
  for (const e of es) for (const x of D.edges(es).get(e.seq)) assert.ok(x.from < e.seq);
  assert.ok(D.why(es, 1).chain.length === 1 && D.why(es, 1).root === null);
});
t('at: the world after an entry — state folded from transitions, open gaps, field and sigma', () => {
  const es = chain([decl(), needsKey, set('Door', { key: 'k' }), set('Door', { opened: 1 }, 'open')]);
  const early = D.at(es, 3), late = D.at(es, 5);
  assert.deepStrictEqual(early.compartments.Door.state, { key: null, opened: 0 }); assert.strictEqual(early.open_gaps.length, 1);
  assert.deepStrictEqual(late.compartments.Door.state, { key: 'k', opened: 1 }); assert.strictEqual(late.open_gaps.length, 0);
  assert.ok(late.field.regime && late.sigma.regime); assert.strictEqual(D.at(es, 99).ok, false);
});
t('at: a despawned compartment is gone; a tampered ledger is refused, not read', () => {
  const es = chain([decl(), ['despawn', { name: 'Door' }]]);
  assert.deepStrictEqual(D.at(es, 3).compartments, {});
  const bad = chain([decl(), set('Door', { key: 'k' })]); bad[2] = { ...bad[2], body: { tampered: 1 } };
  assert.strictEqual(D.at(bad, 3).ok, false);
});
t('follow: every entry about one compartment, signal or kind, in a range', () => {
  const es = chain([decl(), decl('Lamp', { on: false }), set('Door', { key: 'k' }), set('Lamp', { on: true }, 'flip'), needsKey]);
  assert.deepStrictEqual(D.follow(es, { compartment: 'Door' }).entries.map(e => e.seq), [2, 4, 6]);
  assert.deepStrictEqual(D.follow(es, { signal: 'flip' }).entries.map(e => e.seq), [5]);
  assert.deepStrictEqual(D.follow(es, { kind: 'transition', from: 5 }).entries.map(e => e.seq), [5]);
});
t('diff: identical runs, a prefix, and the first entry where two runs part ways with state either side', () => {
  const a = chain([decl(), set('Door', { key: 'k' }), set('Door', { opened: 1 }, 'open')]);
  assert.strictEqual(D.diff(a, a).identical, true);
  const pre = D.diff(a, a.slice(0, 3)); assert.strictEqual(pre.identical, false); assert.strictEqual(pre.common, 3); assert.strictEqual(pre.b, null);
  const b = chain([decl(), set('Door', { key: 'z' }), set('Door', { opened: 1 }, 'open')]);
  const d = D.diff(a, b); assert.strictEqual(d.first, 3); assert.strictEqual(d.common, 2); assert.strictEqual(d.a.seq, 3);
  const c = chain([decl(), set('Door', { opened: 5 }, 'open'), set('Door', { key: 'k' })]);
  const d2 = D.diff(a, c); assert.strictEqual(d2.first, 3);
  const e = chain([decl(), set('Door', { key: 'k' }), set('Door', { opened: 2 }, 'open')]);
  assert.deepStrictEqual(Object.keys(D.diff(a, e).state_before_diverging_differs), []);
});
t('blame: a clean ledger says so; a struggling one names the first struggle and why', () => {
  assert.strictEqual(D.blame(chain([decl(), set('Door', { key: 'k' })])).clean, true);
  const b = D.blame(chain([decl(), needsKey, ...Array.from({ length: 12 }, (_, i) => ['unrouted', { signal: `s${i}`, payload: null }])]));
  assert.strictEqual(b.clean, false); assert.strictEqual(b.first_stress.seq, 3); assert.strictEqual(b.first_stress.root.seq, 2);
  assert.ok(b.first_unhealthy && ['turbulent', 'chaotic'].includes(b.first_unhealthy.regime));
  assert.strictEqual(D.blame(chain([decl()]).map((e, i) => i === 1 ? { ...e, body: { x: 1 } } : e)).ok, false);
});
t('clip: a slice verifies alone, anchors at both ends, and fails when anything in it is touched', () => {
  const es = chain([decl(), needsKey, set('Door', { key: 'k' }), set('Door', { opened: 1 }, 'open'), set('Door', { opened: 2 }, 'open')]);
  const c = D.clip(es, 3, 5);
  assert.strictEqual(c.count, 3); assert.deepStrictEqual(D.verifyClip(c), { ok: true }); assert.deepStrictEqual(D.verifyClip(c, es), { ok: true });
  assert.strictEqual(c.anchor.prev, es[1].hash); assert.ok(c.profile.field && c.profile.sigma);
  const forged = JSON.parse(JSON.stringify(c)); forged.entries[1].body = { tampered: 1 };
  assert.strictEqual(D.verifyClip(forged).ok, false);
  const other = chain([decl(), needsKey, set('Door', { key: 'z' }), set('Door', { opened: 1 }, 'open'), set('Door', { opened: 2 }, 'open')]);
  assert.strictEqual(D.verifyClip(c, other).ok, false);
  const cut = { ...c, entries: c.entries.slice(0, 2) }; assert.strictEqual(D.verifyClip(cut).ok, false);
  assert.strictEqual(D.clip(es, 5, 3).ok, false);
});
t('the file loader keeps 64-bit integers exact, so a ledger written with a big int still verifies', () => {
  const es = chain([['record', { big: 9223372036854775807n, n: 1 }]]);
  const f = write('big.json', es);
  if (!JSON.rawJSON) return;                                  // older Node cannot write the literal either
  const back = cli.load(f); assert.strictEqual(back[1].body.big, 9223372036854775807n); assert.deepStrictEqual(L.verify(back), { ok: true });
});
t('cli: blame, why, at, follow, diff, clip and verify-clip read a ledger file and set the exit code', () => {
  const a = chain([decl(), needsKey, set('Door', { key: 'k' })]), b = chain([decl(), set('Door', { key: 'k' }), needsKey]);
  const fa = write('a.json', a), fb = write('b.json', b);
  let r = runCli(fa, 'blame'); assert.strictEqual(r.code, 0); assert.match(r.out, /state\.key has been null since Door was declared/); assert.match(r.out, /root: #2 Door declared/);
  r = runCli(fa, 'why', '3'); assert.match(r.out, /why #3/); r = runCli(fa, 'why', '99'); assert.strictEqual(r.code, 1);
  r = runCli(fa, 'at', '3'); assert.match(r.out, /Door \(declared #2\)/); assert.match(r.out, /open gap #3/);
  r = runCli(fa, 'follow', '--compartment', 'Door'); assert.match(r.out, /3 entries/);
  r = runCli(fa, 'diff', fb); assert.strictEqual(r.code, 1); assert.match(r.out, /part ways at #3/);
  r = runCli(fa, 'diff', fa); assert.strictEqual(r.code, 0); assert.match(r.out, /identical/);
  const cf = path.join(tmp, 'c.json');
  r = runCli(fa, 'clip', '2', '3', '-o', cf); assert.strictEqual(r.code, 0);
  r = runCli(cf, 'verify-clip'); assert.strictEqual(r.code, 0); assert.match(r.out, /clip verifies/);
  const doc = JSON.parse(fs.readFileSync(cf, 'utf8')); doc.entries[0].body.name = 'Evil'; fs.writeFileSync(cf, JSON.stringify(doc));
  r = runCli(cf, 'verify-clip'); assert.strictEqual(r.code, 1);
  r = runCli(fa, 'bogus'); assert.strictEqual(r.code, 2); r = runCli(path.join(tmp, 'nope.json'), 'blame'); assert.strictEqual(r.code, 2);
  assert.strictEqual(JSON.parse(runCli(fa, 'why', '3', '--json').out).chain.length, 2);
});
t('ledger_why(n) gives the same answer inside the program, in both backends', () => {
  const r = both(`
compartment Door {
  id = "co-door-001"
  intent = "open only with a key"
  state { key: null, opened: 0 }
  constraint needs_key hard { state.key != null }
  on "open" { state.opened += 1 }
}
emit "open"
let gaps = ledger() |> filter(fn(e) = e.kind == "gap")
let w = ledger_why(gaps[0].seq)
print("chain", len(w.chain), "root", w.root.seq, w.root.summary)
try { ledger_why(9999) } else e { print("refused", true) }
print("ledger ok:", ledger_verify())
`);
  assert.strictEqual(r.code, 0, r.err); assert.match(r.out, /chain 2 root 2 Door declared/); assert.match(r.out, /refused true/); assert.match(r.out, /ledger ok: true/);
});
t('debugging reads only: a real run\'s ledger is unchanged by every command', () => {
  const r = both(`emit "x"\nemit "y"\n`); const es = r.rt.world.ledger, before = JSON.stringify(es.map(e => e.hash));
  D.blame(es); D.why(es, 2); D.at(es, 2); D.clip(es, 1, 2); D.follow(es, {});
  assert.strictEqual(JSON.stringify(es.map(e => e.hash)), before); assert.deepStrictEqual(L.verify(es), { ok: true });
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
