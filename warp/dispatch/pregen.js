'use strict';
/**
 * pregen.js — v1.4 "pre-generation filter layer."
 *
 * Placement matters: this runs AFTER the exact-cache miss (step 1) and
 * BEFORE cascade generation (step 3), not before step 1. The spec patch
 * described it as avoiding generation when a "structurally equivalent"
 * solution already exists — that's necessarily fuzzy (similarityScore,
 * not digest equality), so it can only ever be a step *down* from the
 * exact cache, never a replacement for it. Fuzzy-reusing content-bearing
 * output is a correctness trade, not a free win, so:
 *
 *   - it is OFF by default (opts in via unifiedDispatch({ preGeneration }))
 *   - a reuse never bypasses axiom checks — the reused output still runs
 *     through the axiom gate before being returned, same as generated
 *     output. "Faster" never means "less verified."
 *   - every reuse is logged with its similarity score, so a false-positive
 *     reuse is traceable after the fact instead of an invisible cache
 *     poison.
 */
const { similarityScore } = require('./canonicalize');

const DEFAULT_THRESHOLD = 0.87;

/**
 * check({ eventData, population, gateClass, threshold, log })
 * -> { action: 'reuse', variant, score } | { action: 'proceed', bestScore }
 */
function preGenerationCheck({ eventData, population, gateClass, threshold = DEFAULT_THRESHOLD, log = null }) {
  const candidates = population.variantsFor ? population.variantsFor(gateClass) : [];
  let best = null;
  let bestScore = 0;

  for (const variant of candidates) {
    if (variant.sourceEventData === undefined) continue; // no stored sample to compare shape against
    const score = similarityScore(eventData, variant.sourceEventData);
    if (score > bestScore) {
      bestScore = score;
      best = variant;
    }
  }

  if (best && bestScore >= threshold) {
    log?.record({ step: 'pre-generation-filter', result: 'reuse', gateClass, score: bestScore, digest: best.digest });
    return { action: 'reuse', variant: best, score: bestScore };
  }

  log?.record({ step: 'pre-generation-filter', result: 'proceed', gateClass, bestScore });
  return { action: 'proceed', bestScore };
}

module.exports = { preGenerationCheck, DEFAULT_THRESHOLD };
