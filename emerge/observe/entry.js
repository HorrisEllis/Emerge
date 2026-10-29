'use strict';
// component_id: emerge.observe.entry · spec: CIE-EG §13.1
//
// How the observer reads a ledger entry. Pure helpers, no state.
//   keyOf       what an entry is "about": kind | compartment-or-name | signal, constraint, message, path or wire ends
//   pressureOf  the pressure a gap-like entry carries (a constraint gap's pressure lives in primitives, not in its body)
//   dedupKey    a stable name for "the same condition" — a hash of the canonical form of the parts (hashes name here, they prove nowhere)

const L = require('../lang/ledger');

/** entry kinds that are the system struggling (a refusal, a gap, a dropped signal, an abort) */
const STRESS = new Set(['gap', 'rejected', 'unrouted', 'aborted', 'promotion_refused']);
/** entry kinds that are the system integrating (a state change took, a value was promoted, a law was declared) */
const INTEGRATING = new Set(['transition', 'promote', 'axiom']);

const bodyOf = e => (e && e.body !== null && typeof e.body === 'object' && !Array.isArray(e.body)) ? e.body : {};

function keyOf(e) {
  const b = bodyOf(e);
  const who = b.compartment ?? b.name ?? '';
  const what = b.signal ?? b.constraint ?? b.message ?? b.path ?? (b.from !== undefined ? `${b.from}>${b.to}` : '');
  return `${e.kind}|${who}|${what}`;
}

/** the pressure of a gap or refused promotion; null for any other kind */
function pressureOf(e, P) {
  const b = bodyOf(e);
  if (e.kind === 'gap') return typeof b.pressure === 'number' ? b.pressure : P.gaps.constraint_gap.pressure;
  if (e.kind === 'promotion_refused') return P.gaps.promotion_refused.pressure;
  return null;
}

/**
 * Entries that are consequences, not evidence about the program: a gap the observer itself opened (it is a conclusion about the entries
 * it measured), and an `unrouted` entry for one of the runtime's own notification signals (gap.opened, rejected, promoted) that nobody
 * subscribed to. Counting either would let every reading feed on itself — a gap would raise stress, which would raise a gap.
 * They stay in the ledger and in the gap inventory; they are left out of the field, the deltas and the liminal readings.
 */
function isDerived(e, P) {
  const b = bodyOf(e);
  if (e.kind === 'gap' && b.source === 'observe') return true;
  if (e.kind === 'unrouted' && Object.values(P.signals).includes(b.signal)) return true;
  return false;
}

const q4 = x => Math.round(x * 10000) / 10000;

/** a stable name for a condition: the first `hex` digits of SHA-256 over the canonical form of `parts` */
function dedupKey(parts, hex) {
  return L.sha(Buffer.from('eg.observe.dedup.v1\0', 'utf8'), L.ecfBytes(parts, 'dedup parts')).toString('hex').slice(0, hex);
}

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const std = xs => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };

module.exports = { STRESS, INTEGRATING, bodyOf, keyOf, pressureOf, isDerived, q4, dedupKey, mean, std };
