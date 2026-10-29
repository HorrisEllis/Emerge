'use strict';
// component_id: emerge.observe · spec: CIE-EG §13 (observation)
//
// The ledger, read as a field. observe(entries) refuses a chain that does not verify (the hash proves; nothing is measured on a
// forged history), then derives — in this order — deltas, the sigma regime, the CFR field, the liminal boundaries and the gap hunt.
// Everything is a function of the entries and of primitives.observe (core/primitives.eg), so one ledger always gives one report.
// A report is a reading: it is never written back. Only the gaps the hunter proposes can become entries, and only through the gate
// (the observe_gaps() builtin), each carrying its dedup key and its evidence.

const L = require('../lang/ledger');
const build = require('../lang/build-loader');
const { computeDeltas } = require('./delta');
const sigmaEngine = require('./sigma');
const { foldField, holdOf } = require('./field');
const { liminal } = require('./liminal');
const gapHunter = require('./gaps');
const { isDerived } = require('./entry');

function observe(entries, { primitives } = {}) {
  const P = primitives || build.primitives();
  const O = P.observe;
  if (!O) throw new Error('emerge: this build has no observe section — add it to core/primitives.eg and run: node lang/eg.js bootstrap');
  const v = L.verify(entries);
  if (!v.ok) return { ok: false, verify: v };

  const seen = entries.filter(e => !isDerived(e, P));       // the evidence: what the program did, not what observing it added
  const deltas = computeDeltas(seen, O);
  const sig = sigmaEngine.scan(deltas, O);
  const series = foldField(seen, deltas, O, P);
  const counts = { stable: 0, resonant: 0, turbulent: 0, chaotic: 0 };
  for (const r of series) counts[r.regime]++;
  const field = { now: series.length ? series[series.length - 1] : null, hold: holdOf(series), counts };
  const lim = liminal(seen, O);
  const gaps = gapHunter.hunt({ entries, sigma: sig, field, liminal: lim, O, P });
  const last = entries[entries.length - 1];

  return {
    ok: true, version: O.version,
    head: { seq: last ? last.seq : 0, hash: last ? last.hash : L.ZERO }, entries: entries.length, measured: seen.length,
    field,
    sigma: { ...sig.now, timeline: sig.timeline.slice(-8) },
    deviations: sigmaEngine.deviations(deltas, O),
    liminal: lim,
    gaps,
    series,
  };
}

module.exports = { observe, gapHunter };
