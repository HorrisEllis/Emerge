spec:
  meta:
    name:        warp
    version:     1.4.0
    status:      proposed
    license:     MIT — James Brooks, 2026. Written fresh, no code carried over
                 from any reference implementation. Ideas only (pure-functional
                 event pipelines are prior art, not ownable); every line here
                 is new.
    uuid:        warp-devkit-v1-0000-2026-0701-jamesbrooks-001
    purpose: >
      A standalone, zero-dependency devkit that makes correct LLM-generated
      code the path of least resistance — and gets faster and cheaper the
      longer it runs. Decoupled from NEXUS entirely: NEXUS imports WARP,
      WARP never imports NEXUS. Drop the zip into any project.
    non_goals: >
      Not a build system. Not a database. Not an agent framework. Not a
      model trainer. Not a replacement for judgment on what to build —
      only on how the "how" gets generated, verified, and reused. If a
      mechanism doesn't serve one of the five primitives below, it
      doesn't belong in core.

  # ── Five primitives — the whole surface a consuming project touches ────────
  primitives:
    Event:
      "immutable — { type, data, uuid, ts }. Never mutated after creation."
    Gate:
      "pure function — matches(event)→bool, transform(event)→Event[].
       Returns the events it produces; never emits as a side effect.
       Testable with zero Stream object involved. No side effects at all."
    Stream:
      "the dispatch loop — registers gates, runs the unified pipeline below
       on every emit, then emits whatever the fired gate returned. Depth-
       first by default; a valid future implementation may swap in an
       async/worker-pool executor without changing Gate's contract."
    StreamLog:
      "append-only audit trail. Observes, never consumes. Every dispatch
       step below writes here — nothing in WARP fails silently."
    Axiom:
      "id, version, check(event, gate, streamState)→bool, severity:
       hard|soft. Hard violation rejects the transform outright, logged,
       never swallowed. Version is included in the digest — a changed
       rule invalidates old cache entries rather than silently outliving
       the rule it was verified under."

  # ── The one dispatch algorithm — this is the actual merge ──────────────────
  # Everything from the research pass collapses into a single linear
  # pipeline. Not three bolted-on systems — one path an event takes.
  unified_dispatch:
    trigger: "Stream.emit(event) with no matching pure-deterministic gate
              already registered (i.e. this shape needs generation)"
    steps:
      1_exact_cache:
        mechanism: "digest = hash(gate signature + active axiom set + event
                     shape) — Bazel/Buck2's content-addressable cache pattern,
                     applied to generated transforms instead of build outputs."
        hit:  "zero-cost reuse. Done. No model call. This is real compounding —
               provable via digest match, not fuzzy 'looked similar enough.'"
        miss: "→ step 2"

      2_population_seed:
        mechanism: "no exact digest, but a population of prior variants
                     exists for this gate-class (AlphaEvolve/FunSearch
                     pattern — a small scored archive, not just one saved
                     'best' attempt)."
        action: "fittest surviving variant passed as an analogue/seed to the
                  model — never copied verbatim, informs the next attempt
                  the way AlphaEvolve seeds mutations from prior generations."
        empty:  "→ step 3 with no seed (cold start)"

      3_cascade_generate:
        mechanism: "cheapest capable model attempts first (small local model
                     before anything larger) — model cascading, the named
                     cost pattern from production research, already the
                     instinct behind retry ladders like this elsewhere."
        contract: "output must conform to the gate's declared structured
                    schema — not free text. Structured output is the single
                    largest lever on rework-token cost per the research."
        fanout: "single-path by default. Parallel/multi-model dispatch only
                  for gates with zero shared dependencies — fan-out costs
                  4-15x more tokens when the work isn't genuinely
                  independent; that cost is real, so it's opt-in, never
                  the default."

      4_axiom_gate:
        mechanism: "every hard Axiom runs against the output before
                     anything downstream sees it. One failure = reject,
                     logged with which axiom, why, what was expected —
                     never a silent drop."
        pass: "→ step 5"
        fail: "→ step 6"

      5_score_and_retain:
        mechanism: "Scorer plugin computes a generic four-axis fitness
                     (coherence/friction/resonance/entropy pattern — not
                     NEXUS's literal field.js, a portable reimplementation
                     of the same idea)."
        retain: "written into the gate-class's population (evolutionary
                  retention — future misses seed from this, not blank)."
        promote: "if fitness stays high across N repeats of the same exact
                   digest, promote from population → exact cache. This is
                   the compounding curve: cold start is slowest, every
                   repeat gets cheaper, converged shapes cost nothing."

      6_escalate_and_retry:
        mechanism: "failure + its axiom violation fed back as context to a
                     stronger model — never a blind identical retry. Same
                     ladder shape as a context/shorter/forensic strategy
                     progression, generalized past any one project's
                     naming."
        budget: "bounded retry count, exhaustion logged loud, escalated to
                  the caller — never a silent give-up."

  # ── Extension points — the only way anything attaches ──────────────────────
  hooks:
    contract: "Stream.hook(kind, plugin) — plugin is pure-function-shaped,
               same discipline as Gate. No special-casing per kind."
    kinds:
      scorer:       "the four-axis fitness function used in step 5"
      crystallizer: "storage adapter for the exact-cache (step 1) and
                     population store (steps 2/5) — ships with a trivial
                     flat-file default; a consuming project (NEXUS or
                     anything else) swaps in its own persistence layer
                     without WARP's core ever knowing it exists"
      cascader:     "defines the model-cascade order (step 3/6) — which
                     model is 'cheapest capable' is a project decision,
                     not baked into WARP"
    boundary_rule: >
      WARP's core imports nothing project-specific, ever. A consuming
      project imports WARP and wires adapters in. This is the whole
      decoupling guarantee — checkable by grep, not just a promise: zero
      require()/import of anything outside warp/core in warp/core/*.

  # ── Package layout ──────────────────────────────────────────────────────
  layout: |
    warp/
      core/
        Event.js  Gate.js  Stream.js  StreamLog.js  Axiom.js
        index.js                    — barrel export, zero deps
      dispatch/
        digest.js                   — step 1: content-addressable hash
        population.js                — steps 2/5: scored archive per gate-class
        cascade.js                   — steps 3/6: model-order + retry ladder
      plugins/
        scorer-default.js            — generic 4-axis fitness, portable
        crystallizer-flatfile.js     — default storage adapter
      test/
        core.test.js  dispatch.test.js  hooks.test.js
      README.md  CHANGELOG.md  MANIFEST.json  LICENSE

  # ── Development principle — not a runtime Axiom, a build discipline ────────
  # Added 2026-07-01 as "priming": governs how WARP itself gets built and
  # extended, distinct from the runtime Axiom primitive above (which
  # governs individual events). Kept separate deliberately — conflating
  # "how we build this" with "what every event must satisfy" would blur
  # the exact invariants-vs-behavior line every external review flagged.
  development_principle: >
    Use as few tokens as possible, reasoned from first principles — only
    what's an actual invariant belongs in core. Where a design choice has
    real alternatives, simulate them before committing: run the candidates,
    measure token cost and stability directly, keep the best-measured one,
    not the first-argued one. Every improvement found this way gets folded
    back into WARP as it's built, not deferred to a someday cleanup pass.
    (This is the discipline behind v1.0.1's digest fix and every addition
    below — checked against real code or a real test before adoption, not
    accepted because a review sounded confident.)

  # ── Changelog — every entry tied to a verified test, not a claim ───────────
  changelog:
    v1.1.0_2026-07-01:
      trigger: >
        Two more external (ChatGPT) reviews, evaluated the same way as
        v1.0.1's — checked against real code/tests before any change,
        rejections stated with reasons, not just accepted or dismissed
        wholesale. Also: the development_principle above, added directly
        by James as "priming" — read as governing both how WARP gets built
        and what the scorer optimizes for, so it became two things, not one.
      adopted:
        - "tokenEfficiency promoted to an explicit 5th scorer axis (was
           previously only measured after the fact, in benchmarks, never
           part of the actual fitness/promotion decision). scoreDefault
           now takes an optional tokenBudget and rewards candidates that
           stay under it. Directly operationalizes 'use as little tokens
           as possible' into what gets promoted, not just what gets
           reported."
        - "exploreWidth on unifiedDispatch — bounded recursive simulation
           within a single dispatch. Default 1 (zero behavior/cost change
           for existing callers, tested explicitly). >1 runs multiple
           candidates through generation and axiom-gating, keeps the
           highest-fitness survivor, not the first one that merely
           passed. This is 'run recursive simulations until you find the
           best method' made concrete and bounded — not unbounded
           self-modifying recursion, which a reviewer specifically and
           correctly warned against."
        - "Gate.schema — lightweight structured-output contract
           (requiredKeys + types), dependency-free by design. Adopted the
           review's instinct (a real schema beats an ad-hoc key array)
           while rejecting its literal suggestion (a JSONSchema library),
           since that would violate the same review's own zero-dependency
           requirement."
        - "crystallizer.invalidate(digest) — rollback. A promoted crystal
           later found wrong (e.g. an axiom bug that let something bad
           through, since fixed) previously had no path to removal —
           axiom-version bumps orphan the old digest going forward but
           never clean up what's already stored. Real gap, cheap fix,
           adopted."
        - "'not a model trainer' added to non_goals — true, hadn't been
           stated, costs nothing."
      explicitly_rejected:
        - "axiom_set_version as one global version counter — rejected in
           favor of the existing per-axiom version (v1.0.1). A single
           shared counter is MORE coupling: every axiom change anywhere
           forces a bump everyone has to remember to make. Per-axiom
           versioning was already the more decoupled choice."
        - "'correctness: never_decrease' as a literal non-negotiable
           invariant — not actually checkable as stated; there's no way
           to compute one monotonic correctness scalar across an open set
           of gate-classes. Three of the same review's other four
           'non-negotiable invariants' (axiom_safety, cache_determinism,
           audit_completeness) were already true and already covered by
           real tests before this review — kept those, dropped the
           unenforceable one."
        - "Cross-domain borrowing via structural similarity — proposed
           again in this round (as in the prior one). Rejection stands
           for the same reason: requires a similarity/embedding provider
           as a dependency, breaking zero-dependencies and the
           decoupling boundary. Re-litigating this every time it
           resurfaces isn't useful — logging the standing decision here
           instead."
        - "Formal A/B statistical-significance promotion gating —
           legitimate at real deployment scale, premature without usage
           data showing the current threshold rule actually produces bad
           promotions. Same treatment as diversity pressure in v1.0.1:
           deferred, not built, reasoning on file."
      verified: "22/22 tests passing across core, digest-regression,
                 dispatch, and the new v1.1.0-additions suite. exploreWidth
                 default-vs-explicit behavior both directly tested, not
                 just documented."

    v1.0.1_2026-07-01:
      external_review: >
        Two ChatGPT reviews of v1.0.0 were evaluated on their merits, not
        adopted wholesale — reviewer had no knowledge of WARP's actual
        purpose or NEXUS context, so critiques were checked against real
        code before any change was made.
      fixed_bug: >
        CONFIRMED via direct code read, then regression-tested: the digest
        in step 1 hashed Object.keys(event.data) only — shape, not content.
        Two requests with identical keys but different values ('label:
        Submit' vs 'label: Cancel') produced the same digest and would
        wrongly serve cached output. Fixed: digest now hashes the full
        canonicalized event content, recursively, key-order-independent.
        See dispatch/digest.js and test/digest-regression.test.js (4/4
        passing, including the exact collision case above).
      adopted:
        - "Gate.transform now returns Event[] instead of side-effecting
           through stream.emit(event, stream) — gates are testable in
           complete isolation, no Stream object required. Matches the
           paper's own 'compositional reasoning' claim more strictly than
           the original imperative shape did."
        - "Axiom now carries a version field, included in the digest — a
           changed axiom rule invalidates old cache entries instead of
           silently letting them survive under a rule that no longer
           holds."
        - "Promotion policy is now pluggable (PopulationStore constructor
           arg), default behavior unchanged — different consumers may
           weight stability/latency/cost differently; one hardcoded
           threshold for everyone was too rigid."
        - "Population.seed() now falls back to a parent gate-class when
           the exact class has no population yet ('sql.select.where' ->
           'sql.select' -> 'sql') — this is the reviewed 'pattern cache'
           idea, implemented as a coarser lookup on the existing store,
           not a new primitive."
      explicitly_deferred:
        - "Async/worker-pool Stream execution — noted in primitives as a
           valid future implementation swap (Gate semantics don't change),
           not built now. Sync/depth-first stays the default; no evidence
           yet that it's actually a ceiling for any real WARP workload."
        - "Evolutionary diversity pressure in PopulationStore — real
           technique, premature without real usage data showing premature
           convergence is an actual problem here. The existing top-8-by-
           fitness cap already gives some diversity by construction."
      explicitly_rejected:
        - "Cross-domain borrowing via concept graph / embedding similarity
           search — philosophically interesting but requires an embedding
           provider as a dependency, which breaks 'zero dependencies' and
           the decoupling boundary rule outright. A possible future
           optional plugin, never core."
        - "Layered verification as a new formal primitive (syntax->type->
           schema->...->human) — collapses into 'multiple Axioms, ordered
           cheapest-first,' which the existing primitive already supports
           without new mechanism. Clarified in docs, not built as new
           structure."
      measured_this_round:
        build_speed: "Stream+Gate+Axiom construction: ~5.25us/instance.
                      Stream.emit() dispatch: ~211,000 events/sec.
                      Digest computation: ~7.5us/call. (10,000-iteration
                      benchmark, dispatch/benchmark.js)"
        token_cost: "100 identical requests -> 3 model calls (97% fewer
                     than the 100-call naive/no-memory baseline).
                     Structured output ~52.6% fewer tokens than a
                     free-text equivalent on the benchmark's example.
                     Caveat: no live LLM in this environment — call-count
                     reduction is measured directly; per-call token
                     pricing depends on whatever model the cascade
                     actually points at."
        stability: "Digest determinism: 1000/1000 identical inputs -> 1
                    unique digest. Key-order independence: 100/100.
                    Axiom rejection determinism: 500/500 identical
                    dispatches rejected, gate ran 0 times. All PASS,
                    dispatch/benchmark.js."

  phases:
    - phase: 0
      name: Core five primitives — no dispatch logic yet
      gate: "Event/Gate/Stream/StreamLog/Axiom, real tests, zero deps,
             importable standalone with nothing else in the repo"
    - phase: 1
      name: Exact-cache (step 1 only)
      gate: "digest computed correctly, hit/miss both provably correct
             against a fixture set — this alone is usable value before
             anything evolutionary exists"
    - phase: 2
      name: Cascade + Axiom gate (steps 3-4, 6)
      gate: "a real generation attempt, real axiom rejection path, real
             escalation — no population yet, every miss is cold"
    - phase: 3
      name: Population + scoring (steps 2, 5)
      gate: "the evolutionary loop closes — repeated misses on a gate-class
             measurably improve, matching the AlphaEvolve ablation finding
             this design is modeled on"
    - phase: 4
      name: NEXUS adapter (outside warp/ entirely)
      gate: "NEXUS wires JAA as the crystallizer adapter and its own
             models as the cascade order — warp/core changes zero lines
             to support this"

# ── v1.4 ADDENDUM — implemented, measured, opt-in ──────────────────────────
# This section replaces the earlier "v1.4 spec improvements" patch doc.
# That doc asserted "10x-35x cheaper, 15x-50x faster" with no benchmark
# behind either number. Everything below was actually built against this
# codebase (dispatch/canonicalize.js, pregen.js, deltaCache.js, cascade.js's
# runTwoStage, core/GateFusion.js, population.js's decay/pruning/dedup,
# Axiom.js's weight field) and measured in dispatch/benchmark.js section 4.
# No aggregate multiplier is claimed here — the mechanisms below help
# different, non-comparable axes (model-call count vs. storage bytes vs.
# dispatch latency), and bundling them into one "Nx faster/cheaper" number
# would repeat the original patch's mistake.

v1_4_addendum:
  canonicalization:
    what: "dispatch/canonicalize.js — sorts object keys recursively, drops
           undefined-valued keys, normalizes -0, trims trailing whitespace.
           digest.js now delegates to it instead of a private copy."
    not_implemented: "The original patch asked for 'deep AST normalization'
           with normalize_identifiers and flatten_equivalent_structures —
           real operations on source-code ASTs, not on JSON-shaped event
           data. Proving two differently-structured code trees are
           semantically equivalent is a distinct, much harder problem this
           addendum does not claim to solve."

  pre_generation_filter:
    what: "dispatch/pregen.js. Runs after an exact-cache miss, before
           cascade generation. Computes Jaccard similarity over
           (path,type) fingerprints (dispatch/canonicalize.js's
           similarityScore) between the incoming event and every stored
           population variant for the gate-class; above `threshold`
           (default 0.87), reuses that variant's output as the sole
           candidate instead of calling cascade() at all."
    default: "OFF. Opt in via unifiedDispatch({ preGeneration: { enabled:
           true, threshold: 0.87 } })."
    safety: "A reused candidate still passes through the full axiom gate
           before being returned — fuzzy reuse skips generation, never
           skips verification. Every reuse is logged with its similarity
           score."
    measured: "30 same-shape/different-content requests (a case exact-cache
           cannot help with — every digest is unique): 1 model call instead
           of 30, in dispatch/benchmark.js. Real, but narrow: sound only
           when a gate's output genuinely doesn't need to vary with
           per-request content, which is a real but much narrower
           condition than 'any structurally similar request.'"

  population_lifecycle_control:
    what: "population.js — decay (fitness *= 1-rate on every retain() for
           every OTHER variant in the class), pruning (drop below
           pruneThreshold, never the variant just retained this call),
           structural deduplication (collapse variants sharing a
           fingerprint, keep the fittest), and a second pluggable
           promotion policy (reuseCountPromotionPolicy: hits>=2 and a
           tracked success_rate>=0.7, independent of the default
           hits>=3/fitness>=0.7 policy)."
    default: "decayRate=0, pruneThreshold=0 (both off) — existing callers
           see no behavior change. Spec-recommended values (0.1, 0.6) must
           be passed explicitly: new PopulationStore({ decayRate: 0.1,
           pruneThreshold: 0.6 })."

  two_stage_generation:
    what: "dispatch/cascade.js's runTwoStage(): a cheap skeletonProvider
           attempt, escalating to refinementProvider ONLY on
           fails_validation or a generate-reported confidence below
           confidenceThreshold (default 0.7). Distinct from runCascade's
           N-attempt ladder — exactly two phases, condition-gated."
    honesty_note: "'Low confidence' requires the generate function to
           report a confidence number; WARP does not invent one. Without
           it, only fails_validation triggers stage 2."

  gate_fusion:
    what: "core/GateFusion.js's fuseChain(gates, signature) merges an
           adjacent chain of pure Gates into one Gate, cutting the
           per-hop Map-lookup + axiom-pass + log-record cost Stream.emit's
           recursion otherwise pays per stage."
    constraint: "Trusts Gate's own documented purity contract (no side
           effects) rather than attempting to verify it — there is no
           generic way to prove that. canFuse() offers a best-effort
           adjacency sanity check against sample event types, not a proof."
    measured: "3-gate chain: 14.0µs/dispatch unfused vs 3.8µs/dispatch
           fused, dispatch/benchmark.js section 4 (~73% less dispatch
           overhead on this shape). Dispatch-latency saving only — no
           effect on model-call count."

  axiom_cost_weighting:
    what: "Axiom.js gets a `weight` field (default hard=1.0, soft=0.3).
           unifiedDispatch evaluates axioms highest-weight-first. A SOFT
           axiom may be skipped (logged as 'soft-skip', never silent) when
           skipVerifiedSoftAxioms is true AND this exact digest already
           has a population variant — meaning this content was already
           scored once before."
    hard_guarantee_unchanged: "HARD axioms are never skipped under any
           option, for any reason. This is not configurable. The original
           patch's 'skip_if_cache_verified: true' as an unqualified axiom-
           engine-wide rule would have contradicted Axiom's own founding
           guarantee ('a hard violation rejects the transform outright,
           logged, never swallowed') — this addendum narrows the
           mechanism to preserve that guarantee instead of loosening it."

  structural_delta_cache:
    what: "dispatch/deltaCache.js — computeDelta/applyDelta (flat JSON
           patch ops over canonicalized structures) plus
           DeltaCrystallizer, a crystallizer wrapper storing the first
           value per gate-class in full and later values as diffs against
           it."
    scope_correction: "This is a STORAGE-SIZE optimization, not a
           generation-avoidance one — it does not reduce model calls.
           Filed separately from the token-cost claims on purpose."
    measured: "dispatch/benchmark.js section 4, two regimes: small
           objects (~90 bytes, 1-field diff) actually LOSE to plain
           storage (-6.5%, the diff-wrapper overhead exceeds the saving);
           larger objects (~1.2kb, 1-field diff) save ~77%. Reported both,
           not just the favorable one — delta storage only pays off once
           the shared/unchanging portion of a value is large relative to
           the wrapper overhead."

  tests: "test/v1.4-additions.test.js — 21 tests covering all seven
          mechanisms above, plus the existing test/core.test.js (12),
          test/digest-regression.test.js (4), and
          test/v1.1.0-additions.test.js (6) suites all still pass
          unmodified against this addendum: 43/43 green."

## ADDENDUM 2026-10-05 — 2.0.0, WARP 2 (EM2, docs/2026-10-02-emerge-field-memory-build-phasemap.spec)
# James: "still i want to make warp mine" · "no. i want warp 2"
# The atom is the LINK (cause → effect, with its field values), not the message. Every link has causedBy or is a
# root marked as one. EXPECTATIONS are declared first and held open; the residue of a run is open expectations and
# gaps naming both ends. Every link passes WARP's Axioms, then the constraints (Emerge's, through
# adapters/emerge-field.js), before it is in the causal ledger. 1.x runs unchanged beside it; adapters/siso-gates.js
# records a 1.x Stream as links. Open: 1.x's SISO-shaped files are still in core/, and consumers move one by one.
# Proof: tests/modules/test-warp2.test.js 6/6; 1.x 43/43 unchanged.
