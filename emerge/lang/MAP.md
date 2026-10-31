# Emerge — the map

Generated from the language itself (emerge 1.12.0) by `eg map`, and again by every `eg bootstrap`. Do not edit it:
change the source and run `node lang/eg.js map --out lang/MAP.md` (a test fails when this file is out of date).

## The layers

```
build      lang/core/primitives.eg · prelude.eg · selftest.eg  ──eg bootstrap──▶  lang/build/current
program    use · fn · let/var · test
kinds      kind K { require · in · out · state · boundary_count · fn }          schemas for primitives
templates  template T(params) is K  ──spawn──▶  instance T(id)  ──despawn──▶ ✕
components component C is K { id · namespace · version · boundary · in · out }  ──wire──▶  hooks
containers compartment { id · state · constraint · invariant · on · fn }
world      emit · record · gap · promote · whatif · axiom   →   signals, ledger, gaps
values     num · string · bool · null · list · map · fn · instance · module
```

Where a rule is enforced: **P** parser · **C** checker (compile time) · **R** runtime (run time).

## Values — what a program computes with

| word | meaning |
|---|---|
| `true` | bool literal |
| `false` | bool literal |
| `null` | the empty value; a missing map key reads as null |
| `fn` | a function: fn f(x) { … } · fn f(x) = expr · fn(x) = expr as a value |

## Operators — lowest precedence first: |> ?? or and not · comparisons · .. · + - · * / % · ** · unary - · call . []

| word | meaning |
|---|---|
| `and` | both must be true (short-circuits; truth.strict decides what counts as true) |
| `or` | either is true (short-circuits) |
| `not` | negation |
| `in` | x in list/map/string · also the for-loop separator |
| `contains` | list/map/string contains x |
| `starts_with` | string prefix |
| `ends_with` | string suffix |
| `matches` | string matches a regular expression |

## Statements — what runs, in order

| word | meaning |
|---|---|
| `let` | a fixed binding · let x: type = … |
| `var` | a binding that can change; contents of maps/lists change only through a var |
| `if` | if cond { } else if … { } else { } |
| `else` | the other branch of if / the handler of try |
| `while` | loop while true |
| `for` | for x in xs · for i, x in xs · for k, v in map |
| `break` | leave the loop |
| `skip` | next iteration |
| `return` | leave a fn with a value (bare return in handlers and tests) |
| `try` | try { } else e { } — the else may not be empty (NO_SILENT_DROP) · P C |
| `expect` | expect cond, "message" — halts a run, fails a test |
| `with` | emit/record/send … with <expr> as payload · promote … with proof |

## The world — what a program changes — all of it recorded in the ledger

| word | meaning |
|---|---|
| `emit` | raise a signal { payload }; inside a handler it waits for the transition to commit · R |
| `record` | append an entry to the hash-chained ledger · R |
| `gap` | gap "msg" pressure 0..1 [type t] — missing structure, first-class; emits gap.opened · P C R |
| `promote` | promote x with proof <bool> — refused + logical gap when the proof is false · P R |
| `whatif` | whatif { … } — fork the world, run, restore; its value is the last expression · C R |

## Containers — state that changes only through constrained, recorded transitions

| word | meaning |
|---|---|
| `compartment` | id + state + constraints + on handlers + lens fns · C R |
| `state` | state { field: value } in a declaration · state.field in its handlers (read-write) and fns (read-only) |
| `constraint` | constraint name [type] [cost n] { bool } — types come from primitives.constraint_types · R |
| `invariant` | invariant name { bool } — a hard constraint |
| `on` | on "signal" (payload) { … } — a handler; "prefix*" matches by prefix |
| `axiom` | axiom NAME { bool } — checked after every top-level statement; a violation halts · R |

## Components — containers you compose: identity, boundary, typed hooks, wires

| word | meaning |
|---|---|
| `component` | a compartment with namespace, version, boundary and in/out hooks · C R |
| `wire` | wire A.out -> B.in · "signal" -> B.in · A.out -> "signal"; shapes checked · C R |
| `send` | send Comp.hook { payload } — feed an in hook directly · C R |

## Dynamic primitives — schemas for primitives, and instances made at run time

| word | meaning |
|---|---|
| `template` | template T(params) [is K] { … } — a component with parameters · C |
| `spawn` | spawn T("id", args…) — a live instance named T(id) · C R |
| `despawn` | despawn x — remove a spawned instance and its wires · C R |

## Program — files, modules and tests

