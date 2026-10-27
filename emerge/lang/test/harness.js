'use strict';
// emerge/lang/test/harness.js — run one Emerge program through both backends, in process, and capture everything.
// Each run gets a fresh temp folder, so compiled modules never come from require's cache.

const fs = require('fs');
const os = require('os');
const path = require('path');
const lang = require('../index');
const { runCompiled } = require('../runtime');

let n = 0;
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'emerge-lang-test-'));

function writeProgram(src, files = {}) {
  const dir = path.join(ROOT, `case-${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  const main = path.join(dir, 'main.eg');
  fs.writeFileSync(main, src);
  return { dir, main };
}

function interpret(main, { seed = 0, test = false, args = [] } = {}) {
  let out = '', err = '';
  const r = lang.runFile(main, { seed, test, args, out: s => { out += s; }, err: s => { err += s; } });
  return { out, err, code: r.code, ledger: r.rt ? r.rt.world.ledger.map(e => e.hash) : null, rt: r.rt };
}

function compiled(main, dir, { seed = 0, test = false, args = [] } = {}) {
  const outDir = path.join(dir, 'build');
  const b = lang.buildFile(main, outDir);
  if (b.errors.length) return { out: '', err: b.errors.map(e => `${e.file}:${e.line}:${e.col}: ${e.message}`).join('\n'), code: 1, ledger: null, buildFailed: true };
  let out = '', err = '';
  const load = require(path.join(outDir, 'main.js'));
  const argv = ['--seed', String(seed), ...(test ? ['--test'] : []), '--', ...args];
  const ledgerFile = path.join(dir, 'ledger.json');
  argv.splice(2, 0, '--ledger', ledgerFile);
  const code = runCompiled(load, { file: 'main.eg', argv, out: s => { out += s; }, err: s => { err += s; } });
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')).map(e => e.hash);
  return { out, err, code, ledger };
}

/** run in both backends; throws if they disagree on anything. Returns the interpreter's result. */
function both(src, opts = {}) {
  const { dir, main } = writeProgram(src, opts.files);
  const a = interpret(main, opts);
  const b = compiled(main, dir, opts);
  if (a.out !== b.out || a.err !== b.err || a.code !== b.code || JSON.stringify(a.ledger) !== JSON.stringify(b.ledger)) {
    const e = new Error(`backends disagree\n--- interpreter (exit ${a.code})\n${a.out}${a.err}\n--- compiled (exit ${b.code})\n${b.out}${b.err}`);
    throw e;
  }
  return a;
}

function checkSrc(src) { return lang.compileSource(src, 'main.eg'); }

module.exports = { both, interpret, compiled, writeProgram, checkSrc, ROOT };
