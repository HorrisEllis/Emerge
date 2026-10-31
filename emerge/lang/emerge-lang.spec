spec:
  meta:
    name:     emerge-lang
    version:  1.11.0
    date:     2026-10-26
    changelog: '1.11.0 — James: "leverage. friction. tension. ripples. compound. a lot of eravos was my language, systemns thinking. what ifs, if thens, else," · "only using hardcoded when neccarry, using external node files for data, options, etc." use "./x.node" as node loads a node file (his envelope, read in its JSON form, which is valid YAML) as data: run, check and build know it, native refuses it by name. eg say 0.2 writes <name>.node beside <name>.eg: every number he says is a named lever there and every starting value is data, never a literal in the code. 13 more of his words (28 in all): friction (a gate that resists at a cost: soft), tension (a gap''s pressure), gap / missing, compound (growth by a rate), ripple (a change sets off the next event), leverage / lever, what if (a whatif preview), if / then / else, under / over / at least · 1.10.0 — James: "Also it''s meant for me. To make coding easy for me using my own language. Ai is additive. Also it''s working towards removing the dependency of ai." · "yes, im trying to remove as much friction from me and the code as possibel" eg say: a sentence in his words becomes a compartment, component, sovereign system or program that checks, runs and tests clean, with no model; every word understood is shown with his own dated quote, every unknown word is a named gap; eg teach closes a gap once; eg words lists his vocabulary (15 words from his quote record) · 1.9.0 — James: "native compiler doesn''t handle fractional numbers, and can''t do upper, lower or matches (regex). Compartments, the ledger and components run only in the interpreter, not natively yet." Fractional nums natively (GATE-NL-004): IEEE doubles boxed beside the tagged small form, + - * / % < == floor idiv min max sqrt num() int() exactly as the interpreter, JavaScript''s shortest printing and correctly rounded parsing, fractional literals with their bits computed in Emerge; ** with a fractional operand still refused natively (F5, fdlibm pow) · 1.8.0 — James: "Fix the primitives. Use all of my quotes from nexus to consolidate emerge functions." Strings are code points in both backends (CIE-EG §2: len, index, slice, split, find_text, order, matches); 22 builtins moved from JavaScript into core/prelude.eg and so native (ceil round abs sort clone trim replace hex from_hex u8…u64be read_u64be wrap32 rotl rotr), after "way to many primitives i feel like" and "i am completely removing js from emerge." (see the 2026-10-31 addendum) · 1.7.2 — eg ide (local editor: autocomplete, live errors, run/test, Generate) and eg gen (from 1.6.0 winfix4) · 1.7.1 — Windows: cross-drive runtime require paths in bootstrap and eg build, forward slashes in diagnostic file names (from 1.6.0 winfix2) · 1.7.0 — CIE-EG §3 bytes, 0x/0b literals, & | ^ ~ << >> on 32-bit words, rotl/rotr, idiv, u8/u16le/u32le/u64le/i32le, sha256 (OS), read_bytes/write_bytes, strict utf8; §10.2 x64.eg, pe.eg, elf.eg; §10.3 milestone.eg · 1.6.0 — eg map (MAP.md, generated) and eg new (James: "how do i code with it, and where is the map or taxonomy?") · 1.5.0 — buildable: the core primitives and the standard library are Emerge source, rebuilt by eg bootstrap (James: "make it buildable") · 1.4.0 — kinds (schemas for primitives) and templates (spawned at run time), James: "a template or schema for dynamic primitives" · 1.3.0 — components: hooks, shapes, wires, boundary, send, eg components (James: "what about adding the component logic?")'
    uuid:     nexus-emerge-lang-v1-0000-2026-1026-jamesbrooks-001
    supersedes_role_of: [emerge-kernel.js tokenizer/SNR-gate/parse, emerge-codegen-v2.js translateStmt heuristics]
    james:    '"can we finish this into a coding language"'
    purpose: >
      Emerge as a real programming language. A .eg file has a grammar (not a whitespace split), a static checker that
      enforces the Emerge axioms at compile time, one shared runtime that enforces them at run time, and two backends —
      a tree-walking interpreter and a compiler to CommonJS — that must produce byte-identical stdout, stderr and ledger
      for the same program and seed. Zero dependencies outside node and emerge/core/constraint.js.
    relation_to_existing: >
      emerge-kernel.js, emerge-codegen-v2.js and emerge-ide.js are untouched. The SNR gate's job — deciding what is
      signal — is done here by the grammar and the resolver: every token parses into the tree or is a located error.
      Nothing is scored, nothing is dropped. Constraint semantics are emerge/core/constraint.js's evaluate(), reused.

  modules:
    - { id: lexer,       file: emerge/lang/lexer.js,       does: "source → tokens with line/col; NEWLINE significant outside () and []; string interpolation {expr}" }
    - { id: parser,      file: emerge/lang/parser.js,      does: "tokens → AST, recursive descent, precedence climbing; first error throws with line/col" }
    - { id: checker,     file: emerge/lang/checker.js,     does: "AST → diagnostics; resolves every name; enforces the compile-time axioms; annotates identifiers" }
    - { id: runtime,     file: emerge/lang/runtime.js,     does: "the world: values, operators, builtins, compartments, signals, constraints, ledger, gaps, seed, whatif fork" }
    - { id: interpreter, file: emerge/lang/interpreter.js, does: "walks the checked AST against the runtime" }
    - { id: emitter,     file: emerge/lang/emitter.js,     does: "checked AST → CommonJS that calls the same runtime" }
    - { id: components,  file: emerge/lang/components.js,  does: "component/hook/wire records (loom shape), derived uuids, seam (shape) compatibility, validation against emerge/schemas" }
    - { id: modules,     file: emerge/lang/index.js,       does: "public API: compile, check, run, build; module loader for use" }
    - { id: build,       file: emerge/lang/build-loader.js, does: "where the current build lives (EMERGE_BUILD or lang/build/current); the primitives every module reads; the prelude the runtime loads; seed mode for bootstrapping" }
    - { id: bootstrap,   file: emerge/lang/bootstrap.js,  does: "core/*.eg → build/next → prove → build/current (previous kept); rollback; status" }
    - { id: say,         file: emerge/lang/say/say.eg,     does: "eg say / eg teach / eg words: a sentence in his own words becomes Emerge that checks clean, no model; his vocabulary (lang/say/words.eg) carries his quote for every word; spec: emerge/spec/say.spec" }
    - { id: map,         file: emerge/lang/map.js,         does: "eg map → lang/MAP.md: every keyword, contextual word, type, primitive, builtin, ledger kind and axiom, read from the source; emerge.spec words shared with the syntax, with the ontology's meaning beside each" }
    - { id: cli,         file: emerge/lang/eg.js,          does: "eg new | run | build | check | test | components | map | bootstrap | repl | ast | tokens" }

  grammar: |
    program     = { item }
    item        = use | fn_decl | compartment | component | template | kind | axiom | test | on_decl | stmt
    use         = "use" STRING "as" IDENT
    fn_decl     = "fn" IDENT "(" params ")" [ ":" type ] ( block | "=" expr )
    params      = [ IDENT [ ":" type ] { "," IDENT [ ":" type ] } ]
    type        = ("int"|"float"|"num"|"string"|"bool"|"list"|"map"|"fn"|"any") [ "?" ]
    compartment = "compartment" IDENT "{" { member } "}"
    member      = "id" "=" STRING | "intent" "=" STRING | "state" "{" [ IDENT ":" expr { "," IDENT ":" expr } ] "}"
                | "constraint" IDENT [ ctype ] [ "cost" NUMBER ] "{" expr "}" | "invariant" IDENT "{" expr "}"
                | on_decl | fn_decl
    ctype       = "hard" | "soft" | "probabilistic" | "temporal" | "causal" | "relational"
    component   = "component" IDENT [ "is" IDENT { "," IDENT } ] "{" { cmember } "}"
    template    = "template" IDENT "(" params ")" [ "is" IDENT { "," IDENT } ] "{" { cmember } "}"     (no id, no uuid: given at spawn)
    kind        = "kind" IDENT [ "is" IDENT { "," IDENT } ] "{" { kmember } "}"
    kmember     = "require" IDENT { "," IDENT } | "in" IDENT [ "(" IDENT ":" shape ")" ] | "out" IDENT [ ":" shape ]
                | "state" "{" IDENT ":" type { "," IDENT ":" type } "}" | "boundary_count" NUMBER [ ".." NUMBER ] | "fn" IDENT "(" params ")"
    cmember     = ("id"|"namespace"|"version"|"uuid"|"intent") "=" STRING | "state" … | "constraint" … | "invariant" …
                | "boundary" IDENT "{" expr "}" | "in" IDENT [ "(" IDENT [ ":" shape ] ")" ] block
                | "out" IDENT [ ":" shape ] | fn_decl
    shape       = "{" [ IDENT ":" type { "," IDENT ":" type } ] "}"
    wire        = "wire" end "->" end          end = IDENT "." IDENT | STRING   (a statement: anywhere but handlers and lenses)
    on_decl     = "on" STRING [ "(" IDENT ")" ] block
    axiom       = "axiom" IDENT "{" expr "}"
    test        = "test" STRING block
    stmt        = ("let"|"var") IDENT [ ":" type ] "=" expr
                | lvalue ( "=" | "+=" | "-=" | "*=" | "/=" ) expr
                | "if" expr block { "else" "if" expr block } [ "else" block ]
                | "while" expr block
                | "for" [ "each" ] IDENT [ "," IDENT ] "in" expr block
                | "break" | "skip" | "return" [ expr ]
                | "emit" expr [ map | "with" expr ]
                | "emit" "out" IDENT [ map | "with" expr ]
                | "send" IDENT "." IDENT [ map | "with" expr ]
                | "despawn" expr
                | wire
                | "record" expr [ map | "with" expr ]
                | "gap" expr "pressure" expr [ "type" IDENT ]
                | "promote" expr "with" "proof" expr
                | "try" block "else" [ IDENT ] block
                | "expect" expr [ "," expr ]
                | expr
    expr        = pipe ;  precedence low → high:
                  |>  ··  ??  ··  or  ··  and  ··  not  ··  == != < <= > >= contains starts_with ends_with matches
                  ··  ..  ··  + -  ··  * / %  ··  ** (right)  ··  unary -  ··  call () member . index []
    primary     = NUMBER | STRING | "true" | "false" | "null" | IDENT | "state" | "(" expr ")"
                | "[" [ expr { "," expr } ] "]" | "{" [ key ":" expr { "," key ":" expr } ] "}"
                | "fn" "(" params ")" ( block | "=" expr ) | "whatif" block | "spawn" IDENT "(" expr { "," expr } ")"
    terminators = NEWLINE | ";" | "}" | EOF.  A line may continue after a binary operator, a comma, an open bracket, or
                  before a leading "|>".

  semantics:
    values: "num (IEEE double) · int (64-bit signed, BigInt-backed, literal 42i / 0xFFi, never mixed with num) · string · bool · null · list · map (string keys, insertion order) · fn · compartment handle · module"
    truth: "if / while / and / or / not / expect / constraint / axiom demand a bool — anything else is a runtime error, never coerced"
    equality: "== is deep structural equality on every value"
    plus: "num+num · string+any (any rendered) · list+list · map+map (right wins); anything else is a runtime error"
    division: "x / 0 is a runtime error"
    member: "map.missing → null; list/string/num have no members (use len, slice, …); member of null is a runtime error"
    bindings: "let is immutable, var is mutable; for-loop variables are fresh per iteration and immutable; closures capture by reference"
    annotations: "optional ': type' on let/var/params/returns, checked at run time on every bind and assignment"
    pipe: "a |> f(b) is f(a, b); a |> f is f(a)"
    fn_hoisting: "fn declarations are hoisted within their block; compartments become usable at the statement that declares them"

  compartments:
    - "a compartment is a bounded container with identity (id), declared state, constraints, handlers and lens fns"
    - "on \"sig\" (ev) { … } runs against a deep working copy of state; assignments go to the copy"
    - "when the handler ends, the copy is proposed: every constraint is evaluated with emerge/core/constraint.evaluate()"
    - "a constraint's needs are the state.X names it reads; a needed field that is null is a gap — the state does not change"
    - "hard (and temporal, causal, relational) refuse a violation: state unchanged, the handler's emits are discarded and listed in the ledger, signal \"rejected\" is emitted"
    - "soft and probabilistic permit it at 'cost N' (default 1), added to spent()"
    - "fn inside a compartment is a lens: it reads a deep-frozen copy of state and may not assign state, emit, record, gap or promote"
    - "outside its handlers a compartment's state is read through Name.state — a deep-frozen copy; it can never be written"
    - "initial state must satisfy every hard constraint whose needs are present, or declaration is a runtime error"

  components:
    - "a component is a compartment with identity and ports: id, namespace, semver version (all required), uuid (optional — derived deterministically from namespace/id@version and marked uuid_derived)"
    - "boundary NAME { expr } — 1 to 5 identity-defining invariants (schema.component's boundary); enforced exactly as hard constraints; a refusal says boundary: true"
    - "in hook(param: shape) { … } — a transactional handler, like on, fed only by wires and send; out hook: shape — declared output"
    - "a component speaks only through out hooks (plain emit inside it is a compile error) and listens only through in hooks (on inside it is a compile error)"
    - "emit out h { … } is buffered like emit: it leaves only if the transition commits"
    - "a shape is a seam contract: every field present with its type, nothing extra; checked at emit out, at send and on delivery to an in hook"
    - "wire A.out -> B.in · wire \"signal\" -> B.in · wire A.out -> \"signal\"; signal → signal is an on handler, not a wire"
    - "compile time: wire ends exist and run out → in; no duplicate wires; out → in shapes must be compatible (num flows into num, int only into int, any accepts all, a nullable out cannot feed a non-null in, no missing or extra fields)"
    - "warnings: an out hook with no wire, an in hook nothing wires or sends to"
    - "run time: an out with no wire is recorded unrouted as Comp.hook; wires are recorded in the ledger; whatif restores them"
    - "components() returns { components, hooks, wires } — the same records eg components exports statically, validated against the required fields read from emerge/schemas/schema.component, schema.hook, schema.wire"
    - "a wire with a signal end is exported with a signal:<name> endpoint and signal_endpoint: true — it is not a loom hook, and says so"

  kinds:
    - "a kind is a schema for a primitive: what any component claiming it must have — required identity fields, in hooks and out hooks (with shapes), typed state fields, a boundary count range, lens fns by arity"
    - "kind B is A merges A's requirements into B; B may restate a hook to narrow it; unknown parents and cycles are compile errors"
    - "component X is K, … / template T(…) is K, … — conformance is checked at compile time: every required hook exists in the right direction; the implementation's in shape accepts the kind's in shape; its out shape can feed the kind's out shape (an out with no shape cannot satisfy a shaped requirement); state fields exist; boundary count is in range; fns exist with the arity"
    - "typed state from kinds is checked at run time when the component is declared or spawned and before every commit — a wrong type is a loud error naming the kind"
    - "is_kind(x, \"K\") is true for a component or instance that claims K or a kind that inherits from K"
    - "kind declarations have no run-time effect besides that; eg components exports them as 'kinds'"

  templates:
    - "a template is a component with parameters; it declares namespace and version (required), never id or uuid"
    - "spawn T(id, args…) — an expression; makes a live component named T(id) with that id, its own state and a uuid derived from namespace/id@version; parameters are visible to state initialisers, constraints, boundaries, hooks and fns"
    - "spawn and despawn change the world, not a transition: they are not allowed in handlers, in hooks or lenses (compile time and run time)"
    - "despawn h — only a spawned instance; records 'despawn', drops every wire touching it (each recorded); its handle then errors on use"
    - "wire and send accept a variable holding an instance: wire g1.out -> g2.in. When the variable was bound directly by let/var = spawn T(…), hooks and shapes are checked at compile time against T; otherwise at run time"
    - "whatif restores spawns, despawns and wires; a handle spawned inside a whatif is dead outside it"
    - "instances(\"T\") lists the live instances of a template, in spawn order; components() includes them with template and kinds"

  bootstrap:
    sources:
      - "lang/core/primitives.eg — the core rules as data: constraint_types {name: {permits_violation, default_cost}}, gaps {types, default_type, constraint_gap, promotion_refused}, signals {rejected, gap_opened, promoted}, truth {strict}, dispatch {max_deliveries, unrouted: log|error}, transitions {discard_emits_on_refusal}, components {boundary_max, hook_type}, diagnostics {rule: error|warning|off}"
      - "lang/core/prelude.eg — the standard library in Emerge; every top-level fn not starting with _ becomes a builtin, and may replace a native one"
      - "lang/core/selftest.eg — test blocks the build must pass; yours to extend with every change you make"
    rules:
      - "the primitives file is evaluated in seed mode: it may only hold literal data — touching any primitive while evaluating it is an error, so there are no hidden defaults anywhere in JavaScript"
      - "the prelude is compiled against the new primitives with natives only (no prelude), so the build never depends on itself"
      - "the prelude may hold only fn declarations and lets; it runs as <prelude>, and an error raised inside it is reported at the nearest line outside it (the caller's)"
      - "laws and proofs stay bool even when truth.strict is false: constraint, invariant, boundary, axiom, expect and promote … with proof"
    pipeline:
      - "QUARANTINE: build into lang/build/next"
      - "PROVE: primitives schema · prelude compiles and loads · selftest.eg passes in the interpreter and compiled, with identical output · every example gives identical stdout, stderr, exit code and ledger in both backends · --strict also runs the JS test suites against next"
      - "INTEGRATE: current → previous, next → current, BUILD.json written (build number, sha256 of every source and output, the checks it passed)"
      - "a failed proof leaves current untouched and next in place for inspection"
      - "eg bootstrap --rollback swaps previous and current; --status compares the core sources with BUILD.json"
      - "eg run / build / check / test warn on stderr when the core sources changed since the current build"

  signals:
    - "emit queues a signal. At top level (and inside whatif) the queue drains to quiescence before the next statement"
    - "inside a handler emits are buffered and enter the queue only if the transition commits"
    - "delivery is FIFO; one signal goes to every matching handler — compartment handlers in declaration order, then top-level on handlers. A pattern ending in * matches by prefix"
    - "a signal no handler claims is recorded as 'unrouted' and reported on stderr (SIGNAL_MUST_ROUTE_OR_LOG)"
    - "a runtime error during delivery records 'aborted' with the undelivered signals, clears the queue and propagates"
    - "more than 100000 deliveries in one drain is a runtime error (signal storm)"

  ledger:
    - "record appends { seq, kind, body, prev, hash } — sha256 over canonical JSON, chained; no wall-clock time anywhere"
    - "the runtime records: seed, compartment, transition, rejected, violation, gap, unrouted, aborted, promote, promotion_refused, whatif, axiom"
    - "ledger() returns a frozen copy; ledger_verify() recomputes every hash and link"
    - "one seed, one program → byte-identical ledger in both backends"

  axioms:
    NO_SILENT_DROP:               "compile: try's else block may not be empty · run: unrouted / aborted / discarded signals are all recorded"
    SIGNAL_MUST_ROUTE_OR_LOG:     "compile: warning for emit of a literal signal no handler in the program matches · run: unrouted is recorded and reported"
    GAP_IS_FIRST_CLASS:           "compile: gap requires pressure (a literal must be in [0,1]) and a known type · run: gaps() lists them; each emits gap.opened"
    EXECUTION_IS_TRACEABLE:       "compile: every compartment declares an id, ids are unique · run: every error names file and line"
    RECORD_IS_TRUTH:              "run: hash-chained ledger; state changes only through recorded transitions"
    PROOF_REQUIRED_FOR_PROMOTION: "compile: promote without 'with proof' does not parse · run: a proof that is not true refuses the promotion and opens a logical gap at pressure 0.9"
    GRAMMAR_APPLIES_TO_ITSELF:    "not claimed — the compiler is JavaScript, not Emerge. Named here so it is not mistaken for done."
    user_axioms:                  "axiom NAME { bool expr } is checked at declaration and after every top-level statement; a violation halts the program"

  whatif:
    - "whatif { … } forks the world (compartment states, ledger, gaps, queue, seed position, spent), runs the block, and restores"
    - "its value is the value of its last expression statement (null otherwise)"
    - "it may not assign a variable outside itself, assign state, return, break or skip"
    - "the real ledger gets one 'whatif' entry naming the line"

  testing:
    - "test \"name\" { … } blocks run only under 'eg test'; each runs in its own whatif fork after the top level has run"
    - "expect cond [, message] fails the test (or halts a run) when cond is false"

  rules:
    - "every diagnostic and runtime error carries file:line:col (runtime errors: file:line)"
    - "the interpreter and the compiled JS call one runtime for every operator, builtin and world operation"
    - "nothing reads the clock; random() and uid() draw from the run's seed (mulberry32), default seed 0, --seed N"

  proof:
    - emerge/lang/test/lang.test.js        — lexer, parser, checker, every semantic rule above incl. components, both backends
    - emerge/lang/test/bootstrap.test.js   — on a copy: edit core/*.eg, eg bootstrap, the language changes in both backends; broken primitives, a broken prelude and a failing selftest never reach current; rollback; staleness; standalone
    - emerge/lang/test/differential.test.js — every program in emerge/lang/examples run by interpreter and by compiled JS: stdout, stderr, exit code and ledger hash identical

# ## ADDENDUM 2026-10-31 — the primitives fixed; functions consolidated into Emerge (CIE-EG §2, §0)
# James, 2026-10-31: "Fix the primitives. Use all of my quotes from nexus to consolidate emerge functions."
# The quotes it stands on (Nexus, kept where they were said):
#   2026-10-30, with ESS v0.1.0 (architecture-spec addendum (d), CHANGELOG-0.60.309): "way to many primitives i feel like"
#   2026-10-28 (docs/2026-10-28-run-log-and-direction.md): "i am completely removing js from emerge." · "all js needs to eventually be
#     replaced with .eg in emerge."
#   2026-10-05 / 2026-10-07: "combining primitives or invariants to build higher leverage code for less tokens." · "focus on coding using
#     overlapping primitives"
#   1.5.0 (this spec's changelog): "make it buildable" — the standard library is Emerge source.
# The coder's reading (TO CONFIRM): a function that can be written in Emerge from the others is library, not primitive. It is written once,
# in core/prelude.eg, and both backends (the interpreter and the native compiler) run that one definition. A primitive stays only where
# Emerge cannot say it: the OS (files, args, sha256 per P5 no_invented_crypto), the seeded RNG and the world (ledger, gaps, components),
# the value model (len, str, int, num, type_of, repr, index), and variadic signatures (min, max, range, join, get, slice, sort_by,
# print) until the language has optional parameters.
#
# 1. The primitives fixed (DECIDED in CIE-EG §2, cie-eg.spec s02: "Strings are sequences of Unicode code points. len(s) counts code points
#    … UTF-16 appears nowhere."). The interpreter counted UTF-16 units in len, s[i], slice, split(s, ""), find_text and string < > while
#    `for c in s` and the native compiler used code points: len("😀") was 2 interpreted and 1 native. All now count code points
#    (lang/runtime.js cps / cpLen / cpCmp), and `matches` compiles its pattern with the u flag, so . is one code point.
# 2. Moved from JavaScript (lang/runtime.js) into core/prelude.eg, and so native too: ceil round abs · sort clone · trim replace ·
#    hex from_hex · u8 u16le u32le u64le i32le i64le u16be u32be u64be read_u64be · wrap32 rotl rotr.
#    The nine fixed-width encoders are one function (_fixed) and nine one-line uses of it.
# 3. Still primitive, and why: upper / lower (Unicode case tables; the text tables wait on D5), sort_by (an optional direction argument),
#    parse_json / json (the native json.eg can follow), the `..` value and `matches` natively (a regex engine in Emerge is its own phase).
# Proof: lang.test, differential, bootstrap, native (a case per moved function, interpreter == native) and selfhost (AT-11) all green.

# ## ADDENDUM 2026-10-31 (1.11.0) — node files are data a program uses (his rule)
# James, 2026-10-31: "only using hardcoded when neccarry, using external node files for data, options, etc."
# use "./x.node" as node: a node file (his envelope: envelope, uuid, type, id, intent, system, tags, summary, payload) is
# loaded as data, its top-level fields the module's members (node.payload.options.max). It is read in its JSON form (JSON is
# valid YAML, so Nexus's tools read the same file), resolved beside the program like any module (lang/runtime.js rt.use).
# eg check names a broken node file; eg build copies it beside the output; the native compiler refuses it by name for now.

