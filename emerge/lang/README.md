# Emerge — the language

`.eg` files are now programs, not token soup. A grammar parses them. A checker resolves every name and enforces the
Emerge axioms before anything runs. One runtime gives them meaning. There are two ways to execute: an interpreter
(`eg run`) and a compiler to CommonJS (`eg build`). Both call the same runtime, and the tests require byte-identical
stdout, stderr, exit code and ledger from the two.

Contract: [`emerge-lang.spec`](emerge-lang.spec). Zero dependencies beyond node ≥ 18 and `emerge/core/constraint.js`.

```
node lang/eg.js run   examples/counter.eg            # interpret
node lang/eg.js build examples/counter.eg -o out     # compile → out/counter.js
node out/counter.js                                  # same output, same ledger
node lang/eg.js test  examples/tests.eg              # run test "…" blocks
node lang/eg.js check examples/idearium.eg           # errors + warnings, nothing runs
node lang/eg.js components examples/components.eg    # export the component graph as loom records
node lang/eg.js repl
```

`npm run test:lang` runs three test suites:

- 150 language tests, each through both backends
- 17 differential and CLI tests over the examples
- 11 bootstrap tests, which change the language on a copy and rebuild it

---

## Start here

You need node 18 or newer and nothing else (no npm install).

```
cd emerge
node lang/eg.js new myproj           # a starter: main.eg with a compartment, a handler, a lens fn and a test
node lang/eg.js run myproj/main.eg   # run it
node lang/eg.js test myproj/main.eg  # run its test blocks
node lang/eg.js check myproj/main.eg # compile-time errors and warnings only
node lang/eg.js build myproj/main.eg -o myproj/out && node myproj/out/main.js   # compile to JavaScript and run that
node lang/eg.js repl                 # try lines interactively
npm link                             # optional: makes `eg` a command everywhere (from the emerge/ folder)
```

Write `.eg` files in any editor. The loop is: edit, then `eg check` for errors with file:line:col, then `eg run` or
`eg test`. **The map:** [`MAP.md`](MAP.md) lists every keyword, contextual word, type, primitive, builtin (with arity),
ledger entry kind and axiom, and how the vocabulary of `emerge.spec` lines up with the syntax. `eg map` generates it
from the source, so it is never out of date. **Examples:** `examples/`, one per feature, from `hello.eg` to
`primitives.eg`.

## Native output (CIE-EG §10, in progress)

`lang/native/` holds the start of the native back end, written in Emerge: `x64.eg` (an x86-64 encoder and two-pass
assembler), `pe.eg` (a Windows PE32+ writer) and `elf.eg` (a Linux ELF64 writer). `milestone.eg` is §10.3: an Emerge
program that writes `hello.exe` and `hello` byte by byte. Both ran and printed `hello from emerge` (the `.exe` under
Wine 9). A compiler from Emerge programs to native code (`eg native`) is not built yet.

Bytes and bit operations (§3): `bytes(…)`, `0xFF`/`0b1010`, `& | ^ ~ << >>` on 32-bit words, `rotl rotr idiv`,
`u8 u16le u32le u64le i32le`, `hex from_hex utf8 byte_len sha256 read_bytes write_bytes`.

## Changing the language itself (0 tokens)

The core rules and the standard library are Emerge source in `lang/core/`. The toolchain builds itself from them.

| file | what it holds | change it to… |
|---|---|---|
| `core/primitives.eg` | constraint types, gap types and pressures, runtime signal names, strict or truthy conditions, unrouted = log or error, whether refused transitions discard their emits, boundary limit, hook type, and each axiom's severity (error, warning or off) | change what the language *means* |
| `core/prelude.eg` | the standard library in Emerge: map, filter, reduce, find, any, all, count, push, reverse, sum, index_of, without, flatten, zip, unique, group_by, take, drop | add or replace builtins. A prelude fn with a native's name replaces the native |
| `core/selftest.eg` | `test` blocks every build must pass | pin the behaviour you rely on |

```
edit lang/core/primitives.eg            # e.g. let truth = { strict: false }
node lang/eg.js bootstrap               # or: npm run build
node lang/eg.js bootstrap --status      # is the build current with lang/core?
node lang/eg.js bootstrap --rollback    # back to the previous build
node lang/eg.js bootstrap --strict      # also run the JS test suites against the candidate
```

`eg bootstrap` goes QUARANTINE → PROVE → INTEGRATE:

1. **Quarantine.** It evaluates `primitives.eg` in seed mode, where only data is allowed and any read of a primitive is
   an error, so no rule hides a default in JavaScript. It compiles `prelude.eg` against the new primitives using
   natives only, so the build never depends on itself. Both go into `build/next/`.
