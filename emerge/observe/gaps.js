'use strict';
// component_id: emerge.observe.gaps · spec: CIE-EG §13.6
//
// The gap hunter, for a ledger. GapHunter v3 read the TEXT of model answers (bullet density, hedging, entropy) — none of that has a
// meaning here. What is worth keeping from the intelligence system's gap work is its discipline, and that is what this module is:
//
//   evidence required   a proposal without an evidence object is refused outright.
//   weakest link        confidence of a batch is the MINIMUM over its members, never the mean.
//   dedup key           one condition, one name. A repeat bumps `occurrences` on the same key instead of becoming a new gap, which answers
//                       CIE-EG §4.7 without giving up an exact history: every entry is still chained, the count is an index over them.
//   closure             a gap closes on a `gap.close` entry that names it, OR when its predicate is false AND an artifact proves it
//                       (gap-predicate's rule: neither alone is closure). The runtime does not write `gap.close` yet, so today only the
//                       predicate path can close a gap, and only a constraint gap has a predicate: its missing field was later set by a
//                       transition of the same compartment, and that transition entry is the artifact.
//   tension             an open gap's urgency climbs with its age (in ticks) and its repeats, never falls, and is reported against
//                       block_at: the gate closes a road at or above it (CIE-EG §6.4). This module only reports; closing is the gate's act.
//
// Nothing here writes to the ledger. `proposals` are what observe_gaps() hands to the gate.

const { bodyOf, dedupKey, q4 } = require('./entry');

const clamp01 = x => Math.max(0, Math.min(1, x));

/** every gap entry, with the name of its condition, its occurrences, and whether and how it closed */
function inventory(entries, O, P) {
  const G = O.gaps, closers = new Map(), list = [];
  for (const e of entries) if (e.kind === 'gap.close') { const id = bodyOf(e).gap; if (id !== undefined && !closers.has(id)) closers.set(id, e.seq); }
  const transitions = entries.filter(e => e.kind === 'transition');
  for (const e of entries) {
    if (e.kind !== 'gap') continue;
    const b = bodyOf(e);
    const type = b.type ?? P.gaps.constraint_gap.type;
    const dedup = b.dedup_key ?? dedupKey({ type, message: b.message ?? '', compartment: b.compartment ?? '', signal: b.signal ?? '', constraint: b.constraint ?? '' }, G.dedup_hex);
    let closed = null;
    if (closers.has(b.gap)) closed = { by: 'gap.close', seq: closers.get(b.gap) };
    else if (b.compartment !== undefined && b.missing !== undefined) {
      const art = transitions.find(t => t.seq > e.seq && bodyOf(t).compartment === b.compartment && bodyOf(t).changes && bodyOf(t).changes[b.missing] !== undefined && bodyOf(t).changes[b.missing] !== null);
      if (art) closed = { by: 'predicate', seq: art.seq };
    }
    list.push({ gap: b.gap ?? null, seq: e.seq, type, pressure: typeof b.pressure === 'number' ? b.pressure : P.gaps.constraint_gap.pressure, dedup_key: dedup, source: b.source ?? 'program', closed });
  }
  const seen = new Map();
  for (const g of list) seen.set(g.dedup_key, (seen.get(g.dedup_key) || 0) + 1);
  for (const g of list) g.occurrences = seen.get(g.dedup_key);
  return list;
}

function tension(g, headSeq, O) {
  const T = O.gaps.tension, age = Math.max(0, headSeq - g.seq);
  const ageFactor = clamp01(Math.log2(1 + age) / Math.log2(1 + T.age_cap));
  const repeatFactor = clamp01((g.occurrences - 1) / T.repeat_cap);
  const composite = q4(clamp01(g.pressure * T.weight_pressure + ageFactor * T.weight_age + repeatFactor * T.weight_repeat));
  const escalated = Math.max(g.pressure, composite);                         // monotonic: tension only ever raises
  const floor = composite >= T.critical ? 'critical' : composite >= T.high ? 'high' : composite >= T.medium ? 'medium' : 'low';
  return { gap: g.gap, seq: g.seq, dedup_key: g.dedup_key, pressure: q4(g.pressure), age, occurrences: g.occurrences, composite, pressure_after: q4(escalated), severity: floor,
    would_block: escalated >= O.gaps.block_at, blocked_by_tension: g.pressure < O.gaps.block_at && composite >= O.gaps.block_at };
}

