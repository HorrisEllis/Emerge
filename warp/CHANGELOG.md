# Changelog

## 2.0.1

James: "can you benchmark it?"

- The benchmark found two bugs, now fixed.
  - **Wrong answer:** an expectation on a link could only be declared after its emit returned. By then a synchronous handler had already produced the effect, so every expectation broke. It reported 20000 of 20000 causes without their effect instead of 2000. Now `emit(type, data, { expect: [{ effect, within }] })` declares the expectation with the link, before any handler runs.
  - **Slow:** every emit scanned every open expectation, which was quadratic. Open expectations are now indexed by effect, and by the cause link when the cause is a link.
- `scripts/bench-warp2-vs-siso.mjs` in Nexus measures SISO, WARP 1.x and WARP 2 on one workload.

## 2.0.0

James: "still i want to make warp mine" · "no. i want warp 2"

- WARP 2, written fresh beside 1.x:
  - `core/Link.js`: the atom is a link, cause → effect, carrying its field values. Nothing exists without its cause, except a root, which says it is one and why.
  - `core/Expectation.js`: declared before anything happens ("this must cause that within N ticks"). Held open until fulfilled, through any number of middle links, or broken. A broken one is a gap naming both ends.
  - `core/Ledger.js`: causal, append-only, hash-chained. Each link's parent is recorded the moment it is known. `chain(id)` walks to the root.
  - `core/Engine.js`: `emit(type, data, { causedBy } | { root })`, `on`, `expect`, `advance`, `residue()`. Every link passes the Axioms (1.x Axiom objects as they are), then the constraints, before it is real. A handler's emits are caused by the link it was handed.
- `adapters/siso-gates.js`: a 1.x Stream runs unchanged and is recorded in a WARP 2 ledger.
  - An event emitted inside a gate is caused by that gate's input.
  - An event from outside any gate, or one produced after an async transform resolves, is a root marked "cause unknown (WARP 1.x)", never an invented cause.
- `adapters/emerge-field.js`: Emerge's constraints as the engine's `admit()`. A link is rejected with the constraint's id, or becomes a gap.
- `core/` still imports nothing outside `warp/`. The adapters are where WARP meets anything else.
- Not yet: 1.x's Event/Gate/Stream/StreamLog are still in `core/`, and Nexus's consumers still run on 1.x directly. They move one by one.

## 1.5.0

- Added `firstSuccessPromotionPolicy` — a third pluggable `PopulationStore` promotion policy ("compounding"): crystallizes into the exact cache after 1 success above the fitness floor, instead of the default 3 retentions. Same shape as the existing `defaultPromotionPolicy`/`reuseCountPromotionPolicy`, opt-in, no change to existing callers.
- Added a top-level `index.js` entry point re-exporting `core` + `dispatch` + `plugins` — previously there was no single import path, only `core/index.js` and `dispatch/index.js` separately.

## 1.4.0

- Canonicalization pipeline (`canonicalize`, `fingerprintKey`, `similarityScore`) — deterministic key-sorted digests for exact-cache hits, plus structural fingerprinting for fuzzy matches.
- Fuzzy pre-generation reuse (`preGeneration: { enabled, threshold }`, opt-in) — skips generation, never verification, when something structurally close enough already exists in the population.
- Population lifecycle control — `decayRate`/`pruneThreshold` on `PopulationStore` (both 0 by default, no-op unless configured): untouched variants decay on every retain, variants below threshold prune, only the fittest variant per structural fingerprint survives.
- Two-stage generation (`runTwoStage`) — skips refinement on a clean skeleton pass, escalates on failed validation or low confidence.
- Gate fusion (`fuseChain`, `canFuse`) — runs two gates as one fused stage, preserving events that don't match the next stage instead of dropping them.
- Axiom cost weighting — axioms evaluate highest-weight-first (hard 1.0, soft 0.3 default) so an expensive soft check never delays a cheap hard rejection. `skipVerifiedSoftAxioms` (opt-in) allows a soft axiom to be treated as passed only on an already-scored digest; hard axioms are never skippable under any option.
- Structural delta cache (`deltaCache.js`, `DeltaCrystallizer`) — first entry per class stored in full, later entries as diffs, both reconstruct exactly.
- `reuseCountPromotionPolicy` — a second named promotion policy (2 hits, success rate >= 0.7), alongside the existing default.

## 1.1.0

- Token axis — `estimateTokens`, `scoreDefault` rewards staying under a token budget and penalizes exceeding it.
- Bounded exploration (`exploreWidth`) — runs multiple candidates per miss, keeps the highest-scoring one, not just the first that passes. Defaults to 1 (no behavior change, no extra cost) for existing callers.
- Rollback — `crystallizer.invalidate()` rolls back a promoted entry.
- Schema validation — `Gate.schema` validates required keys and types with no external dependency.

## 1.0.1

- `Gate.transform` now **returns** the events it produces instead of calling `stream.emit()` as a side effect — a gate can be tested completely in isolation, asserting on the returned array, with no `Stream` object involved at all.
- Digest fix: `computeDigest` now hashes the full canonicalized `event.data`, not just its keys — fixes a collision bug where two different requests with the same shape produced the same cache key. An axiom version bump also now changes the digest, so old cache entries don't silently survive a rule change.

## 1.0.0

- Initial primitives: `Event`, `Gate`, `Axiom`, `Stream`, `StreamLog`.
- `Axiom` as an enforced invariant with the same standing as `Gate` — a hard violation rejects a transform outright, logged, never silently completed.
