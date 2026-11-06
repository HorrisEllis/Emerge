spec:

  # ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
  # emerge/emerge/spec/field.spec — the constrained relational field: Emerge's layer that compounds Pillar's primitives into a
  # field of state, typed relations and constraints. It replaces WARP (and SISO, by his Group 14 amendment): a feature is a
  # transition the field admits; code is a point the field narrows to. Written in Emerge (.eg). Format: emerge's module spec
  # (kg-builder, specDepth 1.0, no BLACK). Phases (expanded, not written again): docs/2026-10-02-emerge-field-memory-build-
  # phasemap.spec EM2, CF1, RF1, CB1, MR11, FM1, and CRF1 (new: nothing covered the axioms as constraints).
  # ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

  meta:
    name:        field
    version:     0.1.0
    author:      james-brooks
    created_at:  2026-11-06T00:00:00Z
    status:      specced
    uuid:        nexus-emerge-field-spec-v1-0000-2026-1106-jamesbrooks-001
    origin: >-
      James, 2026-11-06: "Let’s spec out the constrain field … Let’s call it the relational constraint field? Constrained relational field. Or
      emergence also. Replacing warp. Let’s get it all specced." · on where: "My intuition is telling me to build it as a layer of emerge like
      compounding. Or integrated?" · earlier the same day: "Like the shape of the field is the boundary of invariants or primitives. It’s not new
      either. It’s emergence. Its first principles. It’s cfr. Its emergence" · "im saying to generate code. using primitives or invariants to
      define the shape of the field, which would define the possibility space, using the dag as the map of primitives, creating the constraint
      field, the dag mapping the conditions for the end state (contract), or the emergent property/outcome." · "zoom out and look at the
      entirety of the axioms." From his Innovation Toolkit (docs/innovation-toolkit.framework): "Probabilistic probability, built on top of
      deterministic probability. I call it a constraint field." · "Map the invariance, primitives, principles, in the overlap. Now you have the
      boundary for the constraint field. The signal." · "One gap = anomaly. Two = coincidence. Three = an invariant (not a fact)." Earlier, the
      same idea in his words, 2026-10-02: "what about with the constraint field. wouldnt it be: deterministic variables as the immutable core
      then every probabalisitc builds from there. everything should be this." · "this is litterally first principles. relational field" ·
      "what if we replace warps events with cfr". The name is to confirm (he named three; the coder uses "the constrained relational field");
      the layer, not integrated, is the coder's reading of his own EAS_D5 ("One primitive per gate. Compounds, each layer."), to confirm.
    purpose: >-
      One field instead of a stream of events and seven graphs. Its shape is the constraints: Pillar's primitive contracts, a chunk's
      invariants, and at the top his seventeen groups of axioms. Inside the shape is the possibility space. Everything that happens is a
      transition the field admits or refuses, with its cause; everything known is state (deterministic) or observation (probabilistic, never
      state). From that one model come the things WARP, SISO, CFR and the replay engine each did in part: causality without guesses, rewind on
      failure, failure modes as a region you can ask about, and code generated as the point the field narrows to.
    target_runtime: [emerge]
    language_stack: [emerge]
    paradigm: [written-in-emerge, a-layer-over-pillar, deterministic-core-probabilistic-above, typed-relations, causes-declared-never-guessed, transitions-not-messages, rewind-by-refold, narrowing-from-both-ends]
    axioms: ["the preamble: invariants are the constraints that define what a valid build is", "§5.10, §5.14 the contract is the global invariant", "§11.1–§11.4 causal physics", "§12.4 invariants crystallise from tests", "§14 addendum 2026-11-06", "§0.3 nothing lost", "§0.4 optionality", "§5.6 structural self-similarity"]
    deps: []

    census: >-
      Read 2026-11-06. Emerge's core Field (emerge/emerge/core/field.js): propose() judges the next state by every constraint, refuses, opens a
      gap or charges violations, records history; observations never change state. WARP 2 (lib/warp/core): Link (cause → effect), Expectation
      (held open), Ledger (hash-chained, causal by construction), Engine (admit handed in; Emerge's admit since EAS4a). SISO (lib/siso): Event →
      Gate → Event. CFR (intelligence/cfr): field, graph, ledger, sigma, delta, contract-verifier; its known flaw (CF1): a 2-second temporal guess
      counted as a cause. RFR2 (intelligence/rfr2): typed causality, clip, compress, context, enforcement. CIE-EG (emerge/emerge/spec/cie-eg.spec):
      the event ledger (linear seq, causal parents above), MOD-REPLAY (not built), the loop adopted (D10).

    constraints:
      - id: CRF-001
        description: "State is deterministic and changes only by an admitted transition; an observation is evidence and never changes state."
        type: hard
        enforced_by: [GATE-CRF-ADMIT]
      - id: CRF-002
        description: "A causal relation is declared (explicit, by rule, or by an adapter's lifecycle) or it is not causal: time order alone is observational, never causal."
        type: hard
        enforced_by: [GATE-CRF-CAUSE]
      - id: CRF-003
        description: "The field's shape is constraints from Pillar's contracts and declared invariants; nothing in the field is admitted that no constraint can judge (unknown is a gap, not a pass)."
        type: hard
        enforced_by: [GATE-CRF-ADMIT]
      - id: CRF-004
        description: "History is written before a transition applies; rewind refolds history to a point and never rewrites it (§0.3)."
        type: hard
        enforced_by: [GATE-CRF-HISTORY]
      - id: CRF-005
        description: "Written in Emerge: every source file of the field is .eg; WARP and SISO pipelines that still exist are recorded through an adapter until moved, never removed blind."
        type: hard
        enforced_by: [GATE-CRF-EG]

  schemas:

    - id: FieldNode
      name: FieldNode
      description: "A thing in the field: an id that stays the same through change, a level, and its state."
      complete: true
      fields:
        id:     { type: string,  rule: "stable through every transition (Pillar's Identity)" }
        level:  { type: integer, rule: "0 and up; a child is one level below its parent (Emerge's Level)" }
        state:  { type: object,  rule: "deterministic values only; changed only by an admitted transition" }
        kind:   { type: string,  rule: "a declared kind" }
      behavioral_contracts: ["a node removed leaves its history; its relations end with it, each ending recorded"]
      error_paths: ["two nodes with one id → refused"]

    - id: Relation
      name: Relation
      description: "A typed edge between two nodes."
      complete: true
      fields:
        from:   { type: string, rule: "a FieldNode id" }
        to:     { type: string, rule: "a FieldNode id" }
        family: { type: string, rule: "structural | causal | provenance | semantic | contradiction (RF1)" }
        type:   { type: string, rule: "a core type (road, ref, depends_on, part_of) or a declared, namespaced custom type (CH-Q2)" }
        basis:  { type: string, rule: "explicit | rule | adapter | observational (only the first three may be causal, CRF-002)" }
        confidence: { type: number, rule: "1 for declared; below 1 for semantic, which is an observation until confirmed" }
      behavioral_contracts: ["causal relations form a DAG: a relation that would close a cycle, or a diamond RFR2 rejects, is refused"]
      error_paths: ["an unknown type → a diagnostic, never silently given meaning", "a causal relation with an observational basis → refused"]

    - id: Transition
      name: Transition
      description: "A proposed change to the field, with its cause."
      complete: true
      fields:
        id:       { type: string, rule: "drawn from the seed (replays)" }
        changes:  { type: object, rule: "node id → new state values" }
        source:   { type: string, rule: "who proposed it: a person, a rule, a model, an adapter" }
        caused_by: { type: string, rule: "a transition id, or root (said)" }
        cost:     { type: number, rule: "0 and up, charged to the budget" }
      behavioral_contracts: ["admitted only if every constraint over the next state holds, or a soft one's cost is paid"]
      error_paths: ["no source → refused", "a missing variable a constraint needs → a gap naming both"]

    - id: FailureMode
      name: FailureMode
      description: "A region of the field where transitions were refused or gaps opened, with their causes: his D4 failure-mode report."
      complete: true
      fields:
        constraint: { type: string, rule: "the constraint that refused, or the gap's constraint" }
        cause:      { type: string, rule: "the transition chain that led there" }
        count:      { type: integer, rule: "how many times; every occurrence stays in history (no lossy dedup)" }
        sigma:      { type: number,  rule: "deviation from baseline (CFR sigma)" }
        delta:      { type: number,  rule: "the gap's measured distance (CFR delta)" }
        status:     { type: string,  rule: "anomaly (1) | coincidence (2) | invariant candidate (3+), his rule; never a fact until tested" }
      behavioral_contracts: ["three occurrences make a candidate invariant, promoted only by a passing test (§12.4)"]
      error_paths: ["a failure with no cause chain → a gap of its own, said"]

  interfaces:

    - id: IF-PILLAR
      name: pillar
      path: pillar/pillar.eg
      description: "Pillar's primitive contracts and their conformance cases: the field's shape at the bottom."
      exports: ["contracts()", "contract(id)", "cases_of(id)", "identity_of(id, file)"]
      behavioral_contracts: ["a contract changes only by a new version"]
      error_paths: ["a contract the field names but Pillar lacks → refused, named"]

    - id: IF-EMERGE-LANG
      name: emerge-language
      path: emerge/emerge/lang/eg.js
      description: "The Emerge language the field is written in (eg; emerge.exe when native), with the contract block and schema (CIE-EG D7, D8)."
      exports: ["eg check|run|test <file.eg>", "use \"./file.eg\" as name", "contract { … }", "schema Name { … }"]
      behavioral_contracts: ["deterministic"]
      error_paths: ["line, column and why"]

    - id: IF-CIE-LEDGER
      name: cie-ledger
      path: emerge/emerge/lang/ledger.js
      description: "CIE-EG's event ledger: linear seq, hash-chained, causal parents above the chain; and MOD-REPLAY over it (emerge/lang/cie/replay.eg, to build)."
      exports: ["append(entry)", "entries()", "verify()", "replay(from, to) (MOD-REPLAY)"]
      behavioral_contracts: ["the seq order stays linear; meaning sits on top of the chain"]
      error_paths: ["a broken link → verify names the entry"]

    - id: IF-SYNTH
      name: emerge-synth
      path: emerge/emerge/lang/cie/synth.eg
      description: "Emerge's chunk synthesizer: derive (zero tokens), template, model — by the lowest rung that can (MOD-SYNTH)."
      exports: ["synth(units) → code per unit"]
      behavioral_contracts: ["rung 1 uses no model"]
      error_paths: ["a unit no rung can make → a gap"]

    - id: IF-CFR
      name: cfr
      path: intelligence/cfr/index.js
      description: "Intelligence's constraint field runtime: field, graph, ledger, sigma, delta, contract verifier. A source of discipline to port to .eg, not a dependency (§5.15)."
      exports: ["field", "graph", "ledger", "sigma", "delta", "contract-verifier"]
      behavioral_contracts: ["read through Intelligence's routes when live data is needed, never its files"]
      error_paths: ["Intelligence down → the field works on its own; live CFR data is said missing"]

    - id: IF-RFR2
      name: rfr2
      path: intelligence/rfr2/causality
      description: "RFR2's causal discipline: typed edges at ingestion, diamond rejection, clip, compress, context. A source to port, not a dependency."
      exports: ["typed causal edges", "diamond rejection", "clip", "compress"]
      behavioral_contracts: ["a time-order guess never becomes a causal edge"]
      error_paths: ["an edge with no basis → refused"]

    - id: IF-WARP
      name: warp
      path: lib/warp/index.js
      description: "WARP 1 and 2 as they are: what the field replaces; its pipelines recorded through an adapter until each is moved."
      exports: ["Event", "Gate", "Stream", "createLink", "createExpectation", "Ledger", "Engine"]
      behavioral_contracts: ["unchanged until moved (no blind removal)"]
      error_paths: ["a pipeline no adapter covers → listed by the census"]

  modules:

    - id: MOD-CRF-FIELD
      name: field-core
      uuid: nexus-emerge-field-core-v1-0000-2026-1106-001
      path: emerge/emerge/field/field.eg
      phase: RF1_relational_field
      description: >-
        The field itself: FieldNodes at levels, typed Relations in five families, constraints over them taken from Pillar's contracts and
        declared invariants. propose(transition) admits or refuses by every constraint over the next state; observe(evidence) records an
        observation that never changes state; look(lens) projects a frozen view. A layer over Pillar: it compounds the primitives, it does not
        redefine them.
      deps: [{ name: pillar }, { name: emerge-language }]
      schema_refs: [FieldNode, Relation, Transition]
      exports: ["field(seed, shape) → { propose(t), observe(o), relate(r), look(lens), state(), history() }"]
      gate_pipeline: ["GATE-CRF-ADMIT: every constraint over the next state judged; unknown is a gap", "GATE-CRF-HISTORY: written before applied"]
      behavioral_contracts: ["the same seed and the same transitions give the same field", "a refused transition leaves the field unchanged, its refusal recorded"]
      error_paths: ["a relation to a missing node → refused", "a constraint that throws → the transition is refused with the error, never admitted"]
      acceptance: ["Emerge's core Field's tests pass on the new field through Pillar's cases; one refused and one gapped transition recorded with causes"]

    - id: MOD-CRF-CAUSAL
      name: field-causal
      uuid: nexus-emerge-field-causal-v1-0000-2026-1106-001
      path: emerge/emerge/field/causal.eg
      phase: CF1_cfr_improved_with_rfr2
      description: >-
        CFR on RFR2's discipline, in .eg: causal relations typed at ingestion (explicit causedBy, a rule, an adapter's lifecycle pair); time
        order kept as observational, never causal; diamonds and cycles refused; sigma (deviation from a baseline) and delta (a gap's distance)
        measured per node, as CFR measures them.
      deps: [{ name: field-core }, { name: cfr }, { name: rfr2 }]
      schema_refs: [Relation, Transition]
      exports: ["cause(a, b, basis)", "chain(transition_id) → the causes back to root", "sigma(node, measure)", "delta(gap)"]
      gate_pipeline: ["GATE-CRF-CAUSE: only explicit, rule or adapter bases are causal"]
      behavioral_contracts: ["CF1's known flaw cannot recur: a 2-second temporal guess is observational"]
      error_paths: ["a causal relation that closes a cycle → refused, the cycle named"]
      acceptance: ["a fixture where events are 1 s apart but unrelated: no causal edge; a declared cause: one; a diamond: refused"]

    - id: MOD-CRF-REWIND
      name: field-rewind
      uuid: nexus-emerge-field-rewind-v1-0000-2026-1106-001
      path: emerge/emerge/field/rewind.eg
      phase: MR11_rewind_the_mind
      description: >-
        Rewind on failure: the field refolded from its seed to the last good point of the CIE-EG ledger (through MOD-REPLAY), a branch from
        there, and the retry engine's next attempt (EW1) made from that state instead of from scratch. History is never rewritten; a branch is
        new history that names its fork point.
      deps: [{ name: field-core }, { name: cie-ledger }]
      schema_refs: [Transition, FailureMode]
      exports: ["rewind(to_seq) → field at that point", "branch(from_seq) → a new line of history", "last_good(failure) → seq"]
      gate_pipeline: ["GATE-CRF-HISTORY: refold, never rewrite", "GATE-CRF-REPLAY: the refolded state equals the state recorded at that seq"]
      behavioral_contracts: ["rewind then the same transitions again gives the same field (determinism)"]
      error_paths: ["a seq the ledger does not hold → refused, said", "a refold that disagrees with the recorded state → a ledger_divergence gap"]
      acceptance: ["a fixture run that fails at step 7 rewinds to step 6, branches, and a different transition passes; the original line stays"]

    - id: MOD-CRF-FAILURE
      name: field-failure-modes
      uuid: nexus-emerge-field-failure-v1-0000-2026-1106-001
      path: emerge/emerge/field/failure.eg
      phase: FM1_mining_failure_modes
      description: >-
        His D4 failure-mode report as a region of the field: every refusal and gap with its constraint and its cause chain, counted without
        dedup; his rule for promotion (one = anomaly, two = coincidence, three = a candidate invariant, promoted only by a passing test).
      deps: [{ name: field-core }, { name: field-causal }]
      schema_refs: [FailureMode]
      exports: ["failure_modes(filter) → [FailureMode]", "promote(mode, test) → invariant | refused"]
      gate_pipeline: ["GATE-CRF-FAIL-001: every occurrence kept", "GATE-CRF-FAIL-002: no promotion without a passing test (§12.4)"]
      behavioral_contracts: ["a failure mode is a hypothesis until tested (his: \"not a fact\")"]
      error_paths: ["a promotion without a test → refused"]
      acceptance: ["three identical refusals become one candidate with count 3; promoted only after its test passes"]

    - id: MOD-CRF-NARROW
      name: field-narrowing
      uuid: nexus-emerge-field-narrow-v1-0000-2026-1106-001
      path: emerge/emerge/field/narrow.eg
      phase: CB1_cfr_build_logic
      description: >-
        The field generates code: each node of the chunk DAG has a possibility space set by its boundary; it is narrowed by its neighbours'
        boundaries and by the end-state contract pulled back from the end (his bidirectional chaining). Narrowed to one → derived by synth's
        first rung; to a few → ranked by his weighting (Urgency × Importance × Fidelity × Slope) and leverage (Tension × Weight × f(Slope)) and
        chosen by a template or a small model inside the space; anything outside is refused by the field. The build logic's regimes stay
        (stable, resonant, turbulent, chaotic).
      deps: [{ name: field-core }, { name: emerge-synth }, { name: pillar }]
      schema_refs: [FieldNode, Relation]
      exports: ["space(node) → candidates", "narrow(dag, contract) → per node: one | few | gap", "weighting(u, i, f, s)", "leverage(tension, weight, slope)"]
      gate_pipeline: ["GATE-CRF-NARROW-001: a candidate outside the space is refused", "GATE-CRF-NARROW-002: the end state checked at the system gate (outcomes that are not local)"]
      behavioral_contracts: ["narrowing never invents a constraint", "a wide space after narrowing is said, not guessed into one"]
      error_paths: ["an empty space → a gap naming the conflicting constraints"]
      acceptance: ["a fixture DAG whose nodes narrow to one is derived with zero model calls; one left at three candidates is ranked by the weighting"]

    - id: MOD-CRF-AXIOMS
      name: field-axioms
      uuid: nexus-emerge-field-axioms-v1-0000-2026-1106-001
      path: emerge/emerge/field/axioms.eg
      phase: CRF1_the_axioms_as_constraints
      description: >-
        His seventeen groups of axioms as the field's top layer: each law a constraint with what it needs, what it checks and whether it is hard
        or soft (as WARP's Axiom weighs them), the checks that already exist named (the boundary and registry ratchets, the DAG, the Versionium
        recorder, the tests) and the rest listed as gaps. A change (a phase, a file, an agent's proposal) is proposed into this layer and judged
        by all of them at once.
      deps: [{ name: field-core }]
      schema_refs: [Transition, FailureMode]
      exports: ["axioms() → constraints by group", "judge(change) → { admitted, refused_by, gaps }", "coverage() → laws with a check vs laws without"]
      gate_pipeline: ["GATE-CRF-AX-001: every law of docs/AXIOMS-v3.1.md has a constraint or a named gap", "GATE-CRF-ADMIT"]
      behavioral_contracts: ["a law without a check is a gap, never a pass"]
      error_paths: ["the axioms file changed and a law is unmapped → listed"]
      acceptance: ["coverage() lists all 103 laws; a fixture change that crosses a boundary is refused by §5.15's constraint"]

    - id: MOD-CRF-WARP
      name: field-replaces-warp
      uuid: nexus-emerge-field-warp-v1-0000-2026-1106-001
      path: emerge/emerge/field/warp.eg
      phase: EM2_warp_his_own
      description: >-
        WARP and SISO as compounds of the field (his Group 14 addendum): a Link is a causal transition, an Expectation an open constraint over
        a future transition (broken → a gap naming both ends), a Gate a pure constraint on a transition, a Stream the history. Existing
        pipelines (COS's gates, Loom's driver) are recorded as transitions through an adapter until each is moved; the census of who still
        uses WARP or SISO comes from Pillar's PIL5.
      deps: [{ name: field-core }, { name: field-causal }, { name: warp }]
      schema_refs: [Transition, Relation]
      exports: ["link(cause, effect)", "expect(cause, effect_type, within)", "as_gate(constraint)", "adapt(pipeline) → transitions"]
      gate_pipeline: ["GATE-CRF-WARP-001: a moved pipeline gives the same outcomes as before (its own tests)", "GATE-CRF-EG"]
      behavioral_contracts: ["nothing removed until moved and proven (§0.3)"]
      error_paths: ["a pipeline whose behaviour the field cannot reproduce → kept on WARP, the difference named"]
      acceptance: ["test-warp2's cases pass on the field's link and expect; one SISO pipeline recorded through the adapter"]

  events:
    - { name: field.transition.admitted, payload: "{ id, changes, caused_by }" }
    - { name: field.transition.refused,  payload: "{ id, constraint, reason }" }
    - { name: field.gap.opened,          payload: "{ variable, constraint, caused_by }" }

  enforcement:
    gates: [GATE-CRF-ADMIT, GATE-CRF-CAUSE, GATE-CRF-HISTORY, GATE-CRF-EG]

  tests:
    - "tests/modules/test-substrate-spec.test.js — this spec compiles at specDepth 1.0, no BLACK node, invariants valid"
    - "emerge/emerge/field/test/*.eg — each module's acceptance as Emerge test blocks, written with its phase"