| word | meaning |
|---|---|
| `use` | use "./file.eg" as name — its top-level fns, lets and components |
| `as` | names a used module |
| `test` | test "name" { … } — runs under eg test, each in its own whatif fork |

## Contextual words (keywords only where they appear)

| word | meaning |
|---|---|
| `id` | identity: compartment/component id (a template gets it at spawn) |
| `intent` | identity: what it is for |
| `namespace` | identity: component/template namespace (required) |
| `version` | identity: semver (required for components/templates) |
| `uuid` | identity: optional; derived from namespace/id@version when absent |
| `boundary` | boundary name { bool } — 1..boundary_max identity invariants of a component (hard) |
| `out` | out hook: shape — a component output · emit out hook { … } |
| `each` | optional: for each x in xs |
| `cost` | constraint … cost n — what a permitted violation adds to spent() |
| `pressure` | gap … pressure n |
| `type` | gap … type t |
| `proof` | promote … with proof <bool> |
| `is` | component/template/kind X is K, … |
| `kind` | kind K [is …] { … } — a schema for a primitive |
| `require` | kind: identity fields an implementation must declare |
| `boundary_count` | kind: how many boundary invariants (lo..hi) |

## Types

Annotations (`: type`, `?` for nullable) on let/var, params, returns and hook shapes: `int` · `float` · `num` · `string` · `bool` · `list` · `map` · `bytes` · `fn` · `any`.

## Primitives — `lang/core/primitives.eg`, as built

| constraint type | permits a violation | default cost |
|---|---|---|
| `hard` | no | 1 |
| `soft` | yes | 1 |
| `probabilistic` | yes | 1 |
| `temporal` | no | 1 |
| `causal` | no | 1 |
| `relational` | no | 1 |

- **gap types:** `logical` · `evidential` · `temporal` · `assumption` · `contradiction` · `structural` · `contextual` · `causal` (default `structural`, pressure 0..1)
- **constraint gap:** pressure 0.8, `evidential` · **refused promotion:** pressure 0.9, `logical`
- **runtime signals:** rejected → `"rejected"` · gap opened → `"gap.opened"` · promoted → `"promoted"`
- **truth:** strict — conditions need a real bool
- **dispatch:** unrouted signals are `log`; at most 100000 deliveries per drain
- **ledger:** a checkpoint entry every 256 entries and at clean shutdown
- **transitions:** a refused transition discards its emits
- **components:** boundary of 1..5 invariants; hooks export as `event_bus`
- **diagnostics:** NO_SILENT_DROP = error · SIGNAL_MUST_ROUTE_OR_LOG = warning · GAP_IS_FIRST_CLASS = error · EXECUTION_IS_TRACEABLE = error · unused_constraint = warning

## Builtins

Native (JavaScript) — name/arity:

`print/0+` · `str/1` · `num/1` · `int/1` · `floor/1` · `sqrt/1` · `min/1+` · `max/1+` · `len/1` · `keys/1` · `values/1` · `has/2` · `get/2–3` · `slice/2–3` · `sort_by/2–3` · `range/1–3` · `join/1–2` · `split/2` · `upper/1` · `lower/1` · `type_of/1` · `json/1` · `parse_json/1` · `random/0` · `uid/0–1` · `gaps/0` · `ledger/0` · `ledger_verify/0–1` · `ledger_proof/1` · `ledger_check_proof/1` · `observe/0` · `ledger_why/1` · `observe_gaps/0` · `spent/0` · `components/0` · `is_kind/2` · `instances/1` · `args/0` · `raise/1` · `read_file/1` · `write_file/2` · `bytes/1` · `byte_len/1` · `utf8/1` · `sha256/1` · `read_bytes/1` · `write_bytes/2` · `chmod_exec/1` · `shr_u/2` · `wrap_add/2` · `wrap_sub/2` · `wrap_mul/2` · `idiv/2` · `truthy/2` · `find_text/2` · `repr/1`

Prelude (Emerge, `lang/core/prelude.eg`) — name/arity:

`map/2` · `filter/2` · `reduce/3` · `find/2` · `any/2` · `all/2` · `count/2` · `push/2` · `reverse/1` · `sum/1` · `index_of/2` · `without/2` · `flatten/1` · `zip/2` · `unique/1` · `group_by/2` · `take/2` · `drop/2` · `ceil/1` · `round/1` · `abs/1` · `sort/1` · `clone/1` · `trim/1` · `replace/3` · `hex/1` · `from_hex/1` · `u8/1` · `u16le/1` · `u32le/1` · `u64le/1` · `i32le/1` · `i64le/1` · `u16be/1` · `u32be/1` · `u64be/1` · `read_u64be/2` · `wrap32/1` · `rotl/2` · `rotr/2`

