'use strict';
// emerge/lang/test/selfhost.test.js — CIE-EG section 10.1 and acceptance test AT-11: the native compiler is written in
// Emerge and compiles itself to the same bytes.
//
//   1. rt_text.eg and prelude_text.eg are exactly rt.eg and core/prelude.eg (carried inside the compiler)
//   2. the Emerge front end (native/front.eg) parses the compiler's own sources to the same tree as the JS parser
//   3. stage 0: the interpreter runs native/emerge.eg on itself → the committed native/bin/emerge, byte for byte
//   4. stage 1 and 2: that binary compiles itself, twice, to the same bytes — no Node in either step
// Linux x86-64 only (the executables are run directly).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.log('skipped: native executables are Linux x86-64 for now (the Windows target is MOD-NATIVE-WINDOWS in cie-eg.spec)');
  process.exit(0);
}

const LANG = path.join(__dirname, '..');
const NATIVE = path.join(LANG, 'native');
const EG = path.join(LANG, 'eg.js');
const BIN = path.join(NATIVE, 'bin', 'emerge');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'emerge-selfhost-'));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (detail ? ' — ' + detail : '')); } };

// 1. the embedded runtime and prelude
for (const [src, out] of [[path.join(NATIVE, 'rt.eg'), 'rt_text.eg'], [path.join(LANG, 'core', 'prelude.eg'), 'prelude_text.eg']]) {
  const tmp = path.join(TMP, out);
  const r = spawnSync(process.execPath, [EG, 'run', path.join(NATIVE, 'embed.eg'), src, tmp], { encoding: 'utf8' });
  check(`${out} is generated from ${path.basename(src)} (see the top of native/embed.eg)`,
    r.status === 0 && fs.readFileSync(tmp).equals(fs.readFileSync(path.join(NATIVE, out))), r.stderr);
}

// 2. front-end parity on the compiler's own sources
{
  const parser = require(path.join(LANG, 'parser.js'));
  const DROP = new Set(['line', 'col', 'file', 'res', 'binding', 'end', 'exports', 'hasUse']);
  const norm = n => Array.isArray(n) ? n.map(norm) : (n && typeof n === 'object')
    ? Object.fromEntries(Object.entries(n).filter(([k]) => !DROP.has(k)).sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => [k, typeof v === 'bigint' ? { bigint: String(v) } : norm(v)]))
    : n;
  const dump = path.join(TMP, 'astdump.eg');
  fs.writeFileSync(dump, `use "${path.join(NATIVE, 'front.eg')}" as front\nlet p = args()[0]\nprint(json(front.parse(read_file(p), p)))\n`);
  for (const f of ['rt.eg', 'x64.eg', 'elf.eg', 'codegen.eg', 'front.eg', 'emerge.eg', 'json.eg', 'embed.eg', '../core/prelude.eg']) {
    const file = path.join(NATIVE, f);
    const js = JSON.stringify(norm(parser.parse(fs.readFileSync(file, 'utf8'), f)));
    const r = spawnSync(process.execPath, [EG, 'run', dump, file], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const eg = r.status === 0 ? JSON.stringify(norm(JSON.parse(r.stdout))) : null;
    check(`front.eg parses ${f} as the JS parser does`, eg === js, r.status !== 0 ? r.stderr.trim().split('\n')[0] : 'trees differ');
  }
}

// 3–4. the bootstrap
{
  const s0 = path.join(TMP, 'stage0'), s1 = path.join(TMP, 'stage1'), s2 = path.join(TMP, 'stage2');
  const r0 = spawnSync(process.execPath, [EG, 'run', path.join(NATIVE, 'emerge.eg'), path.join(NATIVE, 'emerge.eg'), '-o', s0], { encoding: 'utf8', cwd: NATIVE });
  check('stage 0: the interpreter runs the Emerge compiler on itself', r0.status === 0, r0.stderr);
  const committed = fs.existsSync(BIN) ? sha(BIN) : null;
  check('stage 0 output is the committed native/bin/emerge', r0.status === 0 && sha(s0) === committed,
    `stage 0 ${r0.status === 0 ? sha(s0) : '-'}, committed ${committed} — after changing the compiler, run stage 0 and commit its output`);
  const r1 = spawnSync(r0.status === 0 ? s0 : BIN, [path.join(NATIVE, 'emerge.eg'), '-o', s1], { encoding: 'utf8', cwd: NATIVE });
  check('stage 1: the native compiler compiles itself (no Node)', r1.status === 0, r1.stderr);
  const r2 = spawnSync(s1, [path.join(NATIVE, 'emerge.eg'), '-o', s2], { encoding: 'utf8', cwd: NATIVE });
  check('stage 2: its output compiles itself again', r2.status === 0, r2.stderr);
  check('stages 0, 1 and 2 are byte-identical (AT-11)', r1.status === 0 && r2.status === 0 && sha(s0) === sha(s1) && sha(s1) === sha(s2));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
