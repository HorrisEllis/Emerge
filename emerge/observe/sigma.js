'use strict';
// component_id: emerge.observe.sigma · spec: CIE-EG §13.3
//
// The sigma classifier (RFR2 σ engine): a window of deltas in, a regime out. Pure — same window, same answer — and its output is a
// reading, never an entry: it is derived from the ledger each time, so the ledger stays the only record and nothing is stored twice.
//
//   regimes (precedence): insufficient_data > collapsing (K) > oscillatory (O) > degraded (S) > stable
//   S  largest latencyImpact in the window        → degraded    when S ≥ slope_threshold   (in sigmas)
//   K  largest |acceleration| in the window       → collapsing  when K ≥ accel_threshold   (a change of share, 0..1)
//   O  sign flips of the signed z, counting only deviations of at least flip_z sigmas → oscillatory when O ≥ oscillation_count
//
// RFR2 shipped slopeThreshold 0.3 for a z-score: a 0.3σ wobble is noise, so its "degraded" would fire on almost any window. The
// threshold here is in primitives (observe.sigma.slope_threshold) and starts at the 3σ rule CFR itself used for temporal anomalies.
// A stable window reports dominant_cause null and confidence 0; RFR2 reported cause "S" for a window with nothing in it.

const { q4 } = require('./entry');

const conf = (value, threshold) => threshold > 0 ? q4(Math.min(1, value / threshold)) : (value > 0 ? 1 : 0);

function features(window, O) {
  let S = 0, K = 0, flips = 0, last = 0;
  for (const d of window) {
    if (d.measured) {
      S = Math.max(S, d.latencyImpact);
      if (Math.abs(d.zs) >= O.deviation.flip_z) { const s = d.zs > 0 ? 1 : -1; if (last !== 0 && s !== last) flips++; last = s; }
    }
    if (d.accelMeasured) K = Math.max(K, Math.abs(d.acceleration));
  }
  return { S: q4(S), K: q4(K), O: flips };
}

function classify(window, O) {
  const C = O.sigma, span = window.length ? [window[0].seq, window[window.length - 1].seq] : [0, 0];
  const f = features(window, O);
  const res = (regime, cause, confidence) => Object.freeze({ regime, dominant_cause: cause, confidence, features: Object.freeze(f), window: Object.freeze(span), policy_version: O.version });
  if (window.length < C.min_window) return res('insufficient_data', null, 0);
  if (f.K >= C.accel_threshold) return res('collapsing', 'K', conf(f.K, C.accel_threshold));
  if (f.O >= C.oscillation_count) return res('oscillatory', 'O', conf(f.O, C.oscillation_count));
  if (f.S >= C.slope_threshold) return res('degraded', 'S', conf(f.S, C.slope_threshold));
  return res('stable', null, 0);
}

/** the regime at the end of the ledger, and a timeline of where it changed (rolling window, one reading per entry) */
function scan(deltas, O) {
  const W = O.sigma.window, timeline = [];
  let prev = null;
  for (let i = 0; i < deltas.length; i++) {
    const r = classify(deltas.slice(Math.max(0, i + 1 - W), i + 1), O);
    if (r.regime !== prev) { timeline.push({ seq: deltas[i].seq, regime: r.regime }); prev = r.regime; }
  }
  return { now: classify(deltas.slice(-W), O), timeline };
}

/** the entries that deviated most from their own key's rhythm (CFR's 3σ rule), one per key, strongest first */
function deviations(deltas, O, top = 5) {
  const best = new Map();
  for (const d of deltas) if (d.measured && d.latencyImpact >= O.deviation.z_flag) { const b = best.get(d.key); if (!b || d.latencyImpact > b.z) best.set(d.key, { seq: d.seq, key: d.key, z: d.latencyImpact, gap: d.gap }); }
  return [...best.values()].sort((a, b) => b.z - a.z || a.seq - b.seq).slice(0, top);
}

module.exports = { features, classify, scan, deviations };
