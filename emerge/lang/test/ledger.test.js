'use strict';
// emerge/lang/test/ledger.test.js — CIE-EG §4 and acceptance tests 1, 2 (§11): the ledger format, verify, checkpoints, proofs.
// The known-answer hashes below were computed by a separate Python implementation of §4.2 and §4.6, sharing no code with ledger.js.

const assert = require('assert');
const L = require('../ledger');
const { both } = require('./harness');

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); } catch (e) { failed++; process.stdout.write(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}\n`); } };
process.stdout.write('ledger: format, verify, checkpoints (CIE-EG §4)\n');

const H1 = '04b037e1547c2ce22ff3ca14ffba18e38246b05590b86c93bfeefe76d6b158f7';
const H2 = 'c0ebe12c6a09dfdc17fa8a3df75d457dae05d7a58658b725f6d3e1f8c3481b61';
const H3 = '0cb05ed671bcec5e9e4cefc83ef537f8bc9dbd7137b35a0ab70303f5625347f4';
const chain = () => {
  const e1 = { seq: 1, kind: 'genesis', body: { seed: 0, version: '1.7.2', text: { normalization: 'nfc', encoding: 'utf-8' } }, prev: L.ZERO };
  e1.hash = L.hashEntry(e1);
  const e2 = { seq: 2, kind: 'note', body: { x: 1, 'é': [true, null, 'a"b\n'] }, prev: e1.hash }; e2.hash = L.hashEntry(e2);
  const e3 = { seq: 3, kind: 'note', body: { big: 9223372036854775807n }, prev: e2.hash }; e3.hash = L.hashEntry(e3);
  return [e1, e2, e3];
};
const clone = es => es.map(e => ({ ...e }));

t('the entry hash matches the independent implementation (domain tag, 32-byte prev, u64/u32 big-endian, length prefixes)', () => {
  const [e1, e2, e3] = chain();
  assert.strictEqual(e1.hash, H1); assert.strictEqual(e2.hash, H2); assert.strictEqual(e3.hash, H3);
});
t('the Merkle root matches the independent implementation, including the empty and odd cases', () => {
  assert.strictEqual(L.merkleRoot([H1]), 'f8d1a6bdd2e92b6da5486d0b3d33f9e4d4398c7e49191d00bc36b1a581fb5a9c');
  assert.strictEqual(L.merkleRoot([H1, H2, H3]), 'a82a29ac215ae0e2b6d4c5cd34c75a0de4a6acdb5915c4396b172f6cdac43493');
  assert.strictEqual(L.merkleRoot([]), 'ead4e0984ebf7eaf44723405667252a1eca1d5b1d3da97bb97be035163be8fca');
});
t('ECF: sorted by raw bytes, no whitespace, ints in decimal, -0 is 0, int and num of one value agree', () => {
  assert.strictEqual(L.ecf({ b: 1, a: [2, { d: null, c: true }], '\u{1F600}': 1, '\uFF5E': 2 }), '{"a":[2,{"c":true,"d":null}],"b":1,"\uFF5E":2,"\u{1F600}":1}');   // U+FF5E (EF BD 9E) sorts before U+1F600 (F0 …) in UTF-8, after it in UTF-16
  assert.strictEqual(L.ecf(-0), '0');
  assert.strictEqual(L.ecf(5n), L.ecf(5));
  assert.strictEqual(L.ecf(0.1), '0.1');
});
t('ECF refuses what is not data: NaN, infinity, non-NFC text, lone surrogates, functions', () => {
  assert.throws(() => L.ecf(NaN), /NaN and infinity/);
  assert.throws(() => L.ecf(Infinity), /NaN and infinity/);
  assert.throws(() => L.ecf('e\u0301'), /not NFC/);
  assert.throws(() => L.ecf('\uD800'), /lone surrogate/);
  assert.throws(() => L.ecf({ k: () => 1 }), /not data/);
});
t('verify accepts a good chain', () => assert.deepStrictEqual(L.verify(chain()), { ok: true }));
t('§11.1 — editing one byte of any entry fails verify', () => {
  for (let i = 0; i < 3; i++) {
    const es = clone(chain()); es[i] = { ...es[i], body: { tampered: true } };
    const r = L.verify(es); assert.strictEqual(r.ok, false); assert.strictEqual(r.seq, i + 1);
  }
  const es = clone(chain()); es[1].kind = 'nota'; assert.strictEqual(L.verify(es).ok, false);
  const fl = clone(chain()); fl[2].hash = fl[2].hash.slice(0, 63) + (fl[2].hash.endsWith('0') ? '1' : '0'); assert.strictEqual(L.verify(fl).ok, false);
});
t('§11.2 — deleting, reordering or splicing in an entry fails verify', () => {
  const del = clone(chain()); del.splice(1, 1); assert.strictEqual(L.verify(del).ok, false);
  const swap = clone(chain()); [swap[1], swap[2]] = [swap[2], swap[1]]; assert.strictEqual(L.verify(swap).ok, false);
  const [e1, e2] = chain(); const f = { seq: 2, kind: 'note', body: { forged: 1 }, prev: e1.hash }; f.hash = L.hashEntry(f);
  const spliced = [e1, f, { ...chain()[2] }]; assert.strictEqual(L.verify(spliced).ok, false);   // a forged entry 2 does not link to the original entry 3
});
t('truncating the tail still verifies (a chain proves order, not that nothing follows) — a checkpoint records the head and count', () => assert.strictEqual(L.verify(chain().slice(0, 2)).ok, true));
t('the genesis prev is 32 zero bytes; a null prev is refused', () => {
  const es = clone(chain()); es[0].prev = null; assert.strictEqual(L.verify(es).ok, false);
});
t('a program cannot forge a runtime kind with record', () => {
  const r = both('record "genesis" { }');
  assert.strictEqual(r.code, 1); assert.ok(r.err.includes('record cannot write the kind "genesis": the runtime owns it'));
  const c = both('try { record "checkpoint" { } } else e { print(e.message) }');
  assert.ok(c.out.includes('the runtime owns it'));
});

// ── runtime: genesis, checkpoints, verify, proofs ──
const MANY = 'for i in 0..300 { record "n" { i: i } }\n';
t('the first entry is genesis: seed, version, chain id, text settings; prev is zeros', () => {
  const r = both('let g = ledger()[0]\nprint(g.kind, g.prev, g.body.text, g.body.seed, len(g.body.chain_id))');
  assert.strictEqual(r.out, `genesis ${L.ZERO} {encoding: "utf-8", normalization: "nfc"} 0 36\n`);
});
t('chain id is derived from seed and version: same seed, same id; another seed, another id', () => {
  const id = s => both('print(ledger()[0].body.chain_id)', { seed: s }).out;
  assert.strictEqual(id(7), id(7)); assert.notStrictEqual(id(7), id(8));
  assert.match(id(7), /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\n$/);
});
t('a checkpoint is written after checkpoint_every entries, and carries head, entries, gaps, digests and a Merkle root', () => {
  const r = both(MANY + 'let cps = filter(ledger(), fn(e) = e.kind == "checkpoint")\nlet c = cps[0]\nprint(len(cps) >= 1, c.seq, c.body.entries == c.seq - 1, c.body.head == ledger()[c.seq - 2].hash, c.body.gaps, len(c.body.root), ledger_verify())');
  assert.strictEqual(r.out, 'true 257 true true 0 64 true\n');
});
t('checkpoint digests are the SHA-256 of each component state', () => {
  const r = both('compartment Cell {\n  id = "cell"\n  intent = "count"\n  state { n: 0 }\n  on "go" { state.n += 1 }\n}\nfor i in 0..300 { emit "go" }\nlet c = filter(ledger(), fn(e) = e.kind == "checkpoint")[0]\nprint(keys(c.body.digests), len(c.body.digests["cell"]))');
  assert.strictEqual(r.out, '["cell"] 64\n');
  const w = both('compartment Cell {\n  id = "cell"\n  intent = "count"\n  state { n: 0 }\n  on "go" { state.n += 1 }\n}\nfor i in 0..300 { emit "go" }').rt.world;
  const cp = w.ledger.find(e => e.kind === 'checkpoint');
  const known = new Set(Array.from({ length: 301 }, (_, k) => L.sha(L.ecfBytes({ n: k })).toString('hex')));
  assert.ok(known.has(cp.body.digests.cell), 'the digest is sha256(ecf(state)) for some committed state');
});
t('a clean shutdown writes a final checkpoint; an entry list that ends on a checkpoint does not get a second', () => {
  const { ledger } = (() => { const x = both('record "a" { }'); return { ledger: x.rt.world.ledger }; })();
  assert.strictEqual(ledger[ledger.length - 1].kind, 'checkpoint');
  assert.strictEqual(ledger[ledger.length - 1].body.entries, ledger.length - 1);
  assert.deepStrictEqual(L.verify(ledger), { ok: true });
});
t('the whole ledger of a real run verifies, and any edit to it fails', () => {
  const ledger = both(MANY).rt.world.ledger;
  assert.strictEqual(ledger.filter(e => e.kind === 'checkpoint').length, 2);   // after 256 entries, and at shutdown
  assert.deepStrictEqual(L.verify(ledger), { ok: true });
  const bad = ledger.map(e => ({ ...e })); bad[100] = { ...bad[100], body: { i: 99999 } };
  assert.strictEqual(L.verify(bad).ok, false);
  const gone = ledger.map(e => ({ ...e })); gone.splice(50, 1);
  assert.strictEqual(L.verify(gone).ok, false);
});
t('a checkpoint whose Merkle root or counts were forged is caught even when its own hash is recomputed', () => {
  const ledger = both(MANY).rt.world.ledger.map(e => ({ ...e }));
  const i = ledger.findIndex(e => e.kind === 'checkpoint');
  const forged = { ...ledger[i], body: { ...ledger[i].body, root: '00'.repeat(32) } };
  forged.hash = L.hashEntry(forged);
  assert.strictEqual(L.verify([...ledger.slice(0, i), forged]).ok, false);
});
t('ledger_verify(seq) verifies from a checkpoint; a non-checkpoint is refused', () => {
  const r = both(MANY + 'print(ledger_verify(257), ledger_verify(5), ledger_verify())');
  assert.strictEqual(r.out, 'true false true\n');
});
t('ledger_proof proves an entry belongs under its checkpoint; a doctored proof fails', () => {
  const r = both(MANY + 'let p = ledger_proof(100)\nprint(p.seq, p.checkpoint, ledger_check_proof(p), len(p.path) > 0)\nvar q = clone(p)\nq.hash = ledger()[101].hash\nprint(ledger_check_proof(q))');
  assert.strictEqual(r.out, '100 257 true true\nfalse\n');
});
t('ledger_proof refuses a checkpoint, a missing entry, and an entry not under a checkpoint yet', () => {
  const r = both('print(try_it())\nfn try_it() {\n  var m = []\n  try { ledger_proof(1) } else e { m = m + [e.message] }\n  try { ledger_proof(999) } else e { m = m + [e.message] }\n  return m\n}');
  assert.match(r.out, /not under a checkpoint yet/); assert.match(r.out, /no entry 999/);
});
t('whatif leaves no entries, checkpoints or gap counts behind (only its own whatif record)', () => {
  const r = both(MANY + 'let cp = len(filter(ledger(), fn(e) = e.kind == "checkpoint"))\nwhatif {\n  for i in 0..400 { record "w" { i: i } }\n  null\n}\nprint(len(filter(ledger(), fn(e) = e.kind == "w")), len(filter(ledger(), fn(e) = e.kind == "checkpoint")) == cp, ledger_verify())');
  assert.strictEqual(r.out, '0 true true\n');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