2. **Prove.**
   - The primitives must pass a schema check, and the prelude must load.
   - `selftest.eg` must pass in both backends with identical output.
   - Every example must give identical stdout, stderr, exit code and ledger in both backends.
   - With `--strict`, the JS test suites must also pass against the candidate.
3. **Integrate.** `current` becomes `previous`, `next` becomes `current`, and it writes `BUILD.json` with the build
   number, the sha256 of every source and output, which natives the prelude replaces, and the checks that passed.

If any check fails, `current` is left alone and the candidate stays in `build/next` for you to inspect. While the core
sources are ahead of the build, `eg run/build/check/test` print a one-line reminder. An error raised inside the
prelude is reported at your line, not the prelude's. Constraints, boundaries, axioms, `expect` and proofs always need
a real bool, even with `truth.strict` false, because they are laws.

What still lives in JavaScript is the machinery: the parser, the checker's passes, the transaction engine, the
dispatch queue and the ledger. Changing *those* still means editing the compiler. Changing their *rules* doesn't.

## A tour

```eg
// values: num, string, bool, null, list, map, fn
let name = "Emerge"
print("hello from {name}")                    // {expr} interpolates; \{ is a literal brace

fn square(x: num): num = x * x                // annotations are optional and checked at run time
let squares = 1..6 |> map(square)             // a |> f(b) is f(a, b);  1..6 is [1, 2, 3, 4, 5]

var total = 0                                 // let is fixed, var can change
for i, x in squares { total += x }
if total > 50 and not (total == 60) { print("big") } else { print("small") }

let person = { name: "James", tools: ["nexus", "warp"] }
print(person.age ?? "unknown")                // a missing key is null; ?? defaults it
```

Conditions must be `bool`: `if 1 { }` is a runtime error, not a coercion. `==` compares structure deeply. `+` joins
num+num, string+anything, list+list and map+map, and nothing else. Errors always carry `file:line`.

## Compartments, signals, constraints

```eg
compartment Counter {
  id = "co-counter-001"                       // required: EXECUTION_IS_TRACEABLE
  intent = "count ticks without going negative"
  state { count: 0, history: [] }

  constraint never_negative hard { state.count >= 0 }
  constraint stays_small soft cost 3 { state.count <= 10 }

  on "tick" (ev) {                            // runs against a working copy of state
    state.count += ev.by
    emit "counted" { count: state.count }     // buffered until the transition commits
  }

  fn doubled() = state.count * 2              // a lens: reads a frozen copy, can't write or emit
}

on "counted" (ev) { print("counted", ev.count) }
on "rejected" (r) { print("refused", r.constraint) }

emit "tick" { by: 4 }       // commits → "counted"
emit "tick" { by: -20 }     // never_negative refuses: state unchanged, "counted" discarded, "rejected" emitted
print(Counter.state, Counter.doubled())   // Counter.state is a frozen copy — it can never be written
```

When a handler finishes, its working copy is **proposed**. Every constraint is evaluated with `emerge/core`'s
`evaluate()`, which gives one of three answers:

| outcome | what happens |
|---|---|
| all hold | state commits; `transition` is recorded with the changed fields; buffered emits are queued |
| a **hard** (or temporal/causal/relational) constraint breaks | state unchanged; `rejected` is recorded with the discarded emits; signal `rejected` is emitted |
| a **soft**/probabilistic one breaks | commits anyway; its `cost` is added to `spent()` |
| a needed `state.X` is `null` | it **cannot be evaluated**, so this is a gap: state unchanged; `gap.opened` is emitted |

Signals go out FIFO. Each one reaches every matching handler: compartment handlers first, in declaration order, then
top-level `on` handlers. A pattern ending in `*` matches by prefix. A signal that nobody handles goes into the ledger
as `unrouted`, and a summary is printed on stderr. Nothing is dropped silently.

## Components: hooks, shapes, wires

A compartment holds state. A **component** is a compartment that you compose: it has an identity (`id`, `namespace`,
semver `version`, optional `uuid`), a `boundary` of 1–5 identity invariants, and typed **hooks**. It listens only
through `in` hooks and speaks only through `out` hooks. **Wires** connect hooks, so the wiring is the architecture.

```eg
component Smoother {
  id = "sensor.smoother"
  namespace = "sensor"
  version = "1.1.0"
  state { window: [] }
  boundary bounded_window { len(state.window) <= 3 }

  in sample(s: { n: int, celsius: num }) {          // the shape is the seam contract
    var w = push(state.window, s.celsius)
    if len(w) > 3 { w = slice(w, 1) }
    state.window = w
    emit out smoothed { celsius: sum(w) / len(w), of: len(w) }
  }
  out smoothed: { celsius: num, of: int }
}

wire "reading" -> Sensor.reading           // signal → hook
wire Sensor.sample -> Smoother.sample      // hook → hook (shapes checked at compile time)
wire Alarm.alert -> "alert"                // hook → signal, for on handlers
send Alarm.configure { limit: 25 }         // feed an in hook directly
```

