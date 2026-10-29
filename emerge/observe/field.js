'use strict';
// component_id: emerge.observe.field · spec: CIE-EG §13.4
//
// The CFR field, as a pure fold over the ledger. Four dimensions in 0..1 — coherence, friction, resonance, entropy — each entry
// nudges them, every step pulls them back toward neutral, and the regime (stable / resonant / turbulent / chaotic) is read from them.
//
// What changed from CFR:
//   · CFR froze a snapshot into each entry at write time because its entries carried wall-clock times and could not be recomputed.
//     Here every input is in the ledger and time is the seq, so the fold is replayable and nothing needs freezing into the chain.
//   · CFR's nudge table was keyed on NEXUS event names. A ledger has a closed set of kinds (CIE-EG §4.5), so the table is keyed on
//     those, lives in primitives (observe.field.nudges), and a gap's nudge is scaled by the pressure the entry actually carries.
//   · CFR set resonance from retry event names (cyclic reinforcement: retries, loops). Here resonance rises when a STRESS entry repeats one
//     of the last `repeat_window` keys — the same struggle again and again — and eases off otherwise. A healthy loop of successful
//     transitions is not a resonance: the first version of this fold counted any repetition and called a 20-tick counter turbulent.
//   · Sigma still feeds the field as in CFR: a deviating entry adds entropy and friction, in proportion to its z up to deviation_full_z.
// The nudge numbers are CFR's, carried over by analogy. They are tunables, not measurements.

const { STRESS, keyOf, pressureOf, q4 } = require('./entry');

const DIMS = ['coherence', 'friction', 'resonance', 'entropy'];
const clamp = x => Math.max(0, Math.min(1, x));

function regimeOf(s, R) {
  if (s.entropy > R.chaotic_entropy || s.coherence < R.chaotic_coherence) return 'chaotic';
  if (s.friction > R.turbulent_friction || s.resonance > R.turbulent_resonance) return 'turbulent';
  if (s.coherence > R.resonant_coherence && s.entropy < R.resonant_entropy) return 'resonant';
  return 'stable';
}

/** one reading per entry: { seq, coherence, friction, resonance, entropy, regime } */
function foldField(entries, deltas, O, P) {
  const F = O.field, st = { ...F.start }, recent = [], out = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    for (const k of DIMS) st[k] += (F.neutral - st[k]) * F.damping;
    const nudge = F.nudges[e.kind];
    if (nudge) {
      const scale = F.pressure_scaled.includes(e.kind) ? (pressureOf(e, P) ?? 1) : 1;
      for (const k of DIMS) if (nudge[k]) st[k] += nudge[k] * scale;
    }
    if (e.kind !== 'checkpoint') {
      const key = keyOf(e);
      st.resonance += (STRESS.has(e.kind) && recent.includes(key)) ? F.repeat_step : -F.repeat_relief;
      recent.push(key); if (recent.length > F.repeat_window) recent.shift();
    }
    const d = deltas[i];
    if (d.measured) {
      const w = Math.min(1, d.latencyImpact / F.deviation_full_z);
      st.entropy += w * F.deviation_entropy; st.friction += w * F.deviation_friction;
    }
    for (const k of DIMS) st[k] = clamp(st[k]);
    out[i] = Object.freeze({ seq: e.seq, coherence: q4(st.coherence), friction: q4(st.friction), resonance: q4(st.resonance), entropy: q4(st.entropy), regime: regimeOf(st, F.regimes) });
  }
  return out;
}

/** how long the latest regime has held, counted in entries */
function holdOf(series) {
  if (!series.length) return { regime: 'stable', since: 0, entries: 0 };
  const last = series[series.length - 1];
  let i = series.length - 1;
  while (i > 0 && series[i - 1].regime === last.regime) i--;
  return { regime: last.regime, since: series[i].seq, entries: series.length - i };
}

module.exports = { foldField, regimeOf, holdOf, DIMS };