function propose(parts, type, pressure, confidence, message, evidence, O, P) {
  if (!evidence || typeof evidence !== 'object' || !Object.keys(evidence).length) throw new Error('observe: a gap proposal needs evidence');
  const p = Math.max(P.gaps.pressure_min, Math.min(P.gaps.pressure_max, pressure));
  return { type, pressure: q4(p), confidence: q4(confidence), message, evidence, dedup_key: dedupKey({ source: 'observe', ...parts }, O.gaps.dedup_hex) };
}

/** everything the ledger's own measurements say is worth a gap, minus what is already open */
function hunt({ entries, sigma, field, liminal, O, P }) {
  const G = O.gaps, headSeq = entries.length ? entries[entries.length - 1].seq : 0;
  const inv = inventory(entries, O, P);
  const open = inv.filter(g => !g.closed), closed = inv.filter(g => g.closed);
  const escalations = open.map(g => tension(g, headSeq, O));

  const cand = [];
  const s = sigma.now;
  if (G.regime_types[s.regime]) {
    const f = s.features;
    cand.push(propose({ pattern: 'sigma', regime: s.regime, cause: s.dominant_cause }, G.regime_types[s.regime], G.regime_pressure[s.regime] * s.confidence, s.confidence,
      `sigma: ${s.regime} (${s.dominant_cause}) over ticks ${s.window[0]} to ${s.window[1]}: S ${f.S}, K ${f.K}, O ${f.O}`,
      { pattern: 'sigma', regime: s.regime, cause: s.dominant_cause, S: f.S, K: f.K, O: f.O, from: s.window[0], to: s.window[1] }, O, P));
  }
  const h = field.hold, cur = field.now;
  if (G.field_types[h.regime] && h.entries >= G.field_persist) {
    cand.push(propose({ pattern: 'field', regime: h.regime }, G.field_types[h.regime], G.field_pressure[h.regime], Math.min(1, h.entries / (G.field_persist * 2)),
      `field: ${h.regime} for ${h.entries} entries since tick ${h.since} (coherence ${cur.coherence}, friction ${cur.friction}, entropy ${cur.entropy})`,
      { pattern: 'field', regime: h.regime, since: h.since, entries: h.entries, coherence: cur.coherence, friction: cur.friction, resonance: cur.resonance, entropy: cur.entropy }, O, P));
  }
  const v = liminal.velocity;
  if (v.runaway_now) {
    cand.push(propose({ pattern: 'velocity_field' }, O.liminal.velocity.gap_type, O.liminal.velocity.gap_pressure, v.now,
      `velocity field ran away (${v.now}) since tick ${v.runaway_seq}: stress is arriving faster than the program integrates it, ahead of any signal storm`,
      { pattern: 'velocity_field', velocity: v.now, peak: v.peak, since: v.runaway_seq }, O, P));
  }
  for (const c of liminal.crystals) {
    cand.push(propose({ pattern: 'crystal', kind: c.kind, scope: c.scope, constraint: c.constraint }, G.crystal_types[c.kind], G.crystal_pressure[c.kind] * c.confidence, c.confidence,
      `crystal: ${c.suggestion}`, { pattern: 'crystal', kind: c.kind, scope: c.scope, constraint: c.constraint, count: c.count, confidence: c.confidence }, O, P));
  }

  const openKeys = new Set(open.map(g => g.dedup_key));
  const proposals = cand.filter(c => !openKeys.has(c.dedup_key)).sort((a, b) => b.pressure - a.pressure || (a.dedup_key < b.dedup_key ? -1 : 1));
  const confidence = proposals.length ? Math.min(...proposals.map(p => p.confidence)) : null;
  return { open, closed, escalations, proposals, confidence };
}

module.exports = { inventory, tension, propose, hunt };