- An `in` hook runs like `on`: it gets a working copy, and the copy is proposed against the constraints and boundary.
  `emit out` is buffered and leaves only if the transition commits.
- A shape requires every field with its type and nothing extra. It is checked at `emit out`, at `send`, and when a
  payload arrives at an `in` hook. At compile time, a wire between incompatible shapes is a **seam mismatch** error.
  `int` flows into `num`, and `any` accepts anything.
- Other compile-time errors: a wire running in → out, a hook that doesn't exist, a duplicate wire, a component using
  `on` or plain `emit`. Warnings: an out hook nothing is wired to, an in hook nothing feeds.
- At run time, an out with no wire is recorded as `unrouted` (`Comp.hook`). `Comp.namespace`, `.version`, `.uuid`
  and `.hooks` read the identity. `components()` returns the live graph.
- `eg components file.eg --out graph.json` exports `{components, hooks, wires}` as loom records and validates them
  against the required fields it reads from `emerge/schemas/schema.component`, `schema.hook` and `schema.wire`.
  A uuid you don't declare is derived from `namespace/id@version`, so it is stable, and is marked `uuid_derived`.
  A wire with a signal end exports as `signal:<name>`, flagged `signal_endpoint: true`, because it is not a loom hook.

See [`examples/components.eg`](examples/components.eg): a sensor → smoother → alarm pipeline.

## Dynamic primitives: kinds and templates

A **kind** is a schema for a primitive. It names what any component claiming it must have. A **template** is a
component with parameters: `spawn` makes live instances of it at run time, and you can wire, feed and despawn them.

```eg
kind Stage {                          // what a Stage IS
  require version
  in take(x: { v: num })
  out give: { v: num }
  state { count: int }                // typed: checked at spawn and before every commit
  boundary_count 1..2
}
kind Filter is Stage { fn passed() }  // inherits everything, adds a lens fn

template Clamp(lo: num, hi: num) is Filter {
  namespace = "pipe"
  version = "1.0.0"
  state { count: 0, kept: 0 }
  boundary ordered { lo <= hi }       // parameters are visible everywhere inside
  in take(x: { v: num }) {
    state.count += 1
    if x.v >= lo and x.v <= hi { state.kept += 1
      emit out give { v: x.v } }
  }
  out give: { v: num }
  fn passed() = state.kept
}

let band = spawn Clamp("band", 0, 15)        // id first, then the parameters → instance Clamp(band)
wire stages[0].give -> band.take             // any expression that gives an instance can be a wire end
print(is_kind(band, "Stage"), instances("Clamp"))
despawn band                                 // its wires go with it; the handle is dead afterwards
```

- **Conformance is checked at compile time.** For every kind a component or template claims (including inherited
  ones), the compiler checks that:
  - required hooks exist and face the right way;
  - the implementation's in shape accepts the kind's shape, and its out shape fits the kind's shape;
  - required state fields exist;
  - the number of boundary invariants is in range;
  - required fns exist with the right arity;
  - required identity fields are declared.
- **Instances** get their id from `spawn`, their name is `T(id)`, and their uuid is derived from
  `namespace/id@version`. A template therefore cannot declare `id` or `uuid`.
- **Compile-time checks follow `let x = spawn T(…)`.** Wires and sends through `x` are checked against `T`'s hooks and
  shapes when the program compiles. Any other expression is checked when the program runs.
- **`spawn`, `despawn` and `wire` change the world, not a transition,** so they aren't allowed inside handlers,
  in hooks or lenses. Every spawn, despawn, wire and unwire is recorded in the ledger, and `whatif` restores all of it.
- **Builtins:** `is_kind(x, "K")`, `instances("T")`, and `x.template` / `x.kinds` on an instance.
- **Export:** `eg components` adds `kinds` and `templates` arrays to the export, next to the loom records.

See [`examples/primitives.eg`](examples/primitives.eg). It builds a pipeline from a data plan, wires it in a loop,
tries a different wiring inside a `whatif`, and despawns an instance.

## Ledger, gaps, promotion, whatif

```eg
record "decision" { chose: "warp" }           // hash-chained entry: { seq, kind, body, prev, hash }
print(ledger_verify())                        // recomputes every sha256 and link

gap "no auth token yet" pressure 0.7 type evidential    // pressure is required; emits gap.opened
print(gaps())

promote "loom" with proof tests_pass("loom")  // the proof must be true: otherwise refused + a logical gap @ 0.9

let level = whatif {                          // fork the world: states, ledger, gaps, queue, seed, spent
  emit "fill" { amount: 60 }
  Tank.state.level                            // value of the last expression
}                                             // …then everything is restored

axiom BOOKS_BALANCE { Account.state.balance == audit_total }   // checked after every top-level statement
```

