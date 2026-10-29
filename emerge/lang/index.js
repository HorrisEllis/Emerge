'use strict';
// emerge/lang/index.js — the public API of the Emerge language.
// component_id: emerge.lang · spec: emerge/lang/emerge-lang.spec (modules.modules)
//
//   compileSource(src, file)        → { program, errors, warnings }           parse + check, never throws
//   runFile(path, opts)             → { code, rt }                            interpret (opts: seed, test, args, out, err, ledger)
//   buildFile(path, outDir, opts)   → { files: [written paths], errors, warnings }  compile to CommonJS (+ every used module)

const fs = require('fs');
const path = require('path');
const { parse } = require('./parser');
const { lex } = require('./lexer');
const { check } = require('./checker');
const { createRuntime, finishRun, VERSION } = require('./runtime');
const { createInterpreter } = require('./interpreter');
const { emitProgram } = require('./emitter');
const { EmergeSyntaxError } = require('./errors');

function compileSource(src, file = '<input>') {
  let program;
  try { program = parse(src, file); }
  catch (e) {
    if (e instanceof EmergeSyntaxError) return { program: null, errors: [{ message: e.bare, line: e.line, col: e.col, file }], warnings: [] };
    throw e;
  }
  const r = check(program);
  return { program, errors: r.errors.map(x => ({ ...x, file })), warnings: r.warnings.map(x => ({ ...x, file })) };
}

const fmtDiag = (d, level) => `${d.file}:${d.line}:${d.col}: ${level}: ${d.message}`;

function displayName(abs, root) { return (path.relative(root, abs) || path.basename(abs)).split(path.sep).join('/'); } // always '/', so messages match on Windows

/** compile a file or throw the first error as an EmergeSyntaxError */
function compileOrThrow(abs, root) {
  const file = displayName(abs, root);
  let src;
  try { src = fs.readFileSync(abs, 'utf8'); }
  catch (e) { throw new EmergeSyntaxError(`cannot read ${file}: ${e.code || e.message}`, file, 0, 0); }
  const r = compileSource(src, file);
  if (r.errors.length) { const d = r.errors[0]; throw new EmergeSyntaxError(d.message, file, d.line, d.col); }
  return { ...r, file };
}

function runFile(mainPath, opts = {}) {
  const abs = path.resolve(mainPath);
  const root = path.dirname(abs);
  const errOut = opts.err || (s => process.stderr.write(s));
  let main;
  try { main = compileOrThrow(abs, root); }
  catch (e) {
    if (!(e instanceof EmergeSyntaxError)) throw e;
    errOut(`error: ${e.message}\n`);
    return { code: 1, rt: null };
  }
  for (const w of main.warnings) if (opts.warnings) errOut(fmtDiag(w, 'warning') + '\n');

  const rt = createRuntime({
    file: main.file, seed: opts.seed || 0, argv: opts.args || [], out: opts.out, err: opts.err,
    loadModule: (modAbs, r) => {
      const m = compileOrThrow(modAbs, root);
      const interp = createInterpreter(r, m.file);
      const env = interp.runProgram(m.program, modAbs);
      return interp.exportsOf(m.program, env);
    },
  });
  const interp = createInterpreter(rt, main.file);
  const program = () => { interp.runProgram(main.program, abs); };
  const code = opts.test ? rt.runTests(program).exit : rt.runMain(program);
  return { code: finishRun(rt, { ledger: opts.ledger || null }, code), rt };
}

/** walk a program's use graph from mainPath; returns [{ abs, file, program, warnings }] main first */
function collectModules(mainPath) {
  const abs = path.resolve(mainPath);
  const root = path.dirname(abs);
  const seen = new Map();
  const order = [];
  (function visit(p) {
    if (seen.has(p)) return;
    const m = compileOrThrow(p, root);
    seen.set(p, true);
    order.push({ abs: p, ...m });
    for (const it of m.program.items) if (it.type === 'Use') visit(path.resolve(path.dirname(p), it.path));
  })(abs);
  return { root, modules: order };
}

/**
 * buildFile(main, outDir, { standalone }) — every module is written to outDir at its path relative to the main file,
 * with .eg → .js. standalone copies the runtime into outDir/_emerge so the output runs with nothing else.
 */
function buildFile(mainPath, outDir, opts = {}) {
  let graph;
  try { graph = collectModules(mainPath); }
  catch (e) {
    if (!(e instanceof EmergeSyntaxError)) throw e;
    return { files: [], errors: [{ message: e.bare, line: e.line, col: e.col, file: e.file }], warnings: [] };
  }
  const out = path.resolve(outDir);
  fs.mkdirSync(out, { recursive: true });
  let runtimeAbs = path.join(__dirname, 'runtime.js');
  const files = [];
  if (opts.standalone) {
    const base = path.join(out, '_emerge');
    fs.mkdirSync(path.join(base, 'lang'), { recursive: true });
    fs.mkdirSync(path.join(base, 'core'), { recursive: true });
    fs.cpSync(path.join(__dirname, 'build', 'current'), path.join(base, 'lang', 'build', 'current'), { recursive: true });
    for (const f of ['runtime.js', 'errors.js', 'components.js', 'build-loader.js', 'ledger.js']) {
      fs.copyFileSync(path.join(__dirname, f), path.join(base, 'lang', f));
      files.push(path.join(base, 'lang', f));
    }
    fs.copyFileSync(path.join(__dirname, '..', 'core', 'constraint.js'), path.join(base, 'core', 'constraint.js'));
    fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({ name: 'emerge-runtime', version: VERSION, private: true }, null, 2) + '\n');
    files.push(path.join(base, 'core', 'constraint.js'), path.join(base, 'package.json'));
    runtimeAbs = path.join(base, 'lang', 'runtime.js');
  }
  const warnings = [];
  for (const m of graph.modules) {
    if (path.relative(graph.root, m.abs).startsWith('..')) {
      return { files, errors: [{ message: `${m.file} lives outside the main file's folder — build writes each module beside the main one, so move it under ${path.basename(graph.root)}/`, line: 0, col: 0, file: m.file }], warnings };
    }
  }
  for (const m of graph.modules) {
    const rel = path.relative(graph.root, m.abs).replace(/\.eg$/, '.js');
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let req = path.relative(path.dirname(dest), runtimeAbs).split(path.sep).join('/');
    if (!path.isAbsolute(req) && !/^[A-Za-z]:/.test(req) && !req.startsWith('.')) req = './' + req; // cross-drive on Windows: path.relative returns an absolute path
    fs.writeFileSync(dest, emitProgram(m.program, { file: m.file, runtimeRequire: req }));
    files.push(dest);
    warnings.push(...m.warnings);
  }
  return { files, errors: [], warnings };
}

module.exports = { compileSource, runFile, buildFile, collectModules, fmtDiag, parse, lex, check, emitProgram, VERSION };
