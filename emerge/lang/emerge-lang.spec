spec:
  meta:
    name:     emerge-lang
    version:  1.5.0
    date:     2026-10-26
    changelog: '1.5.0 — buildable: the core primitives and the standard library are Emerge source, rebuilt by eg bootstrap (James: "make it buildable") · 1.4.0 — kinds (schemas for primitives) and templates (spawned at run time), James: "a template or schema for dynamic primitives" · 1.3.0 — components: hooks, shapes, wires, boundary, send, eg components (James: "what about adding the component logic?")'
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
    - { id: cli,         file: emerge/lang/eg.js,          does: "eg run | build | check | test | components | repl | ast | tokens" }

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
    values: "num (IEEE double; int = integral num) · string · bool · null · list · map (string keys, insertion order) · fn · compartment handle · module"
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
    - "compile time: wire ends exist and run out → in; no duplicate wires; out → in shapes must be compatible (int flows into num, any accepts all, a nullable out cannot feed a non-null in, no missing or extra fields)"
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