The runtime never reads the clock. `random()` and `uid()` draw from the run's seed (`--seed N`, default 0), so one
program with one seed gives a byte-identical ledger every time, in both backends.

## The axioms, and where each is enforced

| axiom | compile time | run time |
|---|---|---|
| NO_SILENT_DROP | `try` needs an `else`, and it can't be empty | unrouted, aborted and discarded signals are all recorded |
| SIGNAL_MUST_ROUTE_OR_LOG | warning for `emit "x"` when no handler matches | `unrouted` recorded and reported on stderr |
| GAP_IS_FIRST_CLASS | `gap` needs `pressure` in [0,1] and a known type | `gaps()`, `gap.opened`, constraint gaps |
| EXECUTION_IS_TRACEABLE | every compartment declares a unique `id` | every error names its file and line |
| RECORD_IS_TRUTH | — | the hash-chained ledger; state changes only through recorded transitions |
| PROOF_REQUIRED_FOR_PROMOTION | `promote` without `with proof` doesn't parse | a false proof refuses the promotion and opens a gap |
| GRAMMAR_APPLIES_TO_ITSELF | **not claimed**: the compiler is JavaScript, not Emerge | — |

## Modules and tests

```eg
use "./lib/stats.eg" as stats       // top-level fns, lets and compartments are the exports
print(stats.mean([1, 2, 3]))

test "gcd" { expect gcd(48, 18) == 6 }   // eg test: each test runs in its own whatif fork
```

## Statements and builtins

**Statements:** `let` · `var` · `=` `+=` `-=` `*=` `/=` · `if / else if / else` · `while` · `for x in` · `for i, x in` ·
`break` · `skip` · `return` · `emit` · `record` · `gap` · `promote … with proof` · `try … else e` · `expect cond, msg`.

**Operators** (lowest precedence first): `|>` · `??` · `or` · `and` · `not` · `== != < <= > >= contains in starts_with
ends_with matches` · `..` · `+ -` · `* / %` · `**` · unary `-` · calls, `.member`, `[index]`.

**Builtins.** The natives, in JavaScript: `print str num int floor ceil round abs sqrt min max len keys values has get
clone slice sort sort_by range join split upper lower trim replace type_of json parse_json random uid gaps ledger
ledger_verify spent components is_kind instances args raise read_file write_file truthy find_text repr`.

The prelude, in Emerge (`core/prelude.eg`): `map filter reduce find any all count push reverse sum index_of without
flatten zip unique group_by take drop`.

All builtins are pure, meaning they return new values. The exceptions are `print`; `random` and `uid`, which draw from
the seed; and the two file builtins.

## Files

| file | does |
|---|---|
| `lexer.js` | source → tokens (line/col, interpolation, significant newlines) |
| `parser.js` | tokens → AST, recursive descent |
| `checker.js` | name resolution and the compile-time axioms; annotates the AST for the backends |
| `components.js` | component/hook/wire records, derived uuids, shape compatibility, schema validation |
| `runtime.js` | values, operators, builtins, the world (compartments, signals, ledger, gaps, seed, whatif) |
| `interpreter.js` | walks the AST against the runtime |
| `emitter.js` | AST → CommonJS against the same runtime |
| `build-loader.js` | where the build lives (`EMERGE_BUILD` or `build/current`); hands the primitives and prelude to everything else |
| `map.js` | `eg map`: generates MAP.md from the source |
| `bootstrap.js` | `eg bootstrap`: quarantine → prove → integrate, rollback, status |
| `core/*.eg` | the language's own primitives, standard library and selftest |
| `index.js` | API: `compileSource`, `runFile`, `buildFile` |
| `eg.js` | the CLI |

`eg build --standalone` copies the runtime into `out/_emerge/`, so the output runs without the rest of the repo.

## Relation to the older pieces

`emerge-kernel.js` (the whitespace tokenizer and SNR gate), `emerge-codegen-v2.js` and `emerge-ide.js` are unchanged.
In this language the SNR gate's job, deciding what counts as signal, belongs to the grammar and the checker. A token
either parses into the tree or becomes a located error. Nothing is scored, and nothing is dropped. The 569-word
vocabulary in `emerge.spec` is still the ontology. The language uses the parts of it that have executable meaning.

Speed, measured on one machine (`fib(25)`, 242,785 calls, wall clock including node start-up): interpreter 0.92 s,
compiled 0.05 s.
