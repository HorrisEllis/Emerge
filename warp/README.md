# warp

Pure functional event-driven devkit. `Event -> Gate -> Stream -> StreamLog`,
plus `Axiom` as an enforced primitive, and `unifiedDispatch` — the
exact-cache / pre-generation-filter / population / cascade / axiom-gate /
score-retain / escalate pipeline in one function.

Zero dependencies. Nothing in `core/`, `dispatch/`, or `plugins/` imports
anything outside this folder — verified by running the full test suite
in a directory with no connection to any other project. See
`MANIFEST.json`'s `decoupling_rule` and `warp.spec` for the full contract.

## Install

Drop this folder into any project, or `npm install` it directly (no
dependencies to resolve either way):

```js
const warp = require('@jamesbrooks/warp');
// or destructure what you need:
const { Event, Gate, Axiom, Stream, unifiedDispatch, PopulationStore } = require('@jamesbrooks/warp');
```

> The unscoped name `warp` is already taken on npm (an unrelated
> Containers-as-a-Service SDK) — that's why this publishes under a scoped
> name instead. `@jamesbrooks/warp` is a placeholder built from the
> `LICENSE` attribution; swap it for your actual npm username/org in
> `package.json`'s `name` field before publishing if it's different.

## Test

```
npm test
```

31 tests, all self-contained.

## What's in here

- **`core/`** — `Event`, `Gate`, `Axiom`, `Stream`, `StreamLog`, `GateFusion`. The five primitives.
- **`dispatch/`** — `unifiedDispatch` and its supporting pieces: `canonicalize` (digest/fingerprint), `cascade` (cheap-first generation), `population` (evolutionary retention + pluggable promotion policy), `pregen` (fuzzy structural reuse), `deltaCache` (structural diffs).
- **`plugins/`** — `FlatFileCrystallizer` and `scoreDefault` are reference implementations, not requirements. Swap either for your own via `Stream.hook()`.
- **`index.js`** — the one addition beyond a straight copy: a single entry point re-exporting `core` + `dispatch` + `plugins`, since none existed before (only `core/index.js` and `dispatch/index.js` separately).

## Opt-in upgrades (high leverage, all off by default)

Every one of these is additive — existing callers see zero behavior
change until they explicitly turn it on. That's a deliberate, consistent
rule across the whole package, not a per-feature choice:

| Upgrade | Turn it on with | What it buys |
|---|---|---|
| **Compounding** (`firstSuccessPromotionPolicy`) | `new PopulationStore({ promotionPolicy: firstSuccessPromotionPolicy })` | Crystallizes into the exact cache after **1** success above the fitness floor, instead of the default 3 retentions. Trades a little confidence (fewer retentions' evidence) for much faster payoff on repeated identical work. |
| **Fuzzy pre-generation reuse** | `unifiedDispatch({ preGeneration: { enabled: true, threshold: 0.87 } })` | Skips *generation* (never verification) when something structurally close enough already exists in the population — a near-miss still reuses instead of paying for a fresh model call. |
| **Bounded exploration** | `unifiedDispatch({ exploreWidth: 3 })` | Runs multiple candidates per miss, keeps the highest-scoring one — not the first that merely passes. Extra cost now, better crystal later; paid once per gate-class-digest, never repeated. |
| **Soft-axiom skip on verified repeats** | `unifiedDispatch({ skipVerifiedSoftAxioms: true })` | A soft axiom is treated as passed (logged as skipped, never silently dropped) only when this exact digest already has a scored population variant on record. Hard axioms are never skippable, under any option — not configurable, on purpose. |
| **Population decay / pruning / dedup** | `new PopulationStore({ decayRate: 0.1, pruneThreshold: 0.6 })` | Untouched variants lose fitness on every retain; variants below threshold get pruned; only the fittest variant per structural fingerprint survives. Keeps the population from growing unbounded. |
| **Two-stage generation** | `runTwoStage({ ... })` | Skips refinement when a skeleton pass validates cleanly; escalates to a refinement pass on failed validation or low confidence. |
| **Gate fusion** | `fuseChain([gateA, gateB], 'fused-signature')` | Runs two gates as one fused stage — events that don't match the next stage are preserved, not dropped. |
| **Axiom cost weighting** | pass `weight` on an `Axiom` (hard defaults 1.0, soft 0.3) | Axioms evaluate highest-weight-first, so an expensive soft check never delays a cheap hard rejection. |
| **Structural delta cache** | `DeltaCrystallizer` (`dispatch/deltaCache.js`) | First entry per class stored in full; later entries stored as diffs against it, both reconstruct exactly. |

Everything above composes — e.g. compounding + fuzzy reuse + exploration
width can all be on at once, each independently opt-in.

One test file from the original suite is not included: a benchmark that
loads an external reference implementation from outside this package to
measure relative behavior, which breaks the zero-coupling guarantee for
a standalone drop-in. The 4 fully self-contained test files (31
assertions total) are included and verified passing in isolation.

## Promotion policies

Three are provided, same shape, pick one at construction:

```js
new PopulationStore()                                              // default: 3 hits, fitness >= 0.7
new PopulationStore({ promotionPolicy: reuseCountPromotionPolicy }) // 2 hits, success rate >= 0.7
new PopulationStore({ promotionPolicy: firstSuccessPromotionPolicy }) // 1 hit, fitness >= 0.7 ("compounding")
```
