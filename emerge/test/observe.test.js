'use strict';
// emerge/test/observe.test.js — CIE-EG §13: the ledger read as a field (CFR field, RFR2 sigma deviation, liminal boundaries, gap hunter).
// Synthetic chains test each reading on its own; real programs, in both backends, test the builtins and the gate.

const assert = require('assert');
const L = require('../lang/ledger');
const build = require('../lang/build-loader');
const { validatePrimitives } = require('../lang/bootstrap');
const { observe, gapHunter } = require('../observe');
const { both } = require('../lang/test/harness');

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); } catch (e) { failed++; process.stdout.write(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}\n`); } };
process.stdout.write('observe: field, sigma deviation, liminal, gap hunter (CIE-EG §13)\n');

const P0 = build.primitives();
const clone = x => JSON.parse(JSON.stringify(x));
const withObserve = f => { const P = clone(P0); f(P.observe); return P; };

/** a valid chain from [kind, body] pairs, with genesis first */
function chain(items) {
  const out = []; let prev = L.ZERO;
  for (const [kind, body] of [['genesis', { seed: 0 }], ...items]) {
    const e = { seq: out.length + 1, kind, body, prev }; e.hash = L.hashEntry(e); out.push(e); prev = e.hash;
  }
  return out;
}
const gap = (id, pressure = 0.9, type = 'structural', message = `m ${id}`) => ['gap', { gap: id, message, pressure, type, line: 1 }];
const tick = () => ['transition', { compartment: 'C', signal: 'tick', changes: { n: 1 }, violations: [], spent: 0 }];
const filler = i => ['write', { path: `f${i}`, bytes: 1 }];
const unrouted = i => ['unrouted', { signal: `s${i}`, payload: null }];

t('the build carries observe, and its validator rejects a malformed section', () => {
  assert.ok(P0.observe && P0.observe.version);
  assert.deepStrictEqual(validatePrimitives(P0), []);
  const bad = clone(P0); bad.observe.gaps.tension.weight_age = 0.9; bad.observe.field.nudges.nonsense = { coherence: 0.1 }; bad.observe.gaps.regime_types.degraded = 'vibes'; bad.observe.surprise = {};
  const problems = validatePrimitives(bad).join('\n');
  assert.match(problems, /weights must add up to 1/); assert.match(problems, /nudges\.nonsense is not an entry kind/); assert.match(problems, /regime_types\.degraded must be one of gaps\.types/); assert.match(problems, /observe\.surprise is not a section/);
});
t('a ledger that does not verify is refused, not measured', () => {
  const es = chain([tick(), tick()]); es[2] = { ...es[2], body: { tampered: true } };
  const r = observe(es); assert.strictEqual(r.ok, false); assert.strictEqual(r.verify.seq, 3);
});
t('observe is a function of the ledger: one chain, one report, byte for byte', () => {
  const es = chain([tick(), gap('g1'), tick(), unrouted(1)]);
  assert.strictEqual(JSON.stringify(observe(es)), JSON.stringify(observe(es)));
});
t('an empty-ish ledger is insufficient data, never a regime it has not earned', () => {
  const r = observe(chain([]));
  assert.strictEqual(r.sigma.regime, 'insufficient_data'); assert.deepStrictEqual(r.gaps.proposals, []); assert.strictEqual(r.gaps.confidence, null);
});

// ── field ──
t('field: a benign run stays resonant; stress alone drives it to chaotic, and the hold says since when', () => {
  const calm = observe(chain(Array.from({ length: 20 }, tick)));
  assert.strictEqual(calm.field.now.regime, 'resonant'); assert.strictEqual(calm.field.counts.chaotic, 0);
  const hot = observe(chain(Array.from({ length: 10 }, (_, i) => gap(`g${i}`, 1, 'structural', `m${i}`))));
  assert.strictEqual(hot.field.now.regime, 'chaotic'); assert.ok(hot.field.hold.entries >= 1 && hot.field.hold.since >= 2);
});
t('field: a gap nudges in proportion to its pressure', () => {
  const lo = observe(chain([gap('a', 0.1)])).field.now, hi = observe(chain([gap('a', 1)])).field.now;
  assert.ok(hi.entropy > lo.entropy && hi.coherence < lo.coherence);
});
t('field: the same struggle again and again raises resonance; healthy repetition does not (a successful loop is not a resonance)', () => {
  const retry = observe(chain(Array.from({ length: 12 }, () => ['unrouted', { signal: 'lost', payload: null }]))).field.now.resonance;
  const varied = observe(chain(Array.from({ length: 12 }, (_, i) => unrouted(i)))).field.now.resonance;
  const loop = observe(chain(Array.from({ length: 40 }, tick)));
  assert.ok(retry > varied); assert.ok(loop.field.now.resonance < P0.observe.field.start.resonance); assert.strictEqual(loop.field.counts.turbulent, 0);
});
t('observe leaves out its own remarks and the runtime\'s notifications: neither is evidence about the program', () => {
  const base = chain([tick(), tick()]);
  const noisy = chain([tick(), tick(), ['gap', { gap: 'go', message: 'x', pressure: 1, type: 'structural', line: 1, source: 'observe', dedup_key: 'a'.repeat(32), evidence: { pattern: 'p' } }], ['unrouted', { signal: 'gap.opened', payload: null }], ['unrouted', { signal: 'rejected', payload: null }]]);
  const a = observe(base), b = observe(noisy);
  assert.strictEqual(b.measured, 3); assert.strictEqual(b.entries, 6); assert.strictEqual(b.gaps.open.length, 1);
  assert.deepStrictEqual(a.field.now.regime, b.field.now.regime); assert.strictEqual(b.liminal.terminus.unrouted, 0);
});

// ── sigma deviation ──
t('sigma: a key that always came every 3 ticks and then went silent for 40 deviates, and the regime is degraded', () => {
  const items = []; for (let i = 0; i < 6; i++) items.push(tick(), filler(`a${i}`), filler(`b${i}`));
  for (let i = 0; i < 39; i++) items.push(filler(`q${i}`));
  items.push(tick());
  const r = observe(chain(items));
  assert.strictEqual(r.sigma.regime, 'degraded'); assert.strictEqual(r.sigma.dominant_cause, 'S');
  assert.strictEqual(r.deviations[0].key, 'transition|C|tick'); assert.ok(r.deviations[0].z >= 3);
  assert.ok(r.gaps.proposals.some(p => p.evidence.pattern === 'sigma' && p.type === 'temporal'));
});
t('sigma: the tick floor keeps a one-tick wobble in a perfectly regular key from becoming an anomaly', () => {
  const items = []; for (let i = 0; i < 8; i++) items.push(tick(), filler(`a${i}`), filler(`b${i}`));
  items.push(filler('x'), tick());
  assert.notStrictEqual(observe(chain(items)).sigma.regime, 'degraded');
});
t('sigma: alternating fast and slow is oscillatory — the signed z flips, which the clamped one in RFR2 never could', () => {
  const P = withObserve(O => { O.deviation.flip_z = 0.5; O.sigma.slope_threshold = 99; });
  const items = []; for (let i = 0; i < 14; i++) { items.push(tick()); for (let j = 0; j < (i % 2 ? 3 : 1); j++) items.push(filler(`${i}.${j}`)); }
  const r = observe(chain(items), { primitives: P });
  assert.strictEqual(r.sigma.regime, 'oscillatory'); assert.ok(r.sigma.features.O >= 3);
  assert.ok(r.gaps.proposals.some(p => p.type === 'contradiction'));
});
t('sigma: a sudden jump in the share of struggling entries is collapsing, measured against the window before', () => {
  const r = observe(chain([...Array.from({ length: 16 }, tick), ...Array.from({ length: 16 }, (_, i) => unrouted(i))]));
  assert.strictEqual(r.sigma.regime, 'collapsing'); assert.strictEqual(r.sigma.dominant_cause, 'K'); assert.ok(r.sigma.features.K >= 0.5);
  assert.ok(r.gaps.proposals.some(p => p.type === 'causal'));
});
t('sigma: nothing is measured before there is something to compare against (null is not zero)', () => {
  const r = observe(chain([tick()]));
  assert.strictEqual(r.sigma.regime, 'insufficient_data');
  assert.strictEqual(r.deviations.length, 0);
});

// ── liminal ──
t('liminal velocity: stress outrunning integration runs away, and is proposed as a gap before any signal storm', () => {
  const r = observe(chain(Array.from({ length: 8 }, (_, i) => gap(`g${i}`, 0.3, 'logical', `m${i}`))));
  assert.ok(r.liminal.velocity.runaway_now && r.liminal.velocity.runaway_seq !== null);
  const p = r.gaps.proposals.find(x => x.evidence.pattern === 'velocity_field');
  assert.ok(p && p.type === 'structural' && p.evidence.since === r.liminal.velocity.runaway_seq);
});
t('liminal velocity: transitions bring it back down', () => {
  const r = observe(chain([...Array.from({ length: 8 }, (_, i) => gap(`g${i}`, 0.3, 'logical', `m${i}`)), ...Array.from({ length: 30 }, tick)]));
  assert.strictEqual(r.liminal.velocity.runaway_now, false); assert.ok(r.liminal.velocity.peak >= 0.8);
});
t('liminal threshold: a refusal bounces, a soft violation is absorbed, what a refusal discards dissolves', () => {
  const r = observe(chain([['rejected', { compartment: 'C', signal: 'tick', constraint: 'k', discarded: ['a', 'b'] }], ['transition', { compartment: 'C', signal: 'tick', changes: {}, violations: [{ constraint: 'soft', cost: 3 }], spent: 3 }], ['promotion_refused', { value: 1 }]]));
  assert.deepStrictEqual(r.liminal.threshold, { bounced: 2, absorbed: 1, dissolved: 2 });
});
t('liminal surface: one signal both accepted and refused again and again is reported, not turned into a gap', () => {
  const rej = ['rejected', { compartment: 'C', signal: 'tick', constraint: 'k', discarded: [] }];
  const r = observe(chain([tick(), rej, tick(), rej, tick(), rej, tick()]));
  assert.deepStrictEqual(r.liminal.coherence_surface, [{ key: 'C|tick', flips: 6 }]);
  assert.ok(!r.gaps.proposals.some(p => p.evidence.pattern === 'surface'));
});
t('liminal crystals: a constraint that keeps refusing a signal crystallises into a suggestion, only with enough count AND confidence', () => {
  const rej = ['rejected', { compartment: 'C', signal: 'tick', constraint: 'k', discarded: [] }];
  const yes = observe(chain([rej, rej, rej, rej, rej, rej, tick()]));
  assert.strictEqual(yes.liminal.crystals.length, 1); assert.strictEqual(yes.liminal.crystals[0].kind, 'refusal'); assert.ok(yes.liminal.crystals[0].confidence >= 0.75);
  const few = observe(chain([rej, rej, rej, rej]));
  assert.strictEqual(few.liminal.crystals.length, 0);
  const mixed = observe(chain([rej, rej, rej, rej, rej, ...Array.from({ length: 6 }, tick)]));
  assert.strictEqual(mixed.liminal.crystals.length, 0);
  assert.ok(yes.gaps.proposals.some(p => p.evidence.pattern === 'crystal' && p.type === 'logical'));
});
t('liminal terminus: signals that reach nowhere are counted, and a repeated one crystallises', () => {
  const r = observe(chain(Array.from({ length: 5 }, () => ['unrouted', { signal: 'lost', payload: null }])));
  assert.strictEqual(r.liminal.terminus.unrouted, 5); assert.ok(r.liminal.crystals.some(c => c.kind === 'unrouted' && c.scope === 'lost'));
});

// ── gap hunter ──
t('hunter: every proposal carries evidence, and a proposal without it is refused outright', () => {
  const r = observe(chain(Array.from({ length: 8 }, (_, i) => gap(`g${i}`, 0.3, 'logical', `m${i}`))));
  assert.ok(r.gaps.proposals.length > 0 && r.gaps.proposals.every(p => p.evidence && Object.keys(p.evidence).length && /^[0-9a-f]{32}$/.test(p.dedup_key)));
  assert.throws(() => gapHunter.propose({}, 'structural', 0.5, 0.5, 'x', null, P0.observe, P0), /needs evidence/);
});
t('hunter: confidence of a batch is its weakest member, never the mean', () => {
  const r = observe(chain([...Array.from({ length: 16 }, tick), ...Array.from({ length: 16 }, (_, i) => unrouted(i))]));
  assert.ok(r.gaps.proposals.length >= 2);
  assert.strictEqual(r.gaps.confidence, Math.min(...r.gaps.proposals.map(p => p.confidence)));
});
t('hunter: a proposal is not made again while a gap with its dedup key is open', () => {
  const first = observe(chain(Array.from({ length: 8 }, (_, i) => gap(`g${i}`, 0.3, 'logical', `m${i}`))));
  const p = first.gaps.proposals.find(x => x.evidence.pattern === 'velocity_field');
  const items = Array.from({ length: 8 }, (_, i) => gap(`g${i}`, 0.3, 'logical', `m${i}`));
  items.push(['gap', { gap: 'gv', message: p.message, pressure: p.pressure, type: p.type, line: 1, source: 'observe', dedup_key: p.dedup_key, evidence: p.evidence }]);
  const second = observe(chain(items));
  assert.ok(!second.gaps.proposals.some(x => x.dedup_key === p.dedup_key));
});
t('hunter: a repeated gap is one condition with occurrences, and every entry stays chained', () => {
  const r = observe(chain([gap('g1', 0.5, 'structural', 'same'), gap('g2', 0.5, 'structural', 'same'), gap('g3', 0.5, 'structural', 'same'), gap('g4', 0.5, 'structural', 'other')]));
  const same = r.gaps.open.filter(g => g.occurrences === 3);
  assert.strictEqual(same.length, 3); assert.strictEqual(new Set(same.map(g => g.dedup_key)).size, 1); assert.strictEqual(r.entries, 5);
});
t('hunter closure: a constraint gap closes only when its field was later set AND a transition proves it', () => {
  const cg = ['gap', { compartment: 'C', signal: 'open', constraint: 'needs_key', missing: 'key', gap: 'g1', discarded: [] }];
  const open = observe(chain([cg, ['transition', { compartment: 'C', signal: 'other', changes: { n: 1 }, violations: [], spent: 0 }]]));
  assert.strictEqual(open.gaps.open.length, 1);
  const wrongComp = observe(chain([cg, ['transition', { compartment: 'D', signal: 'x', changes: { key: 'k' }, violations: [], spent: 0 }]]));
  assert.strictEqual(wrongComp.gaps.open.length, 1);
  const closed = observe(chain([cg, ['transition', { compartment: 'C', signal: 'set', changes: { key: 'k' }, violations: [], spent: 0 }]]));
  assert.strictEqual(closed.gaps.open.length, 0); assert.deepStrictEqual(closed.gaps.closed[0].closed, { by: 'predicate', seq: 3 });
});
t('hunter closure: a gap.close entry that names the gap closes it', () => {
  const r = observe(chain([gap('g1'), gap('g2'), ['gap.close', { gap: 'g1', reason: 'fixed' }]]));
  assert.deepStrictEqual(r.gaps.open.map(g => g.gap), ['g2']); assert.deepStrictEqual(r.gaps.closed[0].closed, { by: 'gap.close', seq: 4 });
});
t('hunter tension: an old, repeated gap escalates and never falls; one past block_at by tension alone is flagged', () => {
  const items = [gap('g0', 0.55, 'structural', 'same')]; for (let i = 1; i < 6; i++) items.push(gap(`g${i}`, 0.55, 'structural', 'same'));
  for (let i = 0; i < 1100; i++) items.push(filler(i));
  const r = observe(chain(items)), e0 = r.gaps.escalations[0];
  assert.ok(e0.pressure_after >= e0.pressure && e0.composite > e0.pressure); assert.ok(e0.age > 1000 && e0.occurrences === 6);
  const young = observe(chain([gap('y', 0.55)])).gaps.escalations[0];
  assert.ok(young.composite < e0.composite); assert.strictEqual(young.pressure_after, young.pressure);
  const hard = observe(chain([gap('h', 0.95)])).gaps.escalations[0];
  assert.strictEqual(hard.would_block, true); assert.strictEqual(hard.blocked_by_tension, false);
});

// ── the builtins, in both backends ──
const PROGRAM = `
compartment Door {
  id = "co-door-001"
  intent = "open only with a key"
  state { key: null, opened: 0 }
  constraint needs_key hard { state.key != null }
  on "open" { state.opened += 1 }
}
fn run() {
  for i in range(0, 7) { emit "open" }
  for i in range(0, 6) { emit "nobody.listens" }
}
run()
let r = observe()
print("verified", ledger_verify(), "entries", r.entries)
print("field", r.field.now.regime, r.field.now.coherence, r.field.now.entropy)
print("sigma", r.sigma.regime, r.liminal.velocity.now, r.liminal.threshold.bounced)
print("proposals", len(r.gaps.proposals), "open", len(r.gaps.open))
let opened = observe_gaps()
print("opened", len(opened))
print("again", len(observe_gaps()))
let after = observe()
print("open now", len(after.gaps.open), "proposals now", len(after.gaps.proposals))
print("ledger ok:", ledger_verify())
`;
t('observe() and observe_gaps() give identical output and ledger in the interpreter and the compiled backend', () => {
  const r = both(PROGRAM);
  assert.strictEqual(r.code, 0, r.err); assert.match(r.out, /verified true/); assert.match(r.out, /ledger ok: true/);
});
t('observe_gaps() hands proposals to the gate once: the gap entries carry source, dedup key and evidence, and a second call opens none', () => {
  const r = both(PROGRAM);
  const opened = Number((r.out.match(/opened (\d+)/) || [])[1]), again = Number((r.out.match(/again (\d+)/) || [])[1]);
  assert.ok(opened >= 1, r.out); assert.strictEqual(again, 0);
  const mine = r.rt.world.ledger.filter(e => e.kind === 'gap' && e.body.source === 'observe');
  assert.strictEqual(mine.length, opened);
  assert.ok(mine.every(e => /^[0-9a-f]{32}$/.test(e.body.dedup_key) && e.body.evidence && e.body.evidence.pattern));
  assert.deepStrictEqual(L.verify(r.rt.world.ledger), { ok: true });
});
t('feedback is bounded: observing and opening gaps in a loop settles, it does not storm', () => {
  const r = both(`
fn burst() { for i in range(0, 12) { emit "lost.${'${i}'}" } }
burst()
var total = 0
for i in range(0, 8) { total += len(observe_gaps()) }
print("total", total, "ledger ok:", ledger_verify())
`);
  const total = Number((r.out.match(/total (\d+)/) || [])[1]);
  assert.ok(total >= 1 && total <= 12, r.out + r.err); assert.match(r.out, /ledger ok: true/);
});
t('observe() reads only: a whatif that calls it leaves nothing behind but its own record', () => {
  const r = both(`
emit "x"
let before = len(ledger())
whatif { let r = observe() }
print("same", len(ledger()) == before + 1)
`);
  assert.match(r.out, /same true/, r.out + r.err);
});
t('observe() on a program in a lens is a read; observe_gaps() in a lens is refused', () => {
  const r = both(`
compartment K {
  id = "co-k-001"
  intent = "x"
  state { n: 0 }
  fn peek() { return observe_gaps() }
}
try { K.peek() } else e { print("refused", true) }
`);
  assert.match(r.out, /refused true/, r.out + r.err);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
