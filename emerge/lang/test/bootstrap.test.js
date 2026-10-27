'use strict';
// emerge/lang/test/bootstrap.test.js — change the language's primitives in Emerge, rebuild, and see the language change.
// Works on a copy of emerge/ in a temp folder, so the real build is never touched. Everything goes through the eg CLI.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const EMERGE = path.join(__dirname, '..', '..');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'emerge-bootstrap-test-'));
const COPY = path.join(ROOT, 'emerge');

// the language and what it reads: lang/ (without build/next|previous), core/constraint.js, schemas/, package.json
fs.mkdirSync(path.join(COPY, 'core'), { recursive: true });
fs.copyFileSync(path.join(EMERGE, 'package.json'), path.join(COPY, 'package.json'));
fs.copyFileSync(path.join(EMERGE, 'core', 'constraint.js'), path.join(COPY, 'core', 'constraint.js'));
fs.cpSync(path.join(EMERGE, 'schemas'), path.join(COPY, 'schemas'), { recursive: true });
fs.cpSync(path.join(EMERGE, 'lang'), path.join(COPY, 'lang'), {
  recursive: true,
  filter: (src) => !/[\\/]build[\\/](next|previous)([\\/]|$)/.test(src),
});

const LANG = path.join(COPY, 'lang');
const EG = path.join(LANG, 'eg.js');
const env = { ...process.env };
delete env.EMERGE_BUILD;
const eg = (...args) => spawnSync(process.execPath, [EG, ...args], { cwd: ROOT, encoding: 'utf8', env });
const core = (f) => path.join(LANG, 'core', f);
const edit = (f, from, to) => {
  const s = fs.readFileSync(core(f), 'utf8');
  if (!s.includes(from)) throw new Error(`test setup: ${f} has no ${JSON.stringify(from)}`);
  fs.writeFileSync(core(f), s.replace(from, to));
};
const program = (name, src) => { const p = path.join(ROOT, name); fs.writeFileSync(p, src); return p; };
/** run a program both ways (eg run, and eg build + node) and demand they agree */
function both(file) {
  const a = eg('run', file);
  const out = path.join(ROOT, 'out-' + path.basename(file, '.eg'));
  const b = eg('build', file, '-o', out);
  if (b.status !== 0) return { ...a, buildErr: b.stderr };
  const c = spawnSync(process.execPath, [path.join(out, path.basename(file).replace(/\.eg$/, '.js'))], { cwd: ROOT, encoding: 'utf8', env });
  assert.strictEqual(c.stdout, a.stdout, 'interpreter and compiled disagree on stdout');
  assert.strictEqual(c.stderr, a.stderr.replace(/^\[emerge\] core\/.*\n/m, ''), 'interpreter and compiled disagree on stderr');
  assert.strictEqual(c.status, a.status);
  return a;
}
const buildNo = () => JSON.parse(fs.readFileSync(path.join(LANG, 'build', 'current', 'BUILD.json'), 'utf8')).build;

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed++; process.stdout.write(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}\n`); }
}
process.stdout.write('\nbootstrap: change the primitives in Emerge, rebuild, use the changed language\n');

const startBuild = buildNo();
const P1 = program('truthy.eg', 'if 1 { print("one is true") } else { print("one is false") }\n');

t('the shipped build is current', () => {
  const r = eg('bootstrap', '--status');
  assert.strictEqual(r.status, 0, r.stdout);
  assert.ok(r.stdout.includes('is current'));
  const a = both(P1);
  assert.strictEqual(a.status, 1);
  assert.ok(a.stderr.includes('if needs a bool, got num 1'), a.stderr);
});

t('editing a core source makes the build stale — eg says so, and nothing changes until you bootstrap', () => {
  edit('primitives.eg', 'let truth = { strict: true }', 'let truth = { strict: false }');
  const r = eg('bootstrap', '--status');
  assert.strictEqual(r.status, 1);
  assert.ok(r.stdout.includes('core/primitives.eg'), r.stdout);
  const a = eg('run', P1);
  assert.ok(a.stderr.startsWith('[emerge] core/primitives.eg changed since build'), a.stderr);
  assert.strictEqual(a.status, 1, 'the old rules still hold');
});

t('eg bootstrap: one rebuild changes truth, a constraint type, a signal name, a diagnostic and the library', () => {
  edit('primitives.eg', '  relational:    { permits_violation: false, default_cost: 1 }',
    '  relational:    { permits_violation: false, default_cost: 1 },\n  advisory:      { permits_violation: true,  default_cost: 0 }');
  edit('primitives.eg', 'rejected: "rejected"', 'rejected: "refused"');
  edit('primitives.eg', 'NO_SILENT_DROP: "error"', 'NO_SILENT_DROP: "off"');
  edit('selftest.eg', 'on "rejected" (r)', 'on "refused" (r)');   // the selftest pins the signal name: it moves with it
  fs.appendFileSync(core('prelude.eg'), '\n// added by the bootstrap test\nfn double_all(xs) = map(xs, fn(x) = x * 2)\nfn upper(s) = "<" + s + ">"\n');
  const r = eg('bootstrap');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(buildNo(), startBuild + 1);
  const m = JSON.parse(fs.readFileSync(path.join(LANG, 'build', 'current', 'BUILD.json'), 'utf8'));
  assert.deepStrictEqual(m.replaces_natives, ['upper']);
  assert.ok(m.prelude_builtins.includes('double_all'));
  assert.strictEqual(eg('bootstrap', '--status').status, 0);
});

t('…and programs now run under the new rules, identically in both backends', () => {
  assert.strictEqual(both(P1).stdout, 'one is true\n');
  const p = program('new-rules.eg', [
    'compartment C {', '  id = "c"', '  state { n: 0 }',
    '  constraint gentle advisory { state.n < 5 }',
    '  constraint floor hard { state.n >= 0 }',
    '  on "add" (e) { state.n += e.k }', '}',
    'on "refused" (r) { print("refused by", r.constraint) }',
    'emit "add" { k: 9 }', 'emit "add" { k: -20 }',
    'print(C.state.n, spent())',
    'try { raise("x") } else { }',
    'print(double_all([1, 2]), upper("hi"))',
    'if [] { print("empty is true") } else { print("empty is false") }',
  ].join('\n') + '\n');
  const a = both(p);
  assert.strictEqual(a.status, 0, a.stderr + (a.buildErr || ''));
  assert.strictEqual(a.stdout, 'refused by floor\n9 0\n[2, 4] <hi>\nempty is false\n');
});

t('a broken primitive never reaches the current build', () => {
  const before = buildNo();
  edit('primitives.eg', 'let truth = { strict: false }', 'let truth = { strict: "sometimes" }');
  const r = eg('bootstrap');
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('PROVE primitives schema') && r.stderr.includes('truth.strict must be a bool'), r.stderr);
  assert.strictEqual(buildNo(), before);
  assert.strictEqual(both(P1).stdout, 'one is true\n', 'the current build still runs');
  edit('primitives.eg', 'let truth = { strict: "sometimes" }', 'let truth = { strict: false }');
});

t('the primitives file is data only: no fns, no reading primitives while it is evaluated', () => {
  fs.appendFileSync(core('primitives.eg'), '\nfn helper() = 1\n');
  let r = eg('bootstrap');
  assert.ok(r.stderr.includes('only let declarations of data belong here'), r.stderr);
  edit('primitives.eg', '\nfn helper() = 1\n', '\nlet sneaky = whatif { 1 }\n');
  r = eg('bootstrap');
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('seed mode') || r.stderr.includes('unknown section "sneaky"'), r.stderr);
  edit('primitives.eg', '\nlet sneaky = whatif { 1 }\n', '\n');
});

t('a prelude that does not compile is quarantined', () => {
  const before = buildNo();
  fs.appendFileSync(core('prelude.eg'), '\nfn broken( = 1\n');
  const r = eg('bootstrap');
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('QUARANTINE prelude.eg'), r.stderr);
  assert.strictEqual(buildNo(), before);
  edit('prelude.eg', '\nfn broken( = 1\n', '\n');
});

t('a prelude change that breaks the selftest is refused — the selftest is the gate', () => {
  const before = buildNo();
  edit('prelude.eg', 'for x in xs { out = push(out, f(x)) }', 'for x in xs { out = push(out, x) }');   // map forgets to apply f
  const r = eg('bootstrap');
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('PROVE selftest'), r.stderr);
  assert.strictEqual(buildNo(), before);
  edit('prelude.eg', 'for x in xs { out = push(out, x) }', 'for x in xs { out = push(out, f(x)) }');
});

t('a standalone build carries its language build with it', () => {
  const out = path.join(ROOT, 'standalone');
  const r = eg('build', P1, '-o', out, '--standalone');
  assert.strictEqual(r.status, 0, r.stderr);
  const moved = path.join(os.tmpdir(), 'emerge-standalone-' + process.pid);
  fs.rmSync(moved, { recursive: true, force: true });
  fs.cpSync(out, moved, { recursive: true });
  const c = spawnSync(process.execPath, [path.join(moved, 'truthy.js')], { cwd: os.tmpdir(), encoding: 'utf8', env });
  assert.strictEqual(c.stdout, 'one is true\n', c.stderr);
  fs.rmSync(moved, { recursive: true, force: true });
});

t('unrouted: "error" makes an unclaimed signal stop the program, in both backends', () => {
  edit('primitives.eg', 'unrouted: "log"', 'unrouted: "error"');
  const r = eg('bootstrap');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const a = both(program('lonely.eg', 'print("before")\nemit "nobody"\nprint("after")\n'));
  assert.strictEqual(a.status, 1);
  assert.strictEqual(a.stdout, 'before\n');
  assert.ok(a.stderr.includes('unrouted signal "nobody"'), a.stderr);
});

t('eg bootstrap --rollback swaps back to the previous build', () => {
  const now = buildNo();
  const r = eg('bootstrap', '--rollback');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(buildNo(), now - 1);
  const a = both(program('lonely2.eg', 'emit "nobody"\nprint("after")\n'));
  assert.strictEqual(a.stdout, 'after\n', 'the previous build logs unrouted signals instead');
  assert.strictEqual(eg('bootstrap', '--status').status, 1, 'and the sources are now ahead of it');
});

fs.rmSync(ROOT, { recursive: true, force: true });
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
