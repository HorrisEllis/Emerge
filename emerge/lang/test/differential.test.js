'use strict';
// emerge/lang/test/differential.test.js — every example, through the real CLI, both ways:
//   eg run x.eg --ledger a.json        vs        eg build x.eg -o out && node out/x.js --ledger b.json
// stdout, stderr, exit code and the full ledger must be byte-identical. Also checks the standalone build runs with
// nothing else on disk beside it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LANG = path.join(__dirname, '..');
const EG = path.join(LANG, 'eg.js');
const EX = path.join(LANG, 'examples');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'emerge-diff-'));

// programs (relative to examples/), the mode, and the exit code each must give
const CASES = [
  ['hello.eg', 'run', 0],
  ['counter.eg', 'run', 0],
  ['idearium.eg', 'run', 0],
  ['whatif.eg', 'run', 0],
  ['components.eg', 'run', 0],
  ['primitives.eg', 'run', 0],
  ['axioms.eg', 'run', 1],
  ['modules/main.eg', 'run', 0],
  ['tests.eg', 'test', 1],
  ['tests.eg', 'run', 0],
  ['fail/runtime-error.eg', 'run', 1],
  ['fail/unrouted.eg', 'run', 0],
];

const node = (args, cwd) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed++; process.stdout.write(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}\n`); }
}

process.stdout.write('\ndifferential: interpreter vs compiled, every example\n');
for (const [rel, mode, wantExit] of CASES) {
  t(`${rel} (${mode})`, () => {
    const src = path.join(EX, rel);
    const out = path.join(TMP, rel.replace(/[/.]/g, '_') + '_' + mode);
    const b = node([EG, 'build', src, '-o', out]);
    if (b.status !== 0) throw new Error(`build failed:\n${b.stderr}`);
    const la = path.join(out, 'interp.ledger.json'), lb = path.join(out, 'compiled.ledger.json');
    const flags = mode === 'test' ? ['--test'] : [];
    const a = node([EG, mode, src, '--seed', '42', '--ledger', la]);
    const c = node([path.join(out, path.basename(rel).replace(/\.eg$/, '.js')), ...flags, '--seed', '42', '--ledger', lb]);
    const diffs = [];
    if (a.stdout !== c.stdout) diffs.push(`stdout:\n--- interpreter\n${a.stdout}--- compiled\n${c.stdout}`);
    if (a.stderr !== c.stderr) diffs.push(`stderr:\n--- interpreter\n${a.stderr}--- compiled\n${c.stderr}`);
    if (a.status !== c.status) diffs.push(`exit: ${a.status} vs ${c.status}`);
    if (fs.readFileSync(la, 'utf8') !== fs.readFileSync(lb, 'utf8')) diffs.push('ledgers differ');
    if (diffs.length) throw new Error(diffs.join('\n'));
    if (a.status !== wantExit) throw new Error(`exit ${a.status}, expected ${wantExit}\n${a.stderr}`);
    if (!a.stdout.length) throw new Error('no output at all');
  });
}

t('a standalone build runs from an unrelated folder', () => {
  const out = path.join(TMP, 'standalone');
  const b = node([EG, 'build', path.join(EX, 'modules', 'main.eg'), '-o', out, '--standalone']);
  if (b.status !== 0) throw new Error(b.stderr);
  const moved = path.join(TMP, 'moved');
  fs.cpSync(out, moved, { recursive: true });
  const r = node([path.join(moved, 'main.js')], os.tmpdir());
  const i = node([EG, 'run', path.join(EX, 'modules', 'main.eg')]);
  if (r.status !== 0 || r.stdout !== i.stdout) throw new Error(`standalone: exit ${r.status}\n${r.stdout}${r.stderr}`);
});

t('eg check reports errors with file:line:col and exits 1', () => {
  const bad = path.join(TMP, 'bad.eg');
  fs.writeFileSync(bad, 'let x = 1\nx = 2\n');
  const r = node([EG, 'check', bad]);
  if (r.status !== 1 || !r.stderr.includes('bad.eg:2:1: error: "x" is a let — only a var can be assigned')) throw new Error(r.stderr);
});

t('a program with a compile error never runs', () => {
  const bad = path.join(TMP, 'bad2.eg');
  fs.writeFileSync(bad, 'print("ran")\nprint(nope)\n');
  const r = node([EG, 'run', bad]);
  if (r.status !== 1 || r.stdout !== '' || !r.stderr.includes('bad2.eg:2:7: "nope" is not defined')) throw new Error(r.stdout + r.stderr);
});

t('eg components writes schema-valid loom records', () => {
  const outFile = path.join(TMP, 'graph.json');
  const r = node([EG, 'components', path.join(EX, 'components.eg'), '--out', outFile]);
  if (r.status !== 0) throw new Error(r.stderr);
  const g = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  if (g.components.length !== 3 || g.hooks.length !== 7 || g.wires.length !== 4) throw new Error(r.stdout);
});

t('lang/MAP.md is the map the language generates now, and every keyword has a meaning in it', () => {
  const m = require('../map');
  const missing = m.unmapped();
  if (missing.length) throw new Error(`no meaning in lang/map.js for: ${missing.join(', ')}`);
  if (fs.readFileSync(path.join(LANG, 'MAP.md'), 'utf8') !== m.generate()) throw new Error('lang/MAP.md is out of date — run: node lang/eg.js map --out lang/MAP.md');
});

t('eg new makes a project that runs and tests clean', () => {
  const dir = path.join(TMP, 'newproj');
  const n = node([EG, 'new', dir]);
  if (n.status !== 0) throw new Error(n.stderr);
  const r = node([EG, 'run', path.join(dir, 'main.eg')]);
  const t2 = node([EG, 'test', path.join(dir, 'main.eg')]);
  if (r.status !== 0 || !r.stdout.includes('1 open, 1 done') || t2.status !== 0 || !t2.stdout.includes('1 passed, 0 failed')) throw new Error(r.stdout + r.stderr + t2.stdout + t2.stderr);
  const c = node([EG, 'check', path.join(dir, 'main.eg')]);
  if (c.stderr.trim()) throw new Error(`the starter should check clean:\n${c.stderr}`);
});

t('the REPL keeps state between lines', () => {
  const r = spawnSync(process.execPath, [EG, 'repl'], { input: 'var n = 2\nn += 3\nn * 10\n:quit\n', encoding: 'utf8' });
  if (!r.stdout.includes('50')) throw new Error(r.stdout + r.stderr);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
