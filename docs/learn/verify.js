#!/usr/bin/env node
'use strict';
// docs/learn/verify.js — the tutorial cannot drift from the language.
// Every lesson program in examples/ is run twice, interpreted (eg run) and compiled (eg build, then node), and both
// outputs (stdout and stderr) must equal the recorded examples/<name>.out. `--record` rewrites the .out files.
// Run from anywhere: node docs/learn/verify.js [--record]
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const HERE = __dirname, EG = path.join(HERE, '..', '..', 'emerge', 'lang', 'eg.js'), EX = path.join(HERE, 'examples');
const record = process.argv.includes('--record');
const run = (args) => { const r = spawnSync(process.execPath, args, { encoding: 'utf8' }); return `${r.stdout}${r.stderr ? '--- stderr\n' + r.stderr : ''}exit ${r.status}\n`; };
let pass = 0, fail = 0;
for (const f of fs.readdirSync(EX).filter(n => n.endsWith('.eg')).sort()) {
  const src = path.join(EX, f), want = src.replace(/\.eg$/, '.out');
  const interpreted = run([EG, 'run', src]);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-learn-'));
  const built = run([EG, 'build', src, '-o', out]).endsWith('exit 0\n')
    ? run([path.join(out, f.replace(/\.eg$/, '.js'))]) : 'build failed\n';
  fs.rmSync(out, { recursive: true, force: true });
  if (record) fs.writeFileSync(want, interpreted);
  const expected = fs.existsSync(want) ? fs.readFileSync(want, 'utf8') : '(no .out file: run with --record)';
  const ok = interpreted === expected && built === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f}${ok ? '' : interpreted !== expected ? '  (interpreted differs from .out)' : '  (compiled differs from interpreted)'}`);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
