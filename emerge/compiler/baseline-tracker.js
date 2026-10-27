'use strict';
/**
 * compiler/baseline-tracker.js
 * UUID: mod-baseline-tracker-v1-0000-0001
 * Version: 1.0.0
 *
 * INVARIANT BASELINE AS TRAJECTORY.
 *
 * SOURCE THEORY (from Causal Substrate / Causal Nexus Compress v6):
 *
 *   The baseline is NOT a static checklist.
 *   It is a continuous signal for each invariant:
 *
 *     score    — current value (0-1)
 *     history  — rolling window of past scores
 *     mean     — rolling mean over window
 *     std      — standard deviation (stability measure)
 *     trend    — improving | stable | degrading
 *     peak     — best ever observed { score, ts }
 *     nadir    — worst ever observed { score, ts }
 *
 *   §C-1  Nothing is estimated. Every score is computed, not assumed.
 *   §C-3  Invariants are signals, not judgments.
 *   §C-4  Timelines are first-class objects. Health is a trajectory.
 *   §C-5  The baseline evolves. A static checklist is a lie over time.
 *
 * WHAT IT TRACKS:
 *   After every KG build and every mutation, feed a ViolationReport.
 *   The tracker records pass/fail per invariant, computes rolling scores,
 *   detects trends, and surfaces the composite health trajectory.
 *
 * FEEDS:
 *   → ring-buffer (baseline score is a mutation event to record)
 *   → reply-engine (degrading baseline → defer T2 dispatch)
 *   → gap-field-engine (nadir score → gap severity amplifier)
 *
 * SIGMA REGIMES (from Resonance Engine):
 *   STABLE     — variance low, trend flat
 *   IMPROVING  — trend positive, mean rising
 *   DEGRADING  — trend negative, mean falling
 *   VOLATILE   — variance high regardless of direction
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const WINDOW_SIZE  = 20;  // rolling window depth
const TREND_WINDOW = 5;   // recent samples for trend detection

const TREND = Object.freeze({
  IMPROVING: 'improving',
  STABLE:    'stable',
  DEGRADING: 'degrading',
});

const SIGMA = Object.freeze({
  STABLE:    'stable',
  IMPROVING: 'improving',
  DEGRADING: 'degrading',
  VOLATILE:  'volatile',
});

const STATUS = Object.freeze({
  PASS: 'pass',   // score >= 0.95
  WARN: 'warn',   // score >= 0.80
  FAIL: 'fail',   // score < 0.80
});

// The eight invariants the engine tracks (mirrors invariants-engine.js)
const INVARIANT_IDS = [
  'INV-001', 'INV-002', 'INV-003', 'INV-004',
  'INV-005', 'INV-006', 'INV-007', 'INV-008',
];

// ── Math helpers ──────────────────────────────────────────────────────────────

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(x => (x - m) ** 2)));
}
function r4(n) { return Math.round((n ?? 0) * 10000) / 10000; }

// ── Invariant signal ──────────────────────────────────────────────────────────

function makeInvariantSignal(id) {
  return {
    id,
    score:   1.0,
    history: [],   // rolling window of scores
    mean:    1.0,
    std:     0.0,
    trend:   TREND.STABLE,
    peak:    { score: 1.0, ts: Date.now() },
    nadir:   { score: 1.0, ts: Date.now() },
    status:  STATUS.PASS,
    samples: 0,
  };
}

function updateSignal(signal, score, ts = Date.now()) {
  signal.score   = r4(score);
  signal.history = [...signal.history.slice(-(WINDOW_SIZE - 1)), score];
  signal.mean    = r4(mean(signal.history));
  signal.std     = r4(std(signal.history));
  signal.samples++;

  // Peak / nadir
  if (score > signal.peak.score)  signal.peak  = { score: r4(score), ts };
  if (score < signal.nadir.score) signal.nadir = { score: r4(score), ts };

  // Trend from recent TREND_WINDOW samples
  const recent = signal.history.slice(-TREND_WINDOW);
  if (recent.length >= 2) {
    const slope = (recent[recent.length - 1] - recent[0]) / recent.length;
    if (slope > 0.02)       signal.trend = TREND.IMPROVING;
    else if (slope < -0.02) signal.trend = TREND.DEGRADING;
    else                    signal.trend = TREND.STABLE;
  }

  // Status
  if (signal.score >= 0.95)     signal.status = STATUS.PASS;
  else if (signal.score >= 0.80) signal.status = STATUS.WARN;
  else                           signal.status = STATUS.FAIL;

  return signal;
}

// ── Baseline tracker ──────────────────────────────────────────────────────────

class BaselineTracker {
  constructor(options = {}) {
    this._windowSize = options.windowSize ?? WINDOW_SIZE;
    this._signals    = new Map();
    this._composite  = makeInvariantSignal('COMPOSITE');
    this._history    = [];   // composite score history with timestamps
    this._buildCount = 0;

    // Initialise per-invariant signals
    for (const id of INVARIANT_IDS) {
      this._signals.set(id, makeInvariantSignal(id));
    }
  }

  /**
   * record(violationReport)
   *
   * Feed a ViolationReport from the invariants engine.
   * Updates every invariant signal and the composite.
   * Returns the updated baseline snapshot.
   */
  record(violationReport) {
    if (!violationReport) return this.snapshot();

    const ts         = violationReport.checkedAt ?? Date.now();
    const violations = violationReport.violations ?? [];
    this._buildCount++;

    // Score per invariant: 1.0 if no violations, lower based on severity
    const scored = new Map();
    for (const id of INVARIANT_IDS) scored.set(id, 1.0);

    for (const v of violations) {
      const id = v.invariantId;
      if (!scored.has(id)) continue;
      const penalty = v.severity === 'critical' ? 0.5 : v.severity === 'warn' ? 0.2 : 0.05;
      scored.set(id, Math.max(0, (scored.get(id) ?? 1.0) - penalty));
    }

    // Update each invariant signal
    for (const [id, score] of scored) {
      const signal = this._signals.get(id) ?? makeInvariantSignal(id);
      updateSignal(signal, score, ts);
      this._signals.set(id, signal);
    }

    // Composite = mean of all invariant scores
    const allScores     = [...scored.values()];
    const compositeScore = r4(mean(allScores));
    updateSignal(this._composite, compositeScore, ts);

    // Push to history
    this._history.push({
      ts,
      score:       compositeScore,
      trend:       this._composite.trend,
      buildCount:  this._buildCount,
      violations:  violations.length,
    });
    if (this._history.length > 100) this._history.shift();

    return this.snapshot();
  }

  /**
   * snapshot() → BaselineSnapshot
   * Current state of all signals.
   */
  snapshot() {
    const signals    = {};
    for (const [id, s] of this._signals) signals[id] = { ...s, history: [...s.history] };
    const composite = { ...this._composite, history: [...this._composite.history] };

    // Sigma regime (from Resonance Engine)
    const sigma = this._classifySigma();

    // Detect peak window (best sustained health)
    const peak = this._detectPeak();

    return {
      signals,
      composite,
      sigma,
      peak,
      buildCount:  this._buildCount,
      history:     [...this._history],
      isHealthy:   composite.score >= 0.95 && composite.trend !== TREND.DEGRADING,
      isAt:        composite.status,
      summarize:   () => [
        `composite: ${composite.score.toFixed(3)} | ${composite.trend} | ${composite.status}`,
        `sigma: ${sigma}`,
        `peak: ${peak?.score?.toFixed(3) ?? 'n/a'} @ build ${peak?.buildCount ?? 'n/a'}`,
        `fail: ${Object.values(signals).filter(s => s.status === STATUS.FAIL).map(s => s.id).join(', ') || 'none'}`,
      ].join(' | '),
    };
  }

  /**
   * diff(snapshotA, snapshotB) → StateDelta
   * Compare two baseline snapshots — what changed between them.
   */
  static diff(a, b) {
    const delta = {};
    for (const id of INVARIANT_IDS) {
      const sa = a.signals[id];
      const sb = b.signals[id];
      if (!sa || !sb) continue;
      const scoreDelta = r4(sb.score - sa.score);
      if (Math.abs(scoreDelta) > 0.001) {
        delta[id] = {
          from:  r4(sa.score),
          to:    r4(sb.score),
          delta: scoreDelta,
          trend: sb.trend,
        };
      }
    }
    return {
      compositeDelta: r4((b.composite?.score ?? 0) - (a.composite?.score ?? 0)),
      changedInvariants: delta,
      buildDelta: (b.buildCount ?? 0) - (a.buildCount ?? 0),
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _classifySigma() {
    const recent = this._history.slice(-10).map(h => h.score);
    if (recent.length < 3) return SIGMA.STABLE;
    const s     = std(recent);
    const slope = recent.length >= 2 ? (recent[recent.length-1] - recent[0]) / recent.length : 0;
    if (s > 0.15)         return SIGMA.VOLATILE;
    if (slope > 0.02)     return SIGMA.IMPROVING;
    if (slope < -0.02)    return SIGMA.DEGRADING;
    return SIGMA.STABLE;
  }

  _detectPeak() {
    if (this._history.length < 3) return null;
    // Rolling mean over window of 3 — find highest sustained mean
    let best = null, bestMean = -1;
    for (let i = 2; i < this._history.length; i++) {
      const window = this._history.slice(Math.max(0, i - 2), i + 1);
      const m      = mean(window.map(h => h.score));
      if (m > bestMean) {
        bestMean = m;
        best     = { ...this._history[i], rollingMean: r4(m) };
      }
    }
    return best;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

function createBaselineTracker(options = {}) {
  return new BaselineTracker(options);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  createBaselineTracker,
  BaselineTracker,
  TREND,
  SIGMA,
  STATUS,
  INVARIANT_IDS,
  BASELINE_VERSION: require('../version').BASELINE,
};
