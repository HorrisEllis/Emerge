spec:
  meta:
    name:     emerge-core
    version:  1.0.0
    date:     2026-10-05
    uuid:     nexus-emerge-core-v1-0000-2026-1005-jamesbrooks-001
    map:      docs/2026-10-02-emerge-field-memory-build-phasemap.spec EM1
    james:    '"okay now the spine. lets continue the phases for emerge." · "no. i want warp 2" · "next"'
    purpose: >
      James's Rheon primitives as code — the constraint field ARCHITECT-SPEC calls layer 0. "Meaning is downstream of
      constraints." Zero dependencies; identity and logical time are intelligence/rfr2's, reused.

  modules:
    - { id: field,       file: emerge/core/field.js,       does: "the state; a proposal passes every constraint before it changes anything" }
    - { id: constraint,  file: emerge/core/constraint.js,  does: "names the variables it needs; ok, broken (its id), or a gap — never a guess" }
    - { id: transition,  file: emerge/core/transition.js,  does: "a proposal: source, changes, cost, causedBy" }
    - { id: observation, file: emerge/core/observation.js, does: "evidence with confidence [0..1], source and cost; never changes the state" }
    - { id: lens,        file: emerge/core/lens.js,        does: "a projection over a deep-frozen copy — cannot write" }
    - { id: gap,         file: emerge/core/gap.js,         does: "the missing variable and the constraint it blocks" }
    - { id: history,     file: emerge/core/history.js,     does: "append-only, hash-chained, logical ticks only" }
    - { id: level,       file: emerge/core/level.js,       does: "every node at a level; its hash is its summary plus its children's" }
    - { id: budget,      file: emerge/core/budget.js,      does: "every transition's cost counted; budgetConstraint(limit) bounds it" }
    - { id: seed,        file: emerge/core/seed.js,        does: "one recorded seed per run; every draw, every id, from it" }

  rules:
    - "a hard, temporal, causal or relational constraint refuses a violation; soft and probabilistic permit it at its violationCost"
    - "a constraint that cannot be evaluated is a gap, and the state does not change"
    - "everything is in the history — seed, constraints, transitions, rejections, gaps, observations"
    - "one seed, one history: byte-identical"
    - "meaning is not in the core — it is James's"

  proof: tests/modules/test-emerge-core.test.js
