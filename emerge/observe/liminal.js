'use strict';
// component_id: emerge.observe.liminal · spec: CIE-EG §13.5
//
// The liminal space, for a system whose components never touch. Liminal's organ held the boundaries BETWEEN memory levels: not where
// unresolved things live, but what the boundary is, with one invariant per focal point. In Emerge the boundaries are the gate and its
// roads, and four of the five focal points have a direct reading in what the ledger already records:
//
//   Constitutional Threshold (L0∩L2)   where a proposal meets a law: a refusal BOUNCES it, a soft violation is ABSORBED at its cost,
//                                      and the signals a refusal discards DISSOLVE.
//   Velocity Field (L2∩L4)             stress arriving faster than integration: v decays every entry, rises on stress, falls on a
//                                      transition. Past `runaway` it is the early warning that comes BEFORE the signal-storm gap at
//                                      max_deliveries (liminal's "forward inference": the gap shape is the fix target before it opens).
//   Coherence Surface (L1∩L2)          one (compartment, signal) both accepted and refused inside a window: a contradiction held open,
//                                      reported, not forced to resolve.
//   Root Terminus (L3∩L0)              chains that end nowhere: an abort drops what was queued, an unrouted signal reaches no handler.
//
// Crystallisation gate (as liminal's): a pattern graduates only with enough confirmed instances AND enough confidence. Here a crystal is a
// SUGGESTION — a repeated refusal says the constraint or the sender is wrong; a repeated unrouted signal says wire it or stop emitting it.
// Nothing crystallises into the ledger or the program by itself.
//
// Left behind on purpose: liminal's twelve text detectors (pronouns, hedging, apology, rhyme…). They read human language; the ledger has
// none. The `code` detector's empty-catch rule already exists as the compile-time rule NO_SILENT_DROP.

const { bodyOf, q4 } = require('./entry');

function velocity(entries, O) {
  const V = O.liminal.velocity;
  let v = 0, peak = 0, peakSeq = 0, runawaySeq = null;
  for (const e of entries) {
    v = Math.max(0, Math.min(1, v * (1 - V.decay) + (V.step[e.kind] ?? 0)));
    if (v > peak) { peak = v; peakSeq = e.seq; }
    if (v >= V.runaway && runawaySeq === null) runawaySeq = e.seq;
  }
  return { now: q4(v), peak: q4(peak), peak_seq: peakSeq, runaway_seq: runawaySeq, runaway_now: v >= V.runaway };
}

function threshold(entries) {
  let bounced = 0, absorbed = 0, dissolved = 0;
  for (const e of entries) {
    const b = bodyOf(e);
    if (e.kind === 'rejected' || e.kind === 'promotion_refused') bounced++;
    if (e.kind === 'rejected' && Array.isArray(b.discarded)) dissolved += b.discarded.length;
    if (e.kind === 'transition' && Array.isArray(b.violations) && b.violations.length) absorbed++;
  }
  return { bounced, absorbed, dissolved };
}

function surface(entries, O) {
  const S = O.liminal.surface, tail = entries.slice(-S.window), last = new Map(), flips = new Map();
  for (const e of tail) {
    if (e.kind !== 'transition' && e.kind !== 'rejected') continue;
    const b = bodyOf(e), key = `${b.compartment ?? ''}|${b.signal ?? ''}`;
    if (last.has(key) && last.get(key) !== e.kind) flips.set(key, (flips.get(key) || 0) + 1);
    last.set(key, e.kind);
  }
  return [...flips.entries()].filter(([, n]) => n >= S.flips).map(([key, n]) => ({ key, flips: n })).sort((a, b) => b.flips - a.flips || (a.key < b.key ? -1 : 1));
}

function terminus(entries) {
  let aborted = 0, unrouted = 0, transitions = 0;
  for (const e of entries) { if (e.kind === 'aborted') aborted++; else if (e.kind === 'unrouted') unrouted++; else if (e.kind === 'transition') transitions++; }
  return { aborted, unrouted, unrouted_share: q4(unrouted / Math.max(1, unrouted + transitions)) };
}

function crystals(entries, O) {
  const C = O.liminal.crystal, refused = new Map(), accepted = new Map(), unrouted = new Map();
  for (const e of entries) {
    const b = bodyOf(e), scope = `${b.compartment ?? ''}|${b.signal ?? ''}`;
    if (e.kind === 'transition') accepted.set(scope, (accepted.get(scope) || 0) + 1);
    else if (e.kind === 'rejected') { const k = `${scope}|${b.constraint ?? ''}`; refused.set(k, (refused.get(k) || 0) + 1); }
    else if (e.kind === 'unrouted') { const k = String(b.signal ?? ''); unrouted.set(k, (unrouted.get(k) || 0) + 1); }
  }
  const out = [];
  for (const [k, n] of refused) {
    const [comp, sig, constraint] = k.split('|'), ok = accepted.get(`${comp}|${sig}`) || 0, confidence = q4(n / (n + ok));
    if (n >= C.min_count && confidence >= C.min_confidence) out.push({ kind: 'refusal', scope: `${comp}.${sig}`, constraint, count: n, confidence,
      suggestion: `${constraint} refuses ${sig} on ${comp} ${n} of ${n + ok} times: the sender or the constraint is wrong` });
  }
  for (const [sig, n] of unrouted) if (n >= C.min_count) out.push({ kind: 'unrouted', scope: sig, constraint: '', count: n, confidence: 1, suggestion: `nobody handles ${sig} (${n} times): wire it or stop emitting it` });
  return out.sort((a, b) => b.count - a.count || (a.scope < b.scope ? -1 : 1));
}

function liminal(entries, O) {
  return { velocity: velocity(entries, O), threshold: threshold(entries), coherence_surface: surface(entries, O), terminus: terminus(entries), crystals: crystals(entries, O) };
}

module.exports = { liminal, velocity, threshold, surface, terminus, crystals };
