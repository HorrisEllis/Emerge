'use strict';
const { computeDigest } = require('./digest');
const { DEFAULT_PROMOTE_THRESHOLD } = require('./population');
const { preGenerationCheck } = require('./pregen');

/**
 * Version: 1.4.1 — exact cache may be written on first success when a caller
 *   opts in (exactCacheOnFirstSuccess). See docs/warp-devkit-addendum-v1.4.1.spec.
 *   Default behaviour unchanged.
 *
 * unifiedDispatch — the seven steps from warp.spec + the v1.4 patch, as
 * one function. This is the actual merge: not three systems, one path
 * an event takes.
 *
 * 1. exact-cache check      (Bazel CAS pattern)
 * 1.5 pre-generation filter (v1.4 — fuzzy structural reuse, opt-in)
 * 2. population seed        (AlphaEvolve pattern)
 * 3. cascade-generate       (cheap-first cost pattern)
 * 4. axiom-gate             (hard rejection, never silent; v1.4 cost-weighted)
 * 5. score-and-retain       (evolutionary retention + promotion)
 * 6. escalate-on-failure    (context-fed retry, not blind)
 */
async function unifiedDispatch({
  gateSignature, gateClass, event, axioms, crystallizer, population,
  scorer, cascade, expectedShapeKeys = [], tokenBudget = null,
  exploreWidth = 1, log = null,
  // v1.4 additions — both opt-in, both off by default, matching every
  // other addition in this file: new behavior only activates when a
  // caller explicitly asks for it.
  preGeneration = null, // { enabled: true, threshold: 0.87 } to turn on
  skipVerifiedSoftAxioms = false,
  // §COMPOUNDING 2026-07-09 — opt-in, off by default, following this file's
  // own stated law two lines above. When true, a first successful, hard-gate-
  // validated output for an IDENTICAL input (exact digest) is written to the
  // exact cache immediately, instead of waiting for three independent
  // regenerations. See the comment at step 5. exactCacheFitnessMin mirrors
  // population.js's DEFAULT_FITNESS_MIN (0.7), passed rather than imported so
  // this module keeps its zero-coupling to population's internals.
  exactCacheOnFirstSuccess = false,
  exactCacheFitnessMin = 0.7,
}) {
  // v1.0.1: digest now hashes full canonicalized event.data, not just its
  // keys — fixes the collision bug where two different requests with the
  // same shape produced the same cache key. See dispatch/digest.js header.
  const digest = computeDigest({ gateSignature, axioms, eventData: event.data });

  // Step 1 — exact cache
  const cached = crystallizer.get(digest);
  if (cached) {
    log?.record({ step: 'exact-cache', result: 'hit', digest, cost: 0 });
    return { ok: true, output: cached, source: 'crystal', cost: 0, digest };
  }
  log?.record({ step: 'exact-cache', result: 'miss', digest });

  // Step 1.5 — pre-generation filter (v1.4). A fuzzy cousin of step 1:
  // "no exact digest match, but something structurally close enough
  // already exists in the population, reuse it instead of generating."
  // The reused output is NOT returned as-is — it still runs the axiom
  // gate below like any other candidate. Fuzzy reuse skips *generation*,
  // never skips *verification*.
  let pregenReuse = null;
  if (preGeneration?.enabled) {
    const result = preGenerationCheck({
      eventData: event.data, population, gateClass,
      threshold: preGeneration.threshold, log,
    });
    if (result.action === 'reuse') pregenReuse = result.variant;
  }

  // Step 2 — population seed
  const seed = population.seed(gateClass);
  log?.record({ step: 'population-seed', result: seed ? 'found' : 'empty', gateClass });

  // Step 3 — cascade generate, with bounded exploration ("recursive
  // simulation until best method") per exploreWidth. Default 1 = a single
  // attempt, same cost as before. exploreWidth > 1 runs multiple candidates
  // and keeps the one that scores highest — not the first that merely
  // passes — trading extra generation cost now for a better crystal later.
  // This only runs on a miss; once promoted, exploration cost is paid
  // exactly once per gate-class-digest, never repeated.
  //
  // v1.4: if the pre-generation filter found a fuzzy match, that reused
  // output becomes the single candidate instead of invoking cascade() at
  // all — this is the actual "avoid generation" saving. exploreWidth is
  // ignored in this branch: there's nothing to explore, only one thing
  // to verify.
  const candidates = pregenReuse
    ? [{ ok: true, output: pregenReuse.output, attempts: [], reusedFrom: pregenReuse.digest }]
    : await (async () => {
      const out = [];
      for (let i = 0; i < Math.max(1, exploreWidth); i++) out.push(await cascade({ seed, event }));
      return out;
    })();
  log?.record({
    step: 'cascade-generate',
    candidates: candidates.length,
    attempts: candidates.reduce((s, c) => s + (c.attempts?.length ?? (pregenReuse ? 0 : 1)), 0),
    source: pregenReuse ? 'pre-generation-reuse' : 'cascade',
  });

  // Step 4 — axiom gate, applied per-candidate; only passing candidates
  // compete on score.
  //
  // v1.4 cost weighting: axioms are evaluated highest-weight-first (hard
  // before soft by default), so an expensive soft check never delays a
  // cheap hard rejection. A SOFT axiom may be skipped — treated as
  // passed, logged as skipped, never silently dropped — only when
  // skipVerifiedSoftAxioms is true AND this exact digest already has a
  // population variant on record (i.e. this content was seen and scored
  // before). HARD axioms are never skipped, under any option, for any
  // reason — that guarantee is not configurable, on purpose.
  const orderedAxioms = [...axioms].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const existingVariant = skipVerifiedSoftAxioms
    ? population.variantsFor(gateClass).find(v => v.digest === digest)
    : null;

  // §fix 2026-07-05: evaluateAxioms() used to close over the outer `event`
  // param only — every candidate in the loop below was checked against the
  // fixed *request* event, never against what cascade() actually produced.
  // The axiom-gate ran, logged a result, and always checked the same
  // thing regardless of which candidate was being scored: a pass/fail that
  // looked like verification but wasn't reading the content it was meant
  // to gate. Same failure shape as the bridge/router.js `.response` bug —
  // matches at the outer call, wrong underneath. Axiom.check's own
  // contract ("predicate the Stream runs against every transform") means
  // "transform" here is the candidate's output, so that's what gets passed.
  function evaluateAxioms(candidateEvent) {
    const axiomFailures = [];
    const skipped = [];
    for (const axiom of orderedAxioms) {
      if (axiom.severity === 'soft' && existingVariant) {
        skipped.push(axiom.id);
        continue; // logged via `skipped`, not silently omitted
      }
      const passed = axiom.check(candidateEvent, { signature: gateSignature }, {});
      if (!passed) axiomFailures.push({ axiomId: axiom.id, severity: axiom.severity });
    }
    if (skipped.length) log?.record({ step: 'axiom-gate', result: 'soft-skip', axioms: skipped, reason: 'cache-verified', digest });
    return axiomFailures;
  }

  // Each candidate is checked against an event carrying ITS OWN output,
  // not the shared request event — this is the actual fix, everything
  // above is unchanged plumbing.
  const candidateEventFor = (cascadeResult) => ({
    ...event,
    data: { ...event.data, output: cascadeResult.output },
  });

  const scored = [];
  for (const cascadeResult of candidates) {
    const axiomFailures = evaluateAxioms(candidateEventFor(cascadeResult));
    const hardFail = axiomFailures.some(f => f.severity === 'hard');
    if (hardFail) continue; // this candidate is out, others may still pass
    const fitness = scorer({ axiomFailures, output: cascadeResult.output, expectedShapeKeys, tokenBudget });
    scored.push({ cascadeResult, axiomFailures, fitness });
  }

  if (scored.length === 0) {
    // Every candidate failed hard axioms — report the failures against the
    // last candidate actually tried (representative), never silently
    // report "nothing happened."
    const last = candidates[candidates.length - 1];
    const axiomFailures = evaluateAxioms(candidateEventFor(last));
    log?.record({ step: 'axiom-gate', result: 'reject-all-candidates', failures: axiomFailures });
    return { ok: false, output: null, source: 'rejected', failures: axiomFailures, digest };
  }

  // Best of the surviving candidates by fitness — "recursive simulation
  // until you find the best method" made concrete: not first-pass, best-pass.
  scored.sort((a, b) => b.fitness - a.fitness);
  const { cascadeResult, fitness } = scored[0];
  log?.record({ step: 'axiom-gate', result: 'pass', survivors: scored.length, chosenFitness: fitness });

  // Step 5 — score and retain (fitness already computed above during
  // selection). sourceEventData is stored alongside so pregen.js can
  // fuzzy-match future events against this shape.
  const readyToPromote = population.retain(gateClass, {
    output: cascadeResult.output, fitness, digest,
    sourceEventData: event.data, success: cascadeResult.ok,
  });
  log?.record({ step: 'score-and-retain', fitness, readyToPromote });

  // §COMPOUNDING 2026-07-09 — WARP did not compound, and its own header said
  // so: "the exact-cache isn't populated after one success ... an identical
  // chunk has to be independently re-generated and retained 3 times."
  //
  // That conflated two different mechanisms:
  //   - POPULATION is generalization. A gateClass variant is promoted only
  //     after DEFAULT_PROMOTE_THRESHOLD (3) independent successes clearing a
  //     fitness floor, because it will be reused for inputs that are SIMILAR,
  //     not identical. Three trials is the right bar for that. Unchanged.
  //   - The EXACT CACHE is memoization. `digest` is content-addressed over the
  //     request event (see dispatch/digest.js): a hit means the input is
  //     IDENTICAL, not similar. Requiring three regenerations of identical
  //     input is three times the tokens for one answer, and means the cache
  //     can never make the next build cheaper than the last.
  //
  // Safety, verified rather than assumed: step 4 returns
  // `{ok:false, source:'rejected'}` on any HARD axiom failure before reaching
  // here, so every output at this point is already hard-gate validated. We
  // additionally require cascadeResult.ok and the same fitness floor the
  // promotion path uses, so a barely-passing variant is never frozen forever.
  //
  // Effect: each successful build makes the identical next one cost 0. That is
  // what compounding means — the value accumulates instead of resetting.
  const exactCacheable = exactCacheOnFirstSuccess
    && cascadeResult.ok
    && cascadeResult.output != null
    && fitness >= exactCacheFitnessMin;

  if (readyToPromote) {
    crystallizer.set(digest, cascadeResult.output);
    log?.record({ step: 'promote', digest, threshold: DEFAULT_PROMOTE_THRESHOLD });
  } else if (exactCacheable) {
    crystallizer.set(digest, cascadeResult.output);
    log?.record({ step: 'exact-cache-write', digest, fitness, reason: 'first-success-identical-input' });
  }

  return {
    ok: cascadeResult.ok,
    output: cascadeResult.output,
    source: pregenReuse ? 'pre-generation-reuse' : 'generated',
    fitness,
    attempts: cascadeResult.attempts?.length ?? 1,
    // §2026-09-21 — the per-attempt record (provider, passed, failures,
    // error) runCascade already keeps. `attempts` stays a count for every
    // existing caller; this carries the WHY, which was being dropped here —
    // so a failed chunk could only ever say "failed after 3 attempt(s)".
    attemptLog: Array.isArray(cascadeResult.attempts) ? cascadeResult.attempts : [],
    digest,
  };
}

module.exports = { unifiedDispatch };
