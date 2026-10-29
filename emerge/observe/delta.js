'use strict';
// component_id: emerge.observe.delta · spec: CIE-EG §13.2
//
// Kinematic deltas over the ledger, in LOGICAL ticks only (seq). No wall clock is read anywhere (CIE-EG §4.9), so one ledger
// always gives the same deltas. Ported from RFR2's delta engine, with three honest changes:
//   S  latencyImpact   z-score of the tick gap since the previous entry of the same key, against that key's rolling window.
//                      The spread is floored at one tick (a tick is the smallest thing a ledger can tell apart), so a perfectly
//                      regular key does not turn a 1-tick wobble into an infinite deviation.
//   K  acceleration    RFR2 measured "throughput change", entries per unit of time. A ledger without a clock has exactly one
//                      entry per tick, so that number never moves. What does move is the SHARE of entries that are the system
//                      struggling (STRESS kinds). K is that share in the latest window minus the share in the window before it.
//   C  structuralDeviation  needs a causal parent on each entry. Emerge's entries do not carry one yet, so C is reported as null,
//                      never as 0: "not measured" and "measured and normal" are different facts.
// The signed z (zs) is kept next to latencyImpact. RFR2 counted oscillation from the already-clamped latencyImpact, which is never
// negative, so its oscillation count could not rise above 0 from a real delta stream.

const { STRESS, keyOf, q4, mean, std } = require('./entry');

function computeDeltas(entries, O) {
  const D = O.deviation;
  const lastSeq = new Map(), gapsOf = new Map();
  const cum = [0];                                   // cum[i] = stress entries among the first i entries
  const out = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    cum.push(cum[i] + (STRESS.has(e.kind) ? 1 : 0));
    const key = keyOf(e);
    let gap = null, zs = 0, z = 0, measured = false;
    if (e.kind !== 'checkpoint') {                   // checkpoints are periodic by construction: they say nothing about the program
      const prev = lastSeq.get(key), w = gapsOf.get(key) || [];
      if (prev !== undefined) {
        gap = e.seq - prev;
        if (w.length >= D.min_samples) {
          zs = (gap - mean(w)) / Math.max(std(w), D.tick_floor);
          z = Math.max(0, zs); measured = true;
        }
        w.push(gap); if (w.length > D.window) w.shift();
      }
      gapsOf.set(key, w); lastSeq.set(key, e.seq);
    }
    const n = i + 1, W = D.rate_window;
    const accelMeasured = n >= 2 * W;
    const accel = accelMeasured ? ((cum[n] - cum[n - W]) - (cum[n - W] - cum[n - 2 * W])) / W : 0;
    out[i] = Object.freeze({ seq: e.seq, kind: e.kind, key, gap, latencyImpact: q4(z), zs: q4(zs), measured, acceleration: q4(accel), accelMeasured, structuralDeviation: null });
  }
  return out;
}

module.exports = { computeDeltas };
