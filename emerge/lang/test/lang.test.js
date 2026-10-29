'use strict';
// emerge/lang/test/lang.test.js — proof for emerge/lang/emerge-lang.spec.
// Every runtime case goes through BOTH backends (harness.both) and fails if they differ in stdout, stderr, exit code
// or ledger hashes — before its own assertions are even looked at.

const assert = require('assert');
const { both, checkSrc } = require('./harness');
const { lex } = require('../lexer');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed++; process.stdout.write(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}\n`); }
}
const section = s => process.stdout.write(`\n${s}\n`);

/** expect a compile error whose message contains `frag` (and, if given, at line) */
function compileErr(src, frag, line) {
  const r = checkSrc(src);
  const hit = r.errors.find(e => e.message.includes(frag));
  assert.ok(hit, `expected an error containing ${JSON.stringify(frag)}, got ${JSON.stringify(r.errors.map(e => `${e.line}: ${e.message}`))}`);
  if (line !== undefined) assert.strictEqual(hit.line, line, `error line: ${hit.line} ≠ ${line}`);
}
function compileOk(src) {
  const r = checkSrc(src);
  assert.deepStrictEqual(r.errors.map(e => `${e.line}:${e.col} ${e.message}`), []);
  return r;
}
const out = (src, opts) => { const r = both(src, opts); assert.strictEqual(r.err, '', `unexpected stderr: ${r.err}`); assert.strictEqual(r.code, 0); return r.out; };
const fails = (src, frag, opts) => {
  const r = both(src, opts);
  assert.strictEqual(r.code, 1, `expected exit 1, got ${r.code}; out: ${r.out}`);
  assert.ok(r.err.includes(frag), `stderr ${JSON.stringify(r.err)} lacks ${JSON.stringify(frag)}`);
  return r;
};

// ════════════════════════════════════════════════════════════════════════════
section('lexer');
t('tokens carry line and column', () => {
  const toks = lex('let x = 1\n  print(x)', 'f.eg');
  const p = toks.find(k => k.v === 'print');
  assert.deepStrictEqual([p.line, p.col], [2, 3]);
});
t('newlines inside ( ) and [ ] are whitespace', () => {
  const toks = lex('f(1,\n2)\n[3,\n4]', 'f.eg');
  assert.strictEqual(toks.filter(k => k.t === 'NL').length, 2);
});
t('numbers: underscores, fractions, exponents; 1..3 stays a range', () => {
  const v = lex('1_000 2.5 3e2 1..3', 'f.eg').filter(k => k.t === 'NUM').map(k => k.v);
  assert.deepStrictEqual(v, [1000, 2.5, 300, 1, 3]);
});
t('unterminated string names its start', () => compileErr('let s = "abc', 'unterminated string', 1));
t('unknown escape is an error', () => compileErr('let s = "a\\q"', 'unknown escape'));
t('malformed number is an error', () => compileErr('let n = 12abc', 'malformed number'));
t('unexpected character is an error with location', () => compileErr('let x = 1\nlet y = @', 'unexpected character "@"', 2));
t('interpolation may hold strings and indexing', () => assert.strictEqual(out('let m = {k: "v"}\nprint("<{m["k"]}>")'), '<v>\n'));
t('\\{ is a literal brace', () => assert.strictEqual(out('print("\\{x\\}")'), '{x}\n'));

section('parser');
t('comparisons do not chain', () => compileErr('let x = 1 < 2 < 3', 'do not chain'));
t('missing } is reported', () => compileErr('fn f() {\n  return 1\n', 'unterminated block'));
t('gap without pressure does not parse (GAP_IS_FIRST_CLASS)', () => compileErr('gap "x"', 'GAP_IS_FIRST_CLASS'));
t('promote without proof does not parse (PROOF_REQUIRED_FOR_PROMOTION)', () => compileErr('promote 1', 'PROOF_REQUIRED_FOR_PROMOTION'));
t('try without else does not parse (NO_SILENT_DROP)', () => compileErr('try { print(1) }', 'NO_SILENT_DROP'));
t('compartment/axiom/test/on only at top level', () => compileErr('fn f() {\n  on "x" { }\n}', 'only allowed at the top level', 2));
t('a pipe may lead the next line', () => assert.strictEqual(out('let r = [3, 1, 2]\n  |> sort\n  |> map(fn(x) = x * 10)\nprint(r)'), '[10, 20, 30]\n'));
t('maps may span lines; keys may be keywords', () => assert.strictEqual(out('let m = {\n  state: 1,\n  "two words": 2\n}\nprint(m)'), '{state: 1, "two words": 2}\n'));
t('else may sit on the next line', () => assert.strictEqual(out('if false { print(1) }\nelse { print(2) }'), '2\n'));
t('statements need a terminator', () => compileErr('let x = 1 let y = 2', 'expected end of statement'));
t('-2 ** 2 is -(2 ** 2)', () => assert.strictEqual(out('print(-2 ** 2, 2 ** 3 ** 2)'), '-4 512\n'));

section('checker — names and bindings');
t('undefined names are errors', () => compileErr('print(nope)', '"nope" is not defined'));
t('let cannot be assigned', () => compileErr('let x = 1\nx = 2', 'only a var can be assigned', 2));
t('contents change only through a var', () => compileErr('let m = {a: 1}\nm.a = 2', 'change contents through a var'));
t('duplicate declarations in one scope', () => compileErr('let x = 1\nvar x = 2', 'already declared'));
t('shadowing in an inner scope is allowed', () => assert.strictEqual(out('let x = 1\nif true { let x = 2\n print(x) }\nprint(x)'), '2\n1\n'));
t('parameters are immutable', () => compileErr('fn f(a) { a = 1 }', 'a parameter'));
t('fn declarations are hoisted', () => assert.strictEqual(out('print(twice(4))\nfn twice(x) = x * 2'), '8\n'));
t('break outside a loop', () => compileErr('break', 'break outside a loop'));
t('return outside a function', () => compileErr('return 1', 'return outside a function'));
t('arity of a user fn is checked', () => compileErr('fn f(a, b) = a\nf(1)', 'f takes 2 argument(s), got 1'));
t('arity of a builtin is checked', () => compileErr('len(1, 2)', 'len takes 1 argument(s), got 2'));
t('an empty else is refused (NO_SILENT_DROP)', () => compileErr('try { print(1) } else { }', 'NO_SILENT_DROP'));
t('gap pressure literal must be in [0, 1]', () => compileErr('gap "x" pressure 1.5', 'pressure is in [0, 1]'));
t('gap type must be known', () => compileErr('gap "x" pressure 0.5 type vibes', 'gap type "vibes"'));

section('checker — compartments');
const COMP = (body) => `compartment C {\n  id = "c-1"\n  state { n: 0 }\n${body}\n}`;
t('a compartment needs an id (EXECUTION_IS_TRACEABLE)', () => compileErr('compartment C { state { n: 0 } }', 'EXECUTION_IS_TRACEABLE'));
t('compartment ids are unique', () => compileErr('compartment A { id = "x" }\ncompartment B { id = "x" }', 'already used by A'));
t('state outside a compartment', () => compileErr('print(state)', 'state is only available'));
t('unknown state field', () => compileErr(COMP('  on "a" { state.m = 1 }'), 'no state field "m"'));
t('state[...] is refused', () => compileErr(COMP('  on "a" { print(state["n"]) }'), 'state fields are named'));
t('a lens fn cannot assign state', () => compileErr(COMP('  fn f() { state.n = 1 }'), 'read-only here'));
t('a lens fn cannot emit', () => compileErr(COMP('  fn f() { emit "x" }'), 'not allowed in a lens'));
t('a constraint cannot emit (it is an expression) and must read state', () => {
  const r = checkSrc(COMP('  constraint k hard { true }'));
  assert.ok(r.warnings.some(w => w.message.includes('reads no state field')));
});
t('a handler returns nothing', () => compileErr(COMP('  on "a" { return 1 }'), 'returns nothing'));
t('one handler per signal per compartment', () => compileErr(COMP('  on "a" { }\n  on "a" { }'), 'already handles "a"'));
t('Name.state cannot be assigned from outside', () => compileErr(COMP('') + '\nC.state.n = 1', '"C" is a compartment'));

section('checker — whatif and SIGNAL_MUST_ROUTE_OR_LOG');
t('whatif cannot write outside itself', () => compileErr('var x = 1\nlet y = whatif { x = 2 }', 'cannot write outside itself'));
t('whatif cannot return', () => compileErr('fn f() = whatif { return 1 }', 'cannot leave a whatif'));
t('tests cannot write outside themselves', () => compileErr('var x = 1\ntest "t" { x = 2 }', 'cannot write outside itself'));
t('an emit no handler matches is a warning', () => {
  const r = checkSrc('emit "lonely"');
  assert.strictEqual(r.errors.length, 0);
  assert.ok(r.warnings.some(w => w.message.includes('SIGNAL_MUST_ROUTE_OR_LOG')));
});
t('a wildcard handler routes it', () => {
  const r = checkSrc('on "idea.*" { }\nemit "idea.new"');
  assert.strictEqual(r.warnings.length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
section('semantics — values and operators (both backends)');
t('arithmetic and rendering', () => assert.strictEqual(out('print(7 / 2, 7 % 3, -7 % 3, 0.1 + 0.2, 2 ** 0.5 * 0)'), '3.5 1 2 0.30000000000000004 0\n'));
t('string + anything renders it', () => assert.strictEqual(out('print("n=" + 1 + [1, "a"] + {k: null})'), 'n=1[1, "a"]{k: null}\n'));
t('num + string is an error, loud and located', () => fails('print("ok")\nprint(1 + "a")', 'main.eg:2: + cannot combine num and string'));
t('conditions demand a bool', () => fails('if 1 { print(1) }', 'if needs a bool, got num 1'));
t('and/or short-circuit and demand bools', () => {
  assert.strictEqual(out('print(false and (1 / 0 == 1), true or raise("no"))'), 'false true\n');
  fails('print(1 and true)', 'and needs a bool');
});
t('?? short-circuits', () => assert.strictEqual(out('print(null ?? 3, 1 ?? raise("never"))'), '3 1\n'));
t('division by zero', () => fails('let x = 0\nprint(1 / x)', 'main.eg:2: division by zero'));
t('== is deep', () => assert.strictEqual(out('print([1, {a: [2]}] == [1, {a: [2]}], {a: 1} == {a: 2}, null == null)'), 'true false true\n'));
t('ordering compares like with like only', () => fails('print(1 < "2")', 'compares two nums or two strings'));
t('contains / in / starts_with / ends_with / matches', () => assert.strictEqual(
  out('print([1, 2] contains 2, "b" in {b: 1}, "emerge" starts_with "em", "x.eg" ends_with ".eg", "a1" matches "^[a-z][0-9]$")'),
  'true true true true true\n'));
t('lists: negative index, out of range is an error', () => {
  assert.strictEqual(out('let xs = [1, 2, 3]\nprint(xs[-1], xs[0])'), '3 1\n');
  fails('let xs = [1]\nprint(xs[5])', 'index 5 is out of range for a list of 1');
});
t('maps: missing key is null, member of null is an error', () => {
  assert.strictEqual(out('let m = {a: 1}\nprint(m.b, m["a"])'), 'null 1\n');
  fails('let m = {a: null}\nprint(m.a.b)', 'cannot read .b of null');
});
t('var contents can change; assignment ops', () => assert.strictEqual(
  out('var m = {n: 1, xs: [1]}\nm.n += 4\nm.xs[0] *= 10\nm["k"] = "v"\nvar s = "a"\ns += "b"\nprint(m, s)'),
  '{n: 5, xs: [10], k: "v"} ab\n'));
t('for over a map gives keys in insertion order; over a list, index and item', () =>
  assert.strictEqual(out('for k, v in {z: 1, a: 2} { print(k, v) }\nfor i, x in ["p", "q"] { print(i, x) }'), 'z 1\na 2\n0 p\n1 q\n'));
t('closures capture by reference; loop variables are fresh per iteration', () =>
  assert.strictEqual(out('var fs = []\nfor i in 0..3 { fs = push(fs, fn() = i) }\nprint(map(fs, fn(f) = f()))'), '[0, 1, 2]\n'));
t('recursion', () => assert.strictEqual(out('fn fact(n) { if n <= 1 { return 1 }\n return n * fact(n - 1) }\nprint(fact(10))'), '3628800\n'));
t('type annotations are checked on every bind', () => {
  fails('let x: int = 1.5', '"x" must be int, got num 1.5');
  fails('fn f(a: string) = a\nf(1)', 'parameter a of f must be string, got num 1');
  fails('fn g(): int { return "x" }\ng()', 'return value of g must be int');
  fails('var y: int = 1\ny = "no"', '"y" must be int');
  assert.strictEqual(out('let z: string? = null\nfn h(): int? { }\nprint(z, h())'), 'null null\n');
});
t('calling a non-fn and wrong arity at run time', () => {
  fails('let f = 3\nf()', 'cannot call num');
  fails('let f = fn(a) = a\nf(1, 2)', 'anonymous takes 1 argument(s), got 2');
});
t('builtins: sort_by is stable, desc works; reduce; find; range; json round trip', () => assert.strictEqual(
  out('let xs = [{n: "a", s: 2}, {n: "b", s: 1}, {n: "c", s: 2}]\n' +
      'print(sort_by(xs, fn(x) = x.s, "desc") |> map(fn(x) = x.n))\n' +
      'print(reduce(1..5, fn(a, x) = a + x, 0), find([1, 4, 9], fn(x) = x > 3), range(10, 0, -3))\n' +
      'print(parse_json(json({a: [1, true, null]})))'),
  '["a", "c", "b"]\n10 4 [10, 7, 4, 1]\n{a: [1, true, null]}\n'));
t('using a binding before its declaration ran', () => fails('fn f() = later\nprint(f())\nlet later = 1', '"later" is used before its declaration ran'));
t('runaway recursion is reported, not a crash', () => fails('fn f(n) = f(n + 1)\nf(0)', 'stack overflow'));
t('try/else catches and binds the error; control flow passes through', () => assert.strictEqual(
  out('fn f() {\n  for i in 0..5 {\n    try { if i == 2 { return i } } else e { print(e.message) }\n  }\n  return -1\n}\nprint(f())\n' +
      'try { raise("boom") } else e { print(e.message, e.line) }'),
  '2\nboom 8\n'));

section('semantics — compartments, signals, ledger (both backends)');
const BANK = `compartment Bank {
  id = "co-bank"
  state { bal: 10, note: null }
  constraint solvent hard { state.bal >= 0 }
  constraint modest soft cost 2 { state.bal <= 100 }
  on "dep" (e) { state.bal += e.n
    emit "moved" { by: e.n } }
  fn twice() = state.bal * 2
}
on "moved" (e) { print("moved", e.by) }
on "rejected" (r) { print("rejected", r.constraint) }
`;
t('a transition commits, then its emits are delivered', () => assert.strictEqual(out(BANK + 'emit "dep" { n: 5 }\nprint(Bank.state.bal, Bank.twice())'), 'moved 5\n15 30\n'));
t('a hard violation leaves state unchanged and discards the handler\'s emits', () => {
  const r = both(BANK + 'emit "dep" { n: -50 }\nprint(Bank.state.bal)\nprint(map(filter(ledger(), fn(e) = e.kind == "rejected"), fn(e) = e.body.discarded))');
  assert.strictEqual(r.out, 'rejected solvent\n10\n[["moved"]]\n');
});
t('a soft violation passes at its cost', () => assert.strictEqual(out(BANK + 'emit "dep" { n: 200 }\nprint(Bank.state.bal, spent())'), 'moved 200\n210 2\n'));
t('a constraint needing a null field is a gap; state does not change', () => {
  const src = `compartment K {\n  id = "k"\n  state { a: 1, b: null }\n  constraint pair hard { state.a < state.b }\n  on "bump" { state.a += 1 }\n}\non "gap.opened" (g) { print(g.type, g.message) }\nemit "bump"\nprint(K.state.a)`;
  assert.strictEqual(out(src), 'evidential K.pair cannot be evaluated: state.b is null\n1\n');
});
t('initial state must satisfy hard constraints', () => fails('compartment K {\n  id = "k"\n  state { a: -1 }\n  constraint pos hard { state.a >= 0 }\n}', 'initial state breaks constraint pos'));
t('Name.state is a frozen lens', () => fails(BANK + 'var s = Bank.state\ns.bal = 1', 'read-only'));
t('handlers fan out in declaration order; wildcard handlers match by prefix', () => assert.strictEqual(
  out('compartment A { id = "a"\n on "go" { print("A") } }\ncompartment B { id = "b"\n on "go" { print("B") } }\non "g*" (e) { print("top") }\nemit "go"'),
  'A\nB\ntop\n'));
t('signals are FIFO: a handler\'s emits wait their turn', () => assert.strictEqual(
  out('on "a" { print("a")\n emit "c" }\non "b" { print("b") }\non "c" { print("c") }\nemit "a"\nemit "b"'),
  'a\nc\nb\n'));
t('unrouted signals are recorded and summarised on stderr', () => {
  const r = both('emit "x"\nemit "x"\nemit "y" { n: 1 }\nprint(len(filter(ledger(), fn(e) = e.kind == "unrouted")))');
  assert.strictEqual(r.out, '3\n');
  assert.strictEqual(r.err, '[emerge] 3 unrouted signal(s) logged to the ledger: x ×2, y\n');
});
t('an error inside a handler aborts the drain, is recorded, and can be caught', () => {
  const r = both('on "a" { emit "b"\n emit "c" }\non "b" { raise("bad b") }\non "c" { print("c ran") }\n' +
    'try { emit "a" } else e { print("caught", e.message) }\nprint(map(filter(ledger(), fn(x) = x.kind == "aborted"), fn(x) = x.body.remaining))');
  assert.strictEqual(r.out, 'caught bad b\n[["c"]]\n');
});
t('a signal storm is stopped', () => fails('on "loop" { emit "loop" }\nemit "loop"', 'signal storm'));
t('payloads must be maps of data', () => {
  fails('emit "x" with [1]', 'payload must be a map');
  fails('on "x" { }\nemit "x" { f: fn() = 1 }', 'cannot be recorded');
});
t('compartment fns see a handler\'s working copy', () => assert.strictEqual(
  out('compartment C {\n  id = "c"\n  state { n: 1 }\n  on "x" { state.n = 5\n    print(doubled()) }\n  fn doubled() = state.n * 2\n}\nemit "x"'),
  '10\n'));
t('the ledger is hash-chained and verifiable', () => assert.strictEqual(
  out(BANK + 'emit "dep" { n: 1 }\nrecord "note" { x: 1 }\nlet l = ledger()\nprint(ledger_verify(), l[0].kind, l[-1].kind, l[1].prev == l[0].hash)'),
  'moved 1\ntrue genesis note true\n'));
t('promote: a true proof records and emits promoted; a false proof opens a logical gap', () => assert.strictEqual(
  out('on "promoted" (p) { print("promoted", p.value) }\non "gap.opened" (g) { print(g.type, g.pressure) }\npromote "a" with proof 1 == 1\npromote "b" with proof 1 == 2'),
  'promoted a\nlogical 0.9\n'));
t('a proof must be a bool', () => fails('promote "a" with proof 1', 'a proof must be a bool'));
t('gap is first-class: listed, typed, emitted', () => assert.strictEqual(
  out('on "gap.opened" (g) { print("opened", g.message) }\ngap "need auth" pressure 0.7 type evidential\nprint(gaps()[0].type, len(gaps()))'),
  'opened need auth\nevidential 1\n'));

section('semantics — whatif, axioms, seed, tests, modules (both backends)');
t('whatif runs against a fork and restores everything', () => assert.strictEqual(
  out(BANK + 'let w = whatif {\n  emit "dep" { n: 7 }\n  record "spec" { }\n  Bank.state.bal\n}\nprint(w, Bank.state.bal, len(filter(ledger(), fn(e) = e.kind == "spec")))'),
  'moved 7\n17 10 0\n'));
t('whatif restores the seed position', () => assert.strictEqual(out('let a = whatif { random() }\nprint(a == random())'), 'true\n'));
t('one seed → one run; another seed → another', () => {
  const src = 'print(uid("x"), floor(random() * 1000))';
  const a = both(src, { seed: 7 }), b = both(src, { seed: 7 }), c = both(src, { seed: 8 });
  assert.strictEqual(a.out, b.out);
  assert.deepStrictEqual(a.ledger, b.ledger);
  assert.notStrictEqual(a.out, c.out);
});
t('an axiom is checked at declaration and after each top-level statement', () => {
  const r = fails('var n = 1\naxiom POSITIVE { n > 0 }\nn = 2\nprint("still fine")\nn = -1\nprint("never")', 'main.eg:5: axiom POSITIVE (line 2) violated');
  assert.strictEqual(r.out, 'still fine\n');
});
t('expect halts a run with its message', () => fails('expect 1 == 2, "maths"', 'expectation failed: maths'));
t('eg test: each test in its own fork; failures reported; exit 1', () => {
  const src = 'compartment C { id = "c"\n state { n: 0 }\n on "inc" { state.n += 1 } }\n' +
    'test "one" { emit "inc"\n expect C.state.n == 1 }\ntest "two" { expect C.state.n == 0, "leak" }\ntest "bad" { expect false, "no" }\nprint("top")';
  const r = both(src, { test: true });
  assert.strictEqual(r.out, 'top\n✓ one\n✓ two\n✗ bad — main.eg:7: expectation failed: no\n2 passed, 1 failed\n');
  assert.strictEqual(r.code, 1);
  assert.strictEqual(both(src).out, 'top\n');
});
t('modules: use, exports, errors name the module file', () => {
  const files = { 'lib/m.eg': 'let tag = "m1"\nfn add(a, b) = a + b\nfn bad() = 1 / 0\ncompartment Box { id = "box"\n state { v: 3 } }\n' };
  const r = both('use "./lib/m.eg" as m\nprint(m.tag, m.add(2, 3), m.Box.state.v)\ntry { m.bad() } else e { print(e.file, e.line, e.message) }', { files });
  assert.strictEqual(r.out, 'm1 5 3\nlib/m.eg 3 division by zero\n');
});
t('modules: a missing export is an error', () => fails('use "./x.eg" as x\nprint(x.nope)', 'module x has no export "nope"', { files: { 'x.eg': 'let a = 1\n' } }));
t('modules: circular use is an error', () => fails('use "./a.eg" as a\nprint(1)', 'circular use', { files: { 'a.eg': 'use "./b.eg" as b\n', 'b.eg': 'use "./a.eg" as a\n' } }));
t('args() and --seed reach the program', () => assert.strictEqual(out('print(args())', { args: ['one', 'two'] }), '["one", "two"]\n'));


// ════════════════════════════════════════════════════════════════════════════
section('components — compile time');
const CMP = (name, body, extra = '') => `component ${name} {\n  id = "ns.${name.toLowerCase()}"\n  namespace = "ns"\n  version = "1.0.0"\n${extra}${body}\n}\n`;
const PAIR = CMP('A', '  in go(x: { n: num }) { emit out done { n: x.n } }\n  out done: { n: num }') +
             CMP('B', '  state { total: 0 }\n  in take(x: { n: num }) { state.total += x.n }');
t('a component needs id, namespace and a semver version (EXECUTION_IS_TRACEABLE)', () => {
  compileErr('component C { id = "c"\n version = "1.0.0" }', 'declares no namespace');
  compileErr('component C { id = "c"\n namespace = "n" }', 'declares no version');
  compileErr('component C { id = "c"\n namespace = "n"\n version = "one" }', 'is not semver');
});
t('component and compartment ids share one space', () => compileErr('compartment A { id = "x" }\ncomponent B { id = "x"\n namespace = "n"\n version = "1.0.0" }', 'already used by A'));
t('a boundary is at most 5 invariants', () => compileErr(CMP('C', '  state { n: 0 }\n' + [1, 2, 3, 4, 5, 6].map(i => `  boundary b${i} { state.n >= 0 }`).join('\n')), 'a boundary is 1 to 5'));
t('a component listens through in hooks, not on', () => compileErr(CMP('C', '  on "x" { }'), 'listens through in hooks'));
t('a component speaks through out hooks, not emit', () => compileErr(CMP('C', '  in go { emit "x" }'), 'speaks through its out hooks'));
t('emit out needs a declared out hook', () => compileErr(CMP('C', '  in go { emit out nope { } }'), 'has no out hook "nope"'));
t('emit out only inside a component in hook', () => compileErr('emit out x { }', 'only possible inside a component'));
t('hook names are unique per component', () => compileErr(CMP('C', '  in a { }\n  out a'), 'hook "a" is declared twice'));
t('wire ends must exist and run out → in', () => {
  compileErr(PAIR + 'wire B.take -> A.go', 'B.take is an in hook — a wire runs out → in');
  compileErr(PAIR + 'wire A.nope -> B.take', 'has no out hook "nope"');
  compileErr(PAIR + 'wire Z.x -> B.take', '"Z" is not defined');
  compileErr('compartment K { id = "k" }\n' + PAIR + 'wire K.x -> B.take', 'K is not a component');
  compileErr(PAIR + 'wire "a" -> "b"', 'signal to signal is an on handler');
});
t('a wire is declared once', () => compileErr(PAIR + 'wire A.done -> B.take\nwire A.done -> B.take', 'declared twice'));
t('a wire between incompatible shapes is a seam mismatch', () => {
  compileErr(CMP('A', '  in go { emit out done { n: "x" } }\n  out done: { n: string }') + CMP('B', '  in take(x: { n: num }) { }') + 'wire A.done -> B.take', '"n" is string on the out side but num on the in side');
  compileErr(CMP('A', '  in go { }\n  out done: { m: num }') + CMP('B', '  in take(x: { n: num }) { }') + 'wire A.done -> B.take', 'the in hook needs "n"');
  compileErr(CMP('A', '  in go { }\n  out done: { n: num?, m: num }') + CMP('B', '  in take(x: { n: num }) { }') + 'wire A.done -> B.take', 'num? on the out side but num');
});
t('num flows into num; any accepts anything', () => compileOk(CMP('A', '  in go { }\n  out done: { n: num, k: string }') + CMP('B', '  in take(x: { n: num, k: any }) { }') + 'wire A.done -> B.take\nsend A.go { }'));
t('send needs a component in hook', () => {
  compileErr(PAIR + 'send A.done { n: 1 }', 'A.done is an out hook — send feeds in hooks');
  compileErr(PAIR + 'send A.nope { n: 1 }', 'has no in hook "nope"');
  compileErr(PAIR + 'send "x" { }', 'send goes to Component.hook');
});
t('unwired out hooks and unfed in hooks are warned about', () => {
  const r = checkSrc(PAIR);
  assert.ok(r.warnings.some(w => w.message.includes('out hook A.done has no wire')));
  assert.ok(r.warnings.some(w => w.message.includes('in hook B.take is never fed')));
  assert.strictEqual(checkSrc(PAIR + 'wire A.done -> B.take\nsend A.go { n: 1 }').warnings.length, 0);
});

section('components — run time (both backends)');
t('send → in hook → emit out → wire → in hook, transactionally', () => assert.strictEqual(
  out(PAIR + 'wire A.done -> B.take\nsend A.go { n: 4 }\nsend A.go { n: 6 }\nprint(B.state.total)'), '10\n'));
t('signal → hook and hook → signal wires', () => assert.strictEqual(
  out(CMP('D', '  in x(p: { v: num }) { emit out y { v: p.v * 2 } }\n  out y: { v: num }') + 'wire "in" -> D.x\nwire D.y -> "out"\non "out" (p) { print(p.v) }\nemit "in" { v: 21 }'), '42\n'));
t('an out hook with no wire is logged as unrouted', () => {
  const r = both(CMP('A', '  in go { emit out done { } }\n  out done') + 'send A.go');
  assert.strictEqual(r.err, '[emerge] 1 unrouted signal(s) logged to the ledger: A.done\n');
});
t('shapes are enforced at both ends: missing, extra, wrong type', () => {
  fails(PAIR + 'wire A.done -> B.take\nsend A.go { }', 'in hook A.go field n must be num, got null');
  fails(PAIR + 'wire A.done -> B.take\nsend A.go { n: 1, extra: 2 }', 'in hook A.go has no field "extra"');
  fails(CMP('A', '  in go { emit out done { n: 1i } }\n  out done: { n: num }') + 'send A.go', 'out hook A.done field n must be num, got int 1');
  fails(CMP('A', '  in go(x: { n: num }) { }') + 'wire "s" -> A.go\nemit "s" { n: "x" }', 'in hook A.go field n must be num');
});
t('a boundary refuses like a hard constraint, and says it was the boundary', () => assert.strictEqual(
  out(CMP('C', '  state { n: 0 }\n  boundary small { state.n < 3 }\n  in add(p: { k: num }) { state.n += p.k }') +
      'on "rejected" (r) { print("refused", r.constraint, r.boundary) }\nsend C.add { k: 2 }\nsend C.add { k: 2 }\nprint(C.state.n)'),
  'refused small true\n2\n'));
t('a rejected in hook discards its out emits', () => {
  const src = CMP('A', '  state { n: 0 }\n  boundary pos { state.n >= 0 }\n  in go(x: { n: num }) { state.n = x.n\n    emit out done { n: x.n } }\n  out done: { n: num }') +
    CMP('B', '  state { total: 0 }\n  in take(x: { n: num }) { state.total += x.n }') +
    'on "rejected" (r) { }\nwire A.done -> B.take\nsend A.go { n: -1 }\nprint(B.state.total, map(filter(ledger(), fn(e) = e.kind == "rejected"), fn(e) = e.body.discarded))';
  assert.strictEqual(out(src), '0 [["A.done"]]\n');
});
t('Comp.namespace / version / uuid / hooks', () => assert.strictEqual(
  out(PAIR + 'wire A.done -> B.take\nsend A.go { n: 1 }\nprint(A.namespace, A.version, A.hooks, A.uuid starts_with "emerge-component-")'),
  'ns 1.0.0 {in: ["go"], out: ["done"]} true\n'));
t('a declared uuid is kept; a derived one is stable', () => {
  const r1 = out(CMP('A', '  in go { }', '  uuid = "fixed-uuid-1"\n') + 'send A.go\nprint(A.uuid)');
  assert.strictEqual(r1, 'fixed-uuid-1\n');
  const a = out(CMP('A', '  in go { }') + 'send A.go\nprint(A.uuid)'), b = out(CMP('A', '  in go { }') + 'send A.go\nprint(A.uuid)');
  assert.strictEqual(a, b);
});
t('a whatif can run a component pipeline and leave it untouched', () => assert.strictEqual(
  out(PAIR + 'wire A.done -> B.take\nlet w = whatif {\n  send A.go { n: 9 }\n  B.state.total\n}\nprint(w, B.state.total, len(components().wires))'),
  '9 0 1\n'));
t('wiring at run time is checked too: a wire before its component ran', () => fails('wire "s" -> A.go\n' + CMP('A', '  in go { }'), 'A is used before its declaration ran'));

section('components — loom export');
t('components() and eg components agree, and both validate against emerge/schemas', () => {
  const { graphOfProgram, validateRecords } = require('../components');
  const src = PAIR + 'wire A.done -> B.take\nwire "kick" -> A.go\nsend A.go { n: 1 }\nprint(json(components()))';
  const runtimeGraph = JSON.parse(out(src).trim());
  const staticGraph = graphOfProgram(checkSrc(src).program);
  const loom = g => ({ components: g.components, hooks: g.hooks, wires: g.wires });
  assert.deepStrictEqual(runtimeGraph, JSON.parse(JSON.stringify(loom(staticGraph))));
  assert.deepStrictEqual(validateRecords(staticGraph), []);
  assert.deepStrictEqual(staticGraph.components.map(c => c.id), ['ns.a', 'ns.b']);
  assert.deepStrictEqual(staticGraph.hooks.map(h => `${h.id}/${h.direction}`), ['ns.a.go/in', 'ns.a.done/out', 'ns.b.take/in']);
  assert.deepStrictEqual(staticGraph.wires.map(w => w.id), ['ns.a.done->ns.b.take', 'signal:kick->ns.a.go']);
  assert.deepStrictEqual(staticGraph.hooks[1].shape, { n: 'num' });
});
t('validation reads the schema files: a record missing a required field is caught', () => {
  const { validateRecords } = require('../components');
  const bad = { components: [{ id: 'x', namespace: 'n', name: 'X', version: '1.0.0' }], hooks: [], wires: [{ id: 'w', from_hook_id: 'nope', to_hook_id: 'signal:s', uuid: 'u' }] };
  const p = validateRecords(bad);
  assert.ok(p.some(m => m.includes('required field "uuid"')), p.join('\n'));
  assert.ok(p.some(m => m.includes('nope is not a hook')), p.join('\n'));
});


// ════════════════════════════════════════════════════════════════════════════
section('kinds — compile time');
const KIND = 'kind Stage {\n  require version\n  in take(x: { v: num })\n  out give: { v: num }\n  state { count: num }\n  boundary_count 1..2\n  fn seen()\n}\n';
const TPL = (head, body) => `template ${head} {\n  namespace = "p"\n  version = "1.0.0"\n${body}\n}\n`;
const GOOD = '  state { count: 0 }\n  boundary b { state.count >= 0 }\n  in take(x: { v: num }) { state.count += 1\n    emit out give { v: x.v } }\n  out give: { v: num }\n  fn seen() = state.count';
t('a template that conforms checks clean', () => compileOk(KIND + TPL('S() is Stage', GOOD) + 'let s = spawn S("a")\nwire "i" -> s.take\nwire s.give -> "o"'));
t('unknown kinds and parents, and cycles', () => {
  compileErr(TPL('S() is Nope', GOOD), 'Nope is not a kind');
  compileErr('kind A is Z { }', 'which is not a kind');
  compileErr('kind A is B { }\nkind B is A { }\n' + TPL('S() is A', GOOD), 'inherits from itself');
});
t('a kind cannot name a hook twice or as both in and out', () => {
  compileErr('kind K { in a\n in a }\n' + TPL('S() is K', '  in a { }'), 'declares "a" twice');
});
const conf = (body, frag, kind = KIND) => compileErr(kind + TPL('S() is Stage', body), frag);
t('conformance: hooks must exist and face the right way', () => {
  conf(GOOD.replace('in take', 'in grab'), 'missing in hook "take"');
  conf('  state { count: 0 }\n  boundary b { state.count >= 0 }\n  in give { }\n  out take: { v: num }\n  fn seen() = 1', 'must be an in hook, not out');
});
t('conformance: shapes must fit the kind', () => {
  conf(GOOD.replace('in take(x: { v: num })', 'in take(x: { v: string })'), 'in hook "take" does not accept the kind\'s shape');
  conf(GOOD.replace('out give: { v: num }', 'out give'), 'out hook "give" must declare a shape');
  conf(GOOD.replace('out give: { v: num }', 'out give: { w: num }').replace('emit out give { v: x.v }', 'emit out give { w: x.v }'), 'out hook "give" does not fit');
});
t('conformance: state, boundary count, fns, required identity', () => {
  conf(GOOD.replace('state { count: 0 }', 'state { n: 0 }').replace(/state\.count/g, 'state.n'), 'missing state field "count" (num)');
  conf(GOOD.replace('  boundary b { state.count >= 0 }\n', ''), 'needs 1 to 2 boundary invariant(s), has 0');
  conf(GOOD.replace('fn seen() = state.count', 'fn seen(x) = x'), 'fn seen takes 1 argument(s), the kind says 0');
  compileErr('kind K { require intent }\n' + TPL('S() is K', '  in a { }'), 'it requires intent');
  compileErr('kind K { require uuid }\n' + TPL('S() is K', '  in a { }'), 'a template cannot declare one');
});
t('a kind inherits its parents\' requirements', () => {
  const k = KIND + 'kind Filter is Stage { fn passed() }\n';
  compileErr(k + TPL('S() is Filter', GOOD), 'missing fn passed');
  compileOk(k + TPL('S() is Filter', GOOD + '\n  fn passed() = 0') + 'let s = spawn S("a")\nprint(is_kind(s, "Stage"))');
});
t('kinds and templates are not values', () => {
  compileErr(KIND + 'print(Stage)', 'Stage is a kind, not a value');
  compileErr(TPL('S()', '  in a { }') + 'print(S)', 'S is a template — make an instance');
});

section('templates — compile time');
t('a template has no id or uuid of its own', () => {
  compileErr('template S() {\n  id = "x"\n}', 'given per instance');
  compileErr('template S() {\n  uuid = "x"\n}', 'given per instance');
});
t('a template needs namespace and version', () => compileErr('template S() { in a { } }', 'declares no namespace'));
t('spawn: a known template, an id plus its parameters', () => {
  compileErr('let x = spawn Nope("a")', '"Nope" is not defined');
  compileErr(TPL('S(a, b)', '  in a1 { }') + 'let x = spawn S("i", 1)', 'takes an id and 2 argument(s) — got 2 in all');
  compileErr('compartment K { id = "k" }\nlet x = spawn K("a")', 'K is not a template');
});
t('spawn, despawn and wire change the world: never inside a handler', () => {
  const T = TPL('S()', '  in a { }');
  compileErr(T + 'on "x" { let s = spawn S("a") }', 'spawn changes the world');
  compileErr(T + 'on "x" (e) { despawn e }', 'despawn changes the world');
  compileErr(T + 'compartment K { id = "k"\n state { n: 0 }\n on "x" { wire "a" -> "b" } }', 'wire changes the world');
});
t('let x = spawn T(…) lets wires be checked against T at compile time', () => {
  const T = TPL('A()', '  in go { }\n  out done: { n: num }') + TPL('B()', '  in take(x: { n: string }) { }');
  compileErr(T + 'let a = spawn A("a")\nwire a.nope -> "x"', 'template A has no out hook "nope"');
  compileErr(T + 'let a = spawn A("a")\nlet b = spawn B("b")\nwire a.done -> b.take', 'seam mismatch');
  compileOk(T + 'var a = spawn A("a")\nwire a.nope -> "x"');   // a var may change: checked at run time instead
});

section('kinds and templates — run time (both backends)');
const PIPE = KIND + TPL('Scale(f: num) is Stage', GOOD.replace('emit out give { v: x.v }', 'emit out give { v: x.v * f }'));
t('each spawn is its own instance, with its own state; parameters reach the hooks', () => assert.strictEqual(
  out(PIPE + 'let a = spawn Scale("a", 2)\nlet b = spawn Scale("b", 10)\nwire a.give -> b.take\nwire b.give -> "o"\non "o" (r) { print(r.v) }\n' +
      'send a.take { v: 3 }\nsend b.take { v: 1 }\nprint(a.state.count, b.state.count, a.name, b.id, a.template, a.kinds)'),
  '60\n10\n1 2 Scale(a) b Scale ["Stage"]\n'));
t('instance ids are unique; the id must be a string', () => {
  fails(PIPE + 'let a = spawn Scale("a", 1)\nlet b = spawn Scale("a", 1)', 'id "a" is already used by Scale(a)');
  fails(PIPE + 'let a = spawn Scale(1, 1)', 'the first argument is the instance id');
});
t('parameter annotations are checked at spawn', () => fails(PIPE + 'let a = spawn Scale("a", "x")', 'parameter f of Scale must be num'));
t('a kind\'s typed state is enforced at spawn and before every commit', () => {
  fails(KIND + TPL('S() is Stage', GOOD.replace('state { count: 0 }', 'state { count: "zero" }').replace('boundary b { state.count >= 0 }', 'boundary b { state.count != "" }').replace('state.count += 1', 'state.count = state.count')) + 'let s = spawn S("a")',
    'S(a) breaks kind Stage: state.count must be num, got string "zero"');
  fails(KIND + TPL('S() is Stage', GOOD.replace('boundary b { state.count >= 0 }', 'boundary b { state.count != "" }').replace('state.count += 1', 'state.count = 1i')) + 'let s = spawn S("a")\nsend s.take { v: 1 }',
    'S(a) breaks kind Stage: state.count must be num, got int 1');
});
t('a boundary over parameters refuses a bad instance at spawn', () =>
  fails(TPL('R(lo: num, hi: num)', '  boundary ordered { lo <= hi }\n  in a { }') + 'let r = spawn R("r", 5, 1)', 'R(r): initial state breaks boundary ordered'));
t('despawn drops the instance and its wires; its handle is dead', () => {
  const r = both(PIPE + 'let a = spawn Scale("a", 2)\nlet b = spawn Scale("b", 2)\nwire a.give -> b.take\nwire "i" -> a.take\ndespawn a\n' +
    'print(len(components().wires), instances("Scale") |> map(fn(x) = x.id), map(filter(ledger(), fn(e) = e.kind == "unwire"), fn(e) = e.body.from))\n' +
    'try { send a.take { v: 1 } } else e { print(e.message) }');
  assert.strictEqual(r.out, '0 ["b"] ["Scale(a).give", "\\"i\\""]\nScale(a) no longer exists — it was despawned, or spawned inside a whatif\n');
});
t('only spawned instances can be despawned', () => fails(CMP('C', '  in go { }') + 'send C.go\ndespawn C', 'was declared, not spawned'));
t('is_kind follows inheritance; instances lists live instances in spawn order', () => assert.strictEqual(
  out(KIND + 'kind Filter is Stage { fn passed() }\n' + TPL('F() is Filter', GOOD + '\n  fn passed() = 0') + TPL('S() is Stage', GOOD) +
      'let f = spawn F("f")\nlet s1 = spawn S("s1")\nlet s2 = spawn S("s2")\n' +
      'print(is_kind(f, "Stage"), is_kind(f, "Filter"), is_kind(s1, "Filter"), is_kind(3, "Stage"), map(instances("S"), fn(x) = x.id))'),
  'true true false false ["s1", "s2"]\n'));
t('wires and sends can name any expression that gives an instance', () => assert.strictEqual(
  out(PIPE + 'let xs = [spawn Scale("a", 2), spawn Scale("b", 3)]\nwire xs[0].give -> xs[1].take\nwire xs[1].give -> "o"\non "o" (r) { print(r.v) }\nsend xs[0].take { v: 1 }'),
  '6\n'));
t('a wire end that is not a component is a run-time error', () => fails(PIPE + 'let n = 3\nvar x = n\nwire x.give -> "o"', 'wire needs a component, got num 3'));
t('whatif restores spawns, despawns and wires', () => assert.strictEqual(
  out(PIPE + 'let a = spawn Scale("a", 1)\nwire "i" -> a.take\n' +
      'let w = whatif {\n  despawn a\n  let b = spawn Scale("b", 1)\n  wire "i" -> b.take\n  map(instances("Scale"), fn(x) = x.id)\n}\n' +
      'print(w, map(instances("Scale"), fn(x) = x.id), len(components().wires), a.state.count)'),
  '["b"] ["a"] 1 0\n'));
t('components() carries template and kinds; eg components exports kinds and templates', () => {
  const { graphOfProgram, validateRecords } = require('../components');
  const src = PIPE + 'let a = spawn Scale("a", 2)\nwire "i" -> a.take\nwire a.give -> "o"\non "o" { }\nprint(json(components().components[0]))';
  const rec = JSON.parse(out(src).trim());
  assert.strictEqual(rec.template, 'Scale');
  assert.deepStrictEqual(rec.kinds, ['Stage']);
  assert.strictEqual(rec.id, 'a');
  const g = graphOfProgram(checkSrc(src).program);
  assert.deepStrictEqual(g.components, []);
  assert.deepStrictEqual(g.kinds.map(k => [k.name, k.state, k.boundary_count]), [['Stage', { count: 'num' }, [1, 2]]]);
  assert.deepStrictEqual(g.templates.map(t => [t.name, t.params, t.kinds]), [['Scale', ['f'], ['Stage']]]);
  assert.deepStrictEqual(validateRecords(g), []);
});

// ── 64-bit int (CIE-EG §3) ──
t('42i is an int; ints add, subtract, multiply exactly to 2^63-1', () => assert.strictEqual(out('print(9223372036854775806i + 1i, 3037000499i * 3037000499i, 5i - 9i)'), '9223372036854775807 9223372030926249001 -4\n'));
t('int overflow is an error, never a wrap', () => {
  fails('print(9223372036854775807i + 1i)', 'int overflow in +');
  fails('print(-9223372036854775807i - 2i)', 'int overflow in -');
  fails('print(4294967296i * 4294967296i)', 'int overflow in *');
  fails('print(2i ** 63i)', 'int overflow in **');
  fails('print(-(-9223372036854775807i - 1i))', 'int overflow in unary -');
  fails('print(idiv(-9223372036854775807i - 1i, -1i))', 'int overflow in idiv');
  fails('print(int(\"9223372036854775808\"))', 'int overflow in int()');
});
t('an int literal above 2^63-1 is a lexer error', () => compileErr('print(9223372036854775808i)', 'larger than 2^63-1'));
t('wrap_add / wrap_sub / wrap_mul wrap on purpose', () => assert.strictEqual(out('print(wrap_add(9223372036854775807i, 1i), wrap_sub(-9223372036854775807i - 1i, 1i), wrap_mul(4294967296i, 4294967296i))'), '-9223372036854775808 9223372036854775807 0\n'));
t('int and num never mix, in arithmetic or comparison', () => {
  fails('print(1i + 1)', 'does not mix int and num');
  fails('print(1 * 2i)', 'does not mix int and num');
  fails('print(1i < 2)', 'does not mix int and num');
  fails('print(1i & 1)', 'does not mix int and num');
  fails('print(\"a\" * 2i)', '*');
});
t('int equality is by value and never equal to a num', () => assert.strictEqual(out('print(5i == 5i, 5i == 5, [1i, 2i] == [1i, 2i], {k: 3i} == {k: 3i})'), 'true false true true\n'));
t('int / int is refused; idiv floors; % is floored', () => {
  fails('print(7i / 2i)', 'use idiv');
  assert.strictEqual(out('print(idiv(7i, 2i), idiv(-7i, 2i), 7i % 3i, -7i % 3i)'), '3 -4 1 2\n');
  fails('print(1i % 0i)', 'modulo by zero');
});
t('bit operations on ints use all 64 bits', () => assert.strictEqual(out('print(0xFFi & 0x0Fi, 0xF0i | 0x0Fi, 0xFFi ^ 0x0Fi, ~0i, 1i << 62i, 1i << 63i, -8i >> 1i, shr_u(-1i, 60i))'), '15 255 240 -1 4611686018427387904 -9223372036854775808 -4 15\n'));
t('rotl / rotr on ints rotate 64 bits; on nums they stay 32-bit', () => assert.strictEqual(out('print(rotl(1i, 63i), rotr(1i, 1i), rotl(0x80000000i, 1i), rotl(0x80000000, 1))'), '-9223372036854775808 -9223372036854775808 4294967296 1\n'));
t('int(x) and num(x) convert explicitly', () => {
  assert.strictEqual(out('print(int(3.9), int(-3.9), int(\" 42 \"), num(7i), str(7i))'), '3 -3 42 7 7\n');
  fails('print(int(\"1.5\"))', 'int cannot read');
  fails('print(num(9007199254740993i))', 'not exactly representable');
});
t('the int type annotation is exact', () => {
  fails('let x: int = 1', '"x" must be int, got num 1');
  fails('let y: num = 1i', '"y" must be num, got int 1');
  assert.strictEqual(out('fn f(a: int): int = a + 1i\nprint(f(41i))'), '42\n');
});
t('ints are data: json and the ledger record them exactly', () => assert.strictEqual(out('print(json({n: 9223372036854775807i}))'), '{"n":9223372036854775807}\n'));
t('ranges, min, max, abs work on ints', () => assert.strictEqual(out('print(0i..3i, min(3i, 1i), max([3i, 9i, 2i]), abs(-4i))'), '[0, 1, 2] 1 9 4\n'));
t('u64be / i64le / read_u64be take and return ints', () => assert.strictEqual(out('print(hex(u64be(258i)), hex(u64le(258)), hex(i64le(-2i)), read_u64be(u64be(1234567890123i), 0))'), '0000000000000102 0201000000000000 feffffffffffffff 1234567890123\n'));
t('int in a component hook does not flow into a num hook', () => compileErr(CMP('A', '  in go { }\n  out done: { n: int }') + CMP('B', '  in take(x: { n: num }) { }') + 'wire A.done -> B.take', '"n" is int on the out side but num on the in side'));

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