## Ledger entry kinds

Written by the runtime: `aborted` · `axiom` · `checkpoint` · `compartment` · `despawn` · `gap` · `genesis` · `promote` · `promotion_refused` · `register` · `rejected` · `transition` · `unrouted` · `unwire` · `whatif` · `wire` · `write`; and any kind your program passes to `record`.

## Axioms

| axiom | compile time | run time |
|---|---|---|
| NO_SILENT_DROP | try needs a non-empty else | unrouted, aborted and discarded signals are recorded |
| SIGNAL_MUST_ROUTE_OR_LOG | emit nobody handles, unwired out hook, unfed in hook | unrouted is recorded (or an error, per primitives) |
| GAP_IS_FIRST_CLASS | gap needs pressure in range and a known type | gaps(), gap.opened, constraint gaps |
| EXECUTION_IS_TRACEABLE | id (+ namespace, version for components) | every error names file and line |
| RECORD_IS_TRUTH | — | the hash-chained ledger |
| PROOF_REQUIRED_FOR_PROMOTION | promote needs with proof | a false proof refuses and opens a gap |
| GRAMMAR_APPLIES_TO_ITSELF | partly: the rules and the library are Emerge (lang/core); the grammar and engine are JavaScript | — |

## The ontology — emerge.spec, and the words the language shares with it

emerge.spec names 609 words in 45 domains; 43 of them are also words of the language's syntax. The ontology's
meaning is shown beside each, so a shared word with a different meaning is visible rather than assumed. The rest of
the vocabulary stays what it is: names for concepts, not syntax.

| domain | word | ontology meaning |
|---|---|---|
| structure | `invariant` | always true |
| structure | `axiom` | global invariant |
| structure | `constraint` | local invariant |
| structure | `component` | transform |
| structure | `compartment` | bounded container |
| structure | `seam` | boundary between components |
| signal | `signal` | expected state transition |
| signal | `state` | current system condition |
| runtime | `pressure` | significance of missing structure |
| failure | `gap` | missing structure |
| gap_field | `gap.logical` | gap type |
| gap_field | `gap.evidential` | gap type |
| gap_field | `gap.temporal` | gap type |
| gap_field | `gap.assumption` | gap type |
| gap_field | `gap.contradiction` | gap type |
| gap_field | `gap.structural` | gap type |
| gap_field | `gap.contextual` | gap type |
| gap_field | `gap.causal` | gap type |
| cognition | `whatif` | speculative branch |
| cognition | `if` | deterministic condition |
| cognition | `try` | attempt execution |
| cognition | `else` | fallback execution |
| ledger | `proof` | typed validation |
| ledger | `ledger` | authoritative timeline |
| ledger | `promote` | idea to upgrade |
| time | `record` | authoritative sequence |
| identity | `uuid` | unique identity |
| laws | `emit` | observable event |
| types | `null` | empty value |
| output | `type` | output type declaration |
| output | `template` | output template key |
| output | `emit` | observable event |
| fields | `id` | component identity field |
| fields | `uuid` | universal unique identity |
| fields | `version` | semver field |
| fields | `intent` | declared purpose |
| handlers | `on` | event handler declaration |
| handlers | `starts_with` | string prefix match |
| handlers | `contains` | string contains match |
| handlers | `ends_with` | string suffix match |
| handlers | `matches` | pattern match |
| jaa | `ledger` | append only event log |
| idearium | `compartment` | idea compartment label |

## Files

| file | role |
|---|---|
| `lexer.js` | source → tokens |
| `parser.js` | tokens → syntax tree |
| `checker.js` | names, compile-time rules, kind conformance |
| `runtime.js` | values, operators, natives, the world: compartments, signals, ledger, gaps, whatif, spawn |
| `interpreter.js` | runs the tree (eg run) |
| `emitter.js` | tree → CommonJS (eg build) |
| `components.js` | component/hook/wire records, shapes, schema validation |
| `build-loader.js` | which language build is in use |
| `bootstrap.js` | eg bootstrap |
| `map.js` | this map |
| `eg.js` | the command line |
| `core/primitives.eg` | the core rules (data) |
| `core/prelude.eg` | the standard library (Emerge) |
| `core/selftest.eg` | what every build must pass |
| `emerge-lang.spec` | the contract |
| `README.md` | the guide |
| `examples/` | programs, one per feature |
