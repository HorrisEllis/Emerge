'use strict';
// component_id: emerge.observe.debug · spec: CIE-EG §13.7
//
// Debugging a run from its ledger. CFR's debugger answered four questions with a causal graph and a replay stream; RFR2 added bounded,
// verifiable clips. Emerge's entries carry no causal parent yet (CIE-EG §13.6), so causality here is INFERRED from structure and every
// edge says so (`via`). Nothing is guessed silently, and nothing is written to the ledger.
//
//   why(seq)    the chain from an entry back to the entry that explains it (CFR graph.ancestors). A constraint gap whose field is null
//               walks back to the last entry that set that field, or to the compartment's declaration: "never set since declared".
//   at(seq)     time travel: every compartment's state, the open gaps, and the field/sigma reading, as the world was after that entry.
//   follow(f)   every entry about one compartment, signal or kind (CFR jobChain / replay filter).
//   diff(a, b)  where two runs part ways: the first entry whose hash differs (equal hashes prove an equal past), with state either side.
//   blame()     the first thing that went wrong, and why — the debugger's "start here".
//   clip(from,to)  a bounded slice that anchors to the chain at both ends and can be re-verified alone (RFR2 clip).

const L = require('../lang/ledger');
const build = require('../lang/build-loader');
const { bodyOf, STRESS, isDerived } = require('./entry');
const { observe } = require('./index');

