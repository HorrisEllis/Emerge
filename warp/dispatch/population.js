'use strict';
/**
 * population.js — scored archive per gate-class. AlphaEvolve/FunSearch
 * pattern, scaled down: keep variants, not just one "best" attempt. Next
 * miss seeds from the fittest survivor instead of a blank page.
 *
 * v1.0.1 changes, both adopted from external review after verification:
 *  - promotion policy is now pluggable (default preserved as before) —
 *    different consumers may weight stability vs latency vs cost
 *    differently; hardcoding one threshold for everyone was too rigid.
 *  - hierarchical seed fallback: gate-class keys may be dot-namespaced
 *    ('sql.select.where' etc). If no population exists for the exact
 *    class, seed() walks up to the parent class ('sql.select') before
 *    giving up. This is "pattern cache" from the review — not a new
 *    primitive, just a coarser lookup on the same store.
 */
const { fingerprintKey } = require('./canonicalize');

const DEFAULT_PROMOTE_THRESHOLD = 3;
const DEFAULT_FITNESS_MIN = 0.7;

function defaultPromotionPolicy(variant) {
  return variant.hits >= DEFAULT_PROMOTE_THRESHOLD && variant.fitness >= DEFAULT_FITNESS_MIN;
}

// v1.4 — "promotion_rule: to_exact_cache_if reuse_count >= 2, success_rate
// >= 0.7." Deliberately a *different* named policy, not a replacement for
// defaultPromotionPolicy: reuse_count is variant.hits (already tracked),
// but success_rate is a new concept — fraction of retains that were
// axiom-passing successes, as opposed to fitness (a continuous score that
// already folds in axiom failures at 0.15/soft-failure). A variant that
// passes cleanly every time but scores 0.65 on shape-match would promote
// under this policy but not the default one, and vice versa — pick
// whichever matches what "safe to promote" means for your gates.
function reuseCountPromotionPolicy(variant) {
  const successRate = variant.attempts > 0 ? variant.successes / variant.attempts : 0;
  return variant.hits >= 2 && successRate >= 0.7;
}

// "Compounding" policy — the missing third option `warp-compounding.test.js`
// was written against before it existed. A single success above the fitness
// floor crystallizes immediately, instead of waiting for DEFAULT_PROMOTE_
// THRESHOLD (3) retentions. Same shape as the two policies above — pass it
// explicitly, nothing changes for existing callers:
//   new PopulationStore({ promotionPolicy: firstSuccessPromotionPolicy })
// Real cost: a bad-but-above-floor first attempt crystallizes without the
// benefit of 2 more retentions' evidence that defaultPromotionPolicy gets.
// That trade is the point of opting in, not a bug — same floor
// (DEFAULT_FITNESS_MIN) still applies, so nothing below 0.7 ever freezes.
function firstSuccessPromotionPolicy(variant) {
  return variant.hits >= 1 && variant.fitness >= DEFAULT_FITNESS_MIN;
}

class PopulationStore {
  constructor({
    promotionPolicy = defaultPromotionPolicy,
    maxPerClass = 8,
    decayRate = 0,
    pruneThreshold = 0,
  } = {}) {
    this._byClass = new Map(); // gateClass -> [{ output, fitness, hits, digest, fingerprint, sourceEventData, attempts, successes }]
    this._promotionPolicy = promotionPolicy;
    this._maxPerClass = maxPerClass;
    // v1.4 population_control — decay/pruning/dedup. Default OFF
    // (decayRate: 0, pruneThreshold: 0), matching every other WARP addition
    // in this codebase: new mechanisms are additive and opt-in, existing
    // callers see zero behavior change until they ask for it. The spec
    // patch's suggested values (rate: 0.1, threshold_score: 0.6) are the
    // recommended starting point — pass them explicitly:
    //   new PopulationStore({ decayRate: 0.1, pruneThreshold: 0.6 })
    this._decayRate = decayRate;
    this._pruneThreshold = pruneThreshold;
  }