const keysOf = b => (b.changes && typeof b.changes === 'object') ? Object.keys(b.changes) : [];
const short = (x, n = 60) => { const s = typeof x === 'string' ? x : JSON.stringify(x, (k, v) => typeof v === 'bigint' ? String(v) : v); return s && s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** one line saying what an entry is */
function summary(e) {
  const b = bodyOf(e), c = b.compartment;
  switch (e.kind) {
    case 'transition': { const k = keysOf(b); return `${c} accepted ${b.signal}${k.length ? ` (set ${k.join(', ')})` : ''}${b.violations && b.violations.length ? ` at cost ${b.violations.reduce((s, v) => s + v.cost, 0)}` : ''}`; }
    case 'rejected': return `${c} refused ${b.signal}: ${b.constraint}${b.reason ? ` — ${short(b.reason, 80)}` : ''}`;
    case 'gap': return b.missing !== undefined ? `${c}.${b.constraint} could not be evaluated: state.${b.missing} is null` : `gap: ${short(b.message ?? '', 90)}${b.source === 'observe' ? ' (opened by observe)' : ''}`;
    case 'gap.close': return `gap ${b.gap} closed`;
    case 'unrouted': return `nobody handles ${b.signal}`;
    case 'aborted': return `aborted: ${short(b.error ?? '', 80)}`;
    case 'compartment': case 'register': return `${b.name} declared`;
    case 'promotion_refused': return 'promotion refused';
    case 'genesis': return `genesis (seed ${short(b.seed)})`;
    default: return `${e.kind}${b.name ? ' ' + b.name : b.path ? ' ' + b.path : ''}`;
  }
}

/** the inferred causal edges of every entry: Map(seq → [{ from, via, weight }]) — a parent is always an earlier seq */
function edges(entries) {
  const out = new Map(), decl = new Map(), lastState = new Map(), byField = new Map(), lastSignal = new Map(), gapAt = new Map();
  for (const e of entries) {
    const b = bodyOf(e), c = b.compartment, es = [];
    const add = (from, via, weight) => { if (from !== undefined && from !== null && from < e.seq) es.push({ from, via, weight }); };
    if (e.kind === 'gap' && c !== undefined && b.missing !== undefined) {
      const set = byField.get(c)?.get(b.missing);
      if (set !== undefined) add(set, `state.${b.missing} was last set here`, 0.95);
      else add(decl.get(c), `state.${b.missing} has been null since ${c} was declared`, 0.95);
    } else if ((e.kind === 'rejected' || e.kind === 'transition') && c !== undefined) {
      add(lastState.get(c) ?? decl.get(c), `${c}'s state as it stood`, 0.8);
    }
    if (e.kind === 'gap' && b.source === 'observe' && b.evidence) add(b.evidence.to ?? b.evidence.since ?? b.evidence.from, 'the reading this gap was opened from', 1);
    if (e.kind === 'gap.close') add(gapAt.get(b.gap), 'closes this gap', 1);
    if (b.signal !== undefined && lastSignal.has(b.signal)) add(lastSignal.get(b.signal), `the previous ${b.signal}`, 0.6);
    const best = new Map();
    for (const x of es) if (!best.has(x.from) || best.get(x.from).weight < x.weight) best.set(x.from, x);
    out.set(e.seq, [...best.values()].sort((a, z) => z.weight - a.weight || a.from - z.from));
    if (e.kind === 'compartment' || e.kind === 'register') decl.set(b.name, e.seq);
    if (e.kind === 'transition' && c !== undefined) { lastState.set(c, e.seq); if (!byField.has(c)) byField.set(c, new Map()); for (const k of keysOf(b)) byField.get(c).set(k, e.seq); }
    if (b.signal !== undefined) lastSignal.set(b.signal, e.seq);
    if (e.kind === 'gap' && b.gap !== undefined) gapAt.set(b.gap, e.seq);
  }
  return out;
}

const at1 = (entries, seq) => entries[seq - 1] && entries[seq - 1].seq === seq ? entries[seq - 1] : entries.find(e => e.seq === seq);

/** the chain back from an entry to what explains it. chain[0] is the entry; the last link is the root cause. */
function why(entries, seq, { depth = 24 } = {}) {
  const e = at1(entries, seq);
  if (!e) return { ok: false, reason: `no entry ${seq}` };
  const ed = edges(entries), chain = [{ seq: e.seq, kind: e.kind, summary: summary(e), via: null }], seen = new Set([e.seq]);
  let cur = e.seq;
  while (chain.length < depth) {
    const next = (ed.get(cur) || []).find(x => !seen.has(x.from));
    if (!next) break;
    const p = at1(entries, next.from);
    chain.push({ seq: p.seq, kind: p.kind, summary: summary(p), via: next.via, inferred: true });
    seen.add(p.seq); cur = p.seq;
  }
  const before = entries.filter(x => x.seq < seq).slice(-3).map(x => ({ seq: x.seq, kind: x.kind, summary: summary(x) }));
  const after = entries.filter(x => x.seq > seq && (ed.get(x.seq) || []).some(y => y.from === seq && y.weight >= 0.8)).slice(0, 5).map(x => ({ seq: x.seq, kind: x.kind, summary: summary(x) }));
  const root = chain[chain.length - 1];
  return { ok: true, seq, chain, root: chain.length > 1 ? root : null, before, consequences: after,
    note: 'causal edges are inferred from state lineage, signal names and observe evidence — entries do not yet carry a causal parent' };
}

/** the world as it was after entry `seq`: state of each compartment, open gaps, and the readings. */
function at(entries, seq, opts = {}) {
  const e = at1(entries, seq);
  if (!e) return { ok: false, reason: `no entry ${seq}` };
  const prefix = entries.slice(0, entries.indexOf(e) + 1), state = new Map(), names = new Map();
  for (const x of prefix) {
    const b = bodyOf(x);
    if ((x.kind === 'compartment' || x.kind === 'register') && b.name !== undefined) { state.set(b.name, { ...(b.state || {}) }); names.set(b.name, x.seq); }
    else if (x.kind === 'transition' && state.has(b.compartment)) Object.assign(state.get(b.compartment), b.changes || {});
    else if (x.kind === 'despawn' && b.name !== undefined) state.delete(b.name);
  }
  const rep = observe(prefix, opts);
  if (!rep.ok) return { ok: false, reason: `the ledger does not verify at ${rep.verify.seq}: ${rep.verify.reason}` };
  const compartments = {}; for (const [n, s] of state) compartments[n] = { state: s, declared: names.get(n) };
  return { ok: true, seq, entry: { kind: e.kind, summary: summary(e) }, compartments,
    open_gaps: rep.gaps.open.map(g => ({ seq: g.seq, gap: g.gap, type: g.type, pressure: g.pressure, occurrences: g.occurrences })),
    field: rep.field.now, field_regime_since: rep.field.hold.since, sigma: { regime: rep.sigma.regime, cause: rep.sigma.dominant_cause, confidence: rep.sigma.confidence }, velocity: rep.liminal.velocity.now };
}

/** every entry about one thing: { compartment }, { signal }, { kind } (any combination narrows), optionally from/to */
function follow(entries, f = {}) {
  const hit = entries.filter(e => {
    const b = bodyOf(e);
    return (f.compartment === undefined || b.compartment === f.compartment || b.name === f.compartment) && (f.signal === undefined || b.signal === f.signal) &&
      (f.kind === undefined || e.kind === f.kind) && (f.from === undefined || e.seq >= f.from) && (f.to === undefined || e.seq <= f.to);
  });
  return { ok: true, count: hit.length, entries: hit.map(e => ({ seq: e.seq, kind: e.kind, summary: summary(e) })) };
}

/** where two runs part ways. Equal hashes prove equal pasts (the chain), so the first unequal hash is the first difference. */
function diff(a, b, opts = {}) {
  const n = Math.min(a.length, b.length);
  let i = 0; while (i < n && a[i].hash === b[i].hash) i++;
  if (i === a.length && i === b.length) return { ok: true, identical: true, entries: n };
  const side = (es) => es[i] ? { seq: es[i].seq, kind: es[i].kind, summary: summary(es[i]), body: es[i].body } : null;
  const world = (es) => i > 0 ? at(es, i, opts) : null;
  const wa = world(a), wb = world(b);
  const changed = {};
  if (wa && wb && wa.ok && wb.ok) for (const c of new Set([...Object.keys(wa.compartments), ...Object.keys(wb.compartments)])) {
    const sa = wa.compartments[c]?.state ?? null, sb = wb.compartments[c]?.state ?? null;
    if (JSON.stringify(sa) !== JSON.stringify(sb)) changed[c] = { a: sa, b: sb };
  }
  return { ok: true, identical: false, common: i, first: i + 1, a: side(a), b: side(b), a_longer_by: a.length - b.length,
    note: i === n ? 'one run is a prefix of the other' : 'the runs share every entry before this one (hash-chained), so everything after it can differ',
    state_before_diverging_differs: changed };
}

/** the debugger's "start here": the first entry where the system struggled, the first time it left a healthy field, and why */
function blame(entries, opts = {}) {
  const P = opts.primitives || build.primitives(), rep = observe(entries, opts);
  if (!rep.ok) return { ok: false, reason: `the ledger does not verify at ${rep.verify.seq}: ${rep.verify.reason}` };
  const first = entries.find(e => STRESS.has(e.kind) && !isDerived(e, P));
  const out = { ok: true, entries: entries.length, field: rep.field.now.regime, sigma: rep.sigma.regime, first_stress: null, first_unhealthy: null };
  if (first) out.first_stress = why(entries, first.seq);
  // the first entry after which the field was turbulent or chaotic (one pass over the field series observe already computed)
  const hit = rep.series.find(r => r.regime === 'turbulent' || r.regime === 'chaotic');
  if (hit) out.first_unhealthy = { seq: hit.seq, regime: hit.regime, why: why(entries, hit.seq) };
  out.open_gaps = rep.gaps.open.length; out.proposals = rep.gaps.proposals.map(p => ({ type: p.type, pressure: p.pressure, message: p.message }));
  out.clean = !first && !hit;
  return out;
}

/** a bounded, verifiable slice (RFR2 clip): anchored to the chain by the hash before it and the hash at its end */
function clip(entries, from, to, opts = {}) {
  const a = entries.findIndex(e => e.seq === from), b = entries.findIndex(e => e.seq === to);
  if (a < 0 || b < 0 || a > b) return { ok: false, reason: `no range ${from}..${to}` };
  const slice = entries.slice(a, b + 1), rep = observe(entries.slice(0, b + 1), opts);
  if (!rep.ok) return { ok: false, reason: `the ledger does not verify at ${rep.verify.seq}` };
  return { ok: true, magic: 'EG-CLIP', fmt: 1, seqRange: [from, to], count: slice.length, anchor: { prev: slice[0].prev, head: slice[slice.length - 1].hash },
    profile: { field: rep.field.now, field_regime_since: rep.field.hold.since, sigma: rep.sigma.regime, velocity: rep.liminal.velocity.now, open_gaps: rep.gaps.open.length },
    entries: slice };
}

/** a clip stands on its own: every hash recomputed, every link followed, both anchors checked. Optionally also against a whole ledger. */
function verifyClip(c, whole) {
  if (!c || c.magic !== 'EG-CLIP' || !Array.isArray(c.entries) || !c.entries.length) return { ok: false, reason: 'not a clip' };
  let prev = c.anchor.prev;
  for (let i = 0; i < c.entries.length; i++) {
    const e = c.entries[i];
    if (e.prev !== prev) return { ok: false, seq: e.seq, reason: 'prev does not link to the previous entry' };
    let h; try { h = L.hashEntry(e); } catch (err) { return { ok: false, seq: e.seq, reason: err.message }; }
    if (h !== e.hash) return { ok: false, seq: e.seq, reason: 'hash does not match the entry' };
    if (i && e.seq !== c.entries[i - 1].seq + 1) return { ok: false, seq: e.seq, reason: 'seq out of order' };
    prev = e.hash;
  }
  if (prev !== c.anchor.head) return { ok: false, reason: 'the last entry is not the anchored head' };
  if (whole) { const m = whole.find(e => e.seq === c.seqRange[1]); if (!m || m.hash !== c.anchor.head) return { ok: false, reason: 'the clip does not belong to that ledger' }; }
  return { ok: true };
}

module.exports = { summary, edges, why, at, follow, diff, blame, clip, verifyClip };