  seed(gateClass) {
    let pop = this._byClass.get(gateClass);
    if (pop && pop.length > 0) {
      return pop.reduce((best, v) => (v.fitness > best.fitness ? v : best), pop[0]);
    }
    // Hierarchical fallback — 'sql.select.where' -> try 'sql.select' -> 'sql'
    const parts = gateClass.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const parentClass = parts.slice(0, i).join('.');
      pop = this._byClass.get(parentClass);
      if (pop && pop.length > 0) {
        const best = pop.reduce((b, v) => (v.fitness > b.fitness ? v : b), pop[0]);
        return { ...best, fromParentClass: parentClass }; // marked — this is a borrow, not an exact-class seed
      }
    }
    return null;
  }

  // retain(gateClass, { output, fitness, digest, sourceEventData, success })
  // sourceEventData (v1.4): the event.data this variant was generated from —
  // stored so pregen.js can compute similarityScore() against future
  // events. Optional; omitted callers just don't participate in fuzzy
  // pre-generation matching, exact-cache and seeding still work as before.
  // success (v1.4): did this generation pass axioms cleanly (bool)? Feeds
  // reuseCountPromotionPolicy's success_rate. Defaults true for backward
  // compatibility — unifiedDispatch only calls retain() on already-passed
  // candidates today, so "true" matches actual existing call sites exactly.
  retain(gateClass, { output, fitness, digest, sourceEventData, success = true }) {
    if (!this._byClass.has(gateClass)) this._byClass.set(gateClass, []);
    const pop = this._byClass.get(gateClass);
    const existing = pop.find(v => v.digest === digest);
    if (existing) {
      existing.hits++;
      existing.fitness = (existing.fitness + fitness) / 2; // running average
      existing.attempts++;
      if (success) existing.successes++;
    } else {
      pop.push({
        output, fitness, digest, hits: 1,
        attempts: 1, successes: success ? 1 : 0,
        sourceEventData,
        fingerprint: sourceEventData !== undefined ? fingerprintKey(sourceEventData) : null,
      });
    }

    // v1.4 decay — every retain() is a tick. Variants in this class not
    // touched *this* retain (i.e. every variant except the one just
    // updated) age by decayRate. This is event-driven aging, not
    // wall-clock: WARP has no clock primitive anywhere else either, so a
    // real-time decay would be the odd one out. Document the choice
    // rather than silently pick one.
    if (this._decayRate > 0) {
      for (const v of pop) {
        if (v.digest !== digest) v.fitness = Math.max(0, v.fitness * (1 - this._decayRate));
      }
    }

    // v1.4 pruning — drop anything that decayed/scored below threshold.
    // Never prune the variant just retained this call, even if its raw
    // fitness is below threshold — an explicit fresh signal shouldn't be
    // discarded in the same tick it arrived.
    if (this._pruneThreshold > 0) {
      for (let i = pop.length - 1; i >= 0; i--) {
        if (pop[i].digest !== digest && pop[i].fitness < this._pruneThreshold) pop.splice(i, 1);
      }
    }

    // v1.4 deduplication — two variants can have different exact digests
    // (different content) but the same structural fingerprint (same
    // shape). Keep only the fittest per fingerprint; a population meant
    // to seed *structurally* diverse attempts gains nothing from ten
    // near-identical shapes crowding out real diversity.
    this._dedupeByFingerprint(pop);

    if (pop.length > this._maxPerClass) {
      pop.sort((a, b) => b.fitness - a.fitness);
      pop.length = this._maxPerClass;
    }
    return this._readyToPromote(gateClass, digest);
  }

  _dedupeByFingerprint(pop) {
    const byFp = new Map();
    for (const v of pop) {
      if (!v.fingerprint) continue; // no fingerprint stored -> can't dedupe safely, leave alone
      const existing = byFp.get(v.fingerprint);
      if (!existing || v.fitness > existing.fitness) byFp.set(v.fingerprint, v);
    }
    if (byFp.size === 0) return;
    for (let i = pop.length - 1; i >= 0; i--) {
      const v = pop[i];
      if (v.fingerprint && byFp.get(v.fingerprint) !== v) pop.splice(i, 1);
    }
  }

  _readyToPromote(gateClass, digest) {
    const pop = this._byClass.get(gateClass);
    const v = pop.find(x => x.digest === digest);
    if (!v) return false;
    return this._promotionPolicy(v);
  }

  // v1.4 — full variant list for a class, used by pregen.js's fuzzy match.
  // Distinct from seed() (which returns only the single fittest variant)
  // because similarity matching needs to compare against every candidate,
  // not just the current leader.
  variantsFor(gateClass) {
    return [...(this._byClass.get(gateClass) || [])];
  }

  stats(gateClass) {
    const pop = this._byClass.get(gateClass) || [];
    return { size: pop.length, variants: pop.map(v => ({ digest: v.digest, fitness: v.fitness, hits: v.hits, attempts: v.attempts, successes: v.successes })) };
  }
}

module.exports = {
  PopulationStore, DEFAULT_PROMOTE_THRESHOLD, DEFAULT_FITNESS_MIN,
  defaultPromotionPolicy, reuseCountPromotionPolicy, firstSuccessPromotionPolicy,
};

