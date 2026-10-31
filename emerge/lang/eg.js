#!/usr/bin/env node
'use strict';
// emerge/lang/eg.js — the Emerge command line.
// component_id: emerge.lang.cli · spec: emerge/lang/emerge-lang.spec (modules.cli)

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const lang = require('./index');
const { createRuntime, parseRunArgs, show } = require('./runtime');
const { createInterpreter } = require('./interpreter');

const USAGE = `emerge ${lang.VERSION} — the Emerge language

  eg run   <file.eg> [--seed N] [--ledger out.json] [args…]   interpret a program
  eg test  <file.eg> [--seed N]                               run its test "…" blocks, each in its own whatif fork
  eg check <file.eg> [--json]                                 parse + check; errors and warnings, nothing runs
  eg build <file.eg> [-o outDir] [--standalone]               compile to CommonJS (every used module too)
  eg new <folder>                                             start a project: main.eg with a compartment and a test
  eg ide [folder] [--port 4343]                               a local editor for .eg files: autocomplete, live errors, run/test,
                                                              and a Generate button that writes new .eg files
  eg gen <compartment|component|test|module|program> <Name> [folder]   write a new .eg file into emerge/output (or folder)
  eg say "<a sentence in your words>" [folder]                write the Emerge it means into emerge/output (or folder), no model:
                                                              each word understood is shown with your quote; an unknown word is a gap
  eg teach "<phrase>" as <word>                               add a phrase to your words, as a form of a word you already have
  eg words                                                    your vocabulary, each word with the quote it came from
  eg learn [n] [--stub | --full] [--keys <keys>]              a lesson at the size you can take: n next, m more (smaller),
                                                              l less, b back; steps get smaller when you keep opening them
  eg map [--out MAP.md]                                       the language map: every keyword, primitive, builtin
  eg repl                                                     interactive; an expression prints its value
  eg components <file.eg> [--out graph.json]                  export components, hooks and wires as loom records,
                                                              validated against emerge/schemas/records/schema.component|hook|wire
  eg bootstrap [--strict | --status | --rollback]             rebuild the language from lang/core/*.eg (primitives,
                                                              prelude, selftest): quarantine → prove → integrate
  eg native <file.eg> [-o out]                                compile Emerge to a Linux x86-64 executable with the self-hosted
                                                              native compiler (native/bin/emerge; --stage0 runs it in the interpreter)
  eg debug <ledger.json> <blame|why N|at N|follow|diff F|clip A B|report>   debug a run from its ledger (eg run --ledger out.json):
                                                              why an entry happened, the world at tick N, where two runs diverge
  eg ast   <file.eg>                                          the checked syntax tree as JSON
  eg tokens <file.eg>                                         the token stream
  eg version
`;

const STARTER = (name) => `// ${name} — an Emerge program. Run: eg run main.eg · Test: eg test main.eg · Compile: eg build main.eg -o out
// The language map (every keyword, primitive and builtin): lang/MAP.md · The guide: lang/README.md

compartment Tasks {
  id = "${name}.tasks"
  intent = "a list of tasks that can only be finished once"
  state { open: [], done: [] }

  constraint no_overlap hard { not any(state.done, fn(t) = state.open contains t) }

  on "task.add" (e) {
    state.open = push(state.open, e.title)
    emit "task.added" { title: e.title, open: len(state.open) }
  }
  on "task.done" (e) {
    expect state.open contains e.title, "no open task called {e.title}"
    state.open = filter(state.open, fn(t) = t != e.title)
    state.done = push(state.done, e.title)
  }

  fn summary() = "{len(state.open)} open, {len(state.done)} done"
}

on "task.added" (e) { print("added", e.title, "— open:", e.open) }

emit "task.add" { title: "write the spec" }
emit "task.add" { title: "build it" }
emit "task.done" { title: "write the spec" }
print(Tasks.summary())

test "finishing a task moves it" {
  emit "task.add" { title: "x" }
  emit "task.done" { title: "x" }
  expect Tasks.state.done contains "x"
  expect not (Tasks.state.open contains "x")
}
`;

function die(msg, code = 2) { process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n'); process.exit(code); }
function needFile(f) { if (!f) die(USAGE); if (!fs.existsSync(f)) die(`error: no such file ${f}`); return f; }

/** a reminder, never a block: the core sources moved since the build in use */
function warnIfStale(cmd) {
  if (process.env.EMERGE_BUILD || !['run', 'test', 'build', 'check'].includes(cmd)) return;
  try {
    const st = require('./bootstrap').status();
    if (st.build !== null && st.changed.length) process.stderr.write(`[emerge] ${st.changed.join(', ')} changed since build ${st.build} — run: eg bootstrap\n`);
  } catch (_) { /* status is advisory */ }
}

function main(argv) {
  const [cmd, ...rest] = argv;
  warnIfStale(cmd);
  switch (cmd) {
    case 'run': case 'test': {
      const file = needFile(rest[0]);
      let opts;
      try { opts = parseRunArgs(rest.slice(1)); } catch (e) { die(`error: ${e.message}`); }
      const r = lang.runFile(file, { seed: opts.seed, args: opts.args, ledger: opts.ledger, test: cmd === 'test' || opts.test, warnings: false });
      process.exitCode = r.code;
      return;
    }
    case 'check': {
      const file = needFile(rest[0]);
      const json = rest.includes('--json');
      const display = path.basename(file);
      let errors = [], warnings = [];
      try {
        const g = lang.collectModules(file);
        for (const m of g.modules) {
          if (m.node) {
            // a node file must be one JSON object (JSON is valid YAML)
            try { const v = JSON.parse(fs.readFileSync(m.abs, 'utf8')); if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('a node file holds one object'); }
            catch (e) { errors.push({ file: path.basename(m.abs), line: 1, col: 1, message: `node file: ${e.code === 'ENOENT' ? 'not found' : e.message}` }); }
            continue;
          }
          warnings.push(...m.warnings);
        }
      } catch (e) {
        if (e.name !== 'EmergeSyntaxError') throw e;
        errors.push({ file: e.file, line: e.line, col: e.col, message: e.bare });
      }
      if (json) process.stdout.write(JSON.stringify({ ok: !errors.length, errors, warnings }, null, 2) + '\n');
      else {
        for (const d of errors) process.stderr.write(lang.fmtDiag(d, 'error') + '\n');
        for (const d of warnings) process.stderr.write(lang.fmtDiag(d, 'warning') + '\n');
        if (!errors.length) process.stdout.write(`${display}: ok${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''})` : ''}\n`);
      }
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    case 'build': {
      const file = needFile(rest[0]);
      const oi = rest.indexOf('-o');
      const outDir = oi !== -1 ? rest[oi + 1] : path.join(path.dirname(file), 'build');
      if (!outDir) die('error: -o needs a directory');
      const r = lang.buildFile(file, outDir, { standalone: rest.includes('--standalone') });
      for (const d of r.errors) process.stderr.write(lang.fmtDiag(d, 'error') + '\n');
      for (const d of r.warnings) process.stderr.write(lang.fmtDiag(d, 'warning') + '\n');
      for (const f of r.files) process.stdout.write(`wrote ${path.relative(process.cwd(), f)}\n`);
      process.exitCode = r.errors.length ? 1 : 0;
      return;
    }
    case 'components': {
      const file = needFile(rest[0]);
      const r = lang.compileSource(fs.readFileSync(file, 'utf8'), path.basename(file));
      if (r.errors.length) { for (const d of r.errors) process.stderr.write(lang.fmtDiag(d, 'error') + '\n'); process.exitCode = 1; return; }
      const { graphOfProgram, validateRecords } = require('./components');
      const g = graphOfProgram(r.program);
      const problems = validateRecords(g);
      if (problems.length) { for (const p of problems) process.stderr.write(`error: ${p}\n`); process.exitCode = 1; return; }
      const text = JSON.stringify(g, null, 2) + '\n';
      const oi = rest.indexOf('--out');
      if (oi !== -1) {
        if (!rest[oi + 1]) die('error: --out needs a path');
        fs.writeFileSync(rest[oi + 1], text);
        process.stdout.write(`wrote ${rest[oi + 1]} — ${g.components.length} components, ${g.hooks.length} hooks, ${g.wires.length} wires (schema-valid)\n`);
      } else process.stdout.write(text);
      return;
    }
    case 'ast': {
      const file = needFile(rest[0]);
      const r = lang.compileSource(fs.readFileSync(file, 'utf8'), path.basename(file));
      if (r.errors.length) { for (const d of r.errors) process.stderr.write(lang.fmtDiag(d, 'error') + '\n'); process.exitCode = 1; return; }
      process.stdout.write(JSON.stringify(r.program, (k, v) => (k === 'binding' ? undefined : typeof v === 'bigint' ? { bigint: v.toString() } : v), 2) + '\n');
      return;
    }
    case 'native': {
      // eg native <file.eg> [-o out]: the JS checker reports errors first (better messages), then the native compiler —
      // written in Emerge (native/emerge.eg: front.eg + codegen.eg + the runtime rt.eg) — writes the executable.
      // If the self-hosted binary native/bin/emerge exists it does the work (no Node in the compile); otherwise this is
      // stage 0: the interpreter runs native/emerge.eg once.
      const file = needFile(rest[0]);
      const oi = rest.indexOf('-o');
      const outPath = path.resolve(oi > -1 ? rest[oi + 1] : path.basename(file).replace(/\.eg$/, ''));
      const r = lang.compileSource(fs.readFileSync(file, 'utf8'), path.basename(file));
      if (r.errors.length) { for (const d of r.errors) process.stderr.write(lang.fmtDiag(d, 'error') + '\n'); process.exitCode = 1; return; }
      const bin = path.join(__dirname, 'native', 'bin', 'emerge');
      const useBin = fs.existsSync(bin) && process.platform === 'linux' && process.arch === 'x64' && !rest.includes('--stage0');
      const cmd = useBin ? [bin, [path.resolve(file), '-o', outPath]] : [process.execPath, [__filename, 'run', path.join(__dirname, 'native', 'emerge.eg'), path.resolve(file), '-o', outPath]];
      const cg = require('child_process').spawnSync(cmd[0], cmd[1], { encoding: 'utf8', maxBuffer: 1 << 28 });
      if (cg.status !== 0) { process.stderr.write((cg.stderr || cg.stdout || 'native: code generation failed') + '\n'); process.exitCode = 1; return; }
      process.stdout.write('wrote ' + path.relative(process.cwd(), outPath) + '\n');
      return;
    }
    case 'tokens': {
      const file = needFile(rest[0]);
      try {
        for (const t of lang.lex(fs.readFileSync(file, 'utf8'), path.basename(file))) {
          process.stdout.write(`${t.line}:${t.col}\t${t.t}\t${t.t === 'STR' && t.v === null ? '(interpolated)' : JSON.stringify(t.v)}\n`);
        }
      } catch (e) { die(`error: ${e.message}`, 1); }
      return;
    }
    case 'debug': { process.exitCode = require('../observe/cli').run(rest); return; }
    case 'bootstrap': {
      const bs = require('./bootstrap');
      if (rest.includes('--status')) {
        const st = bs.status();
        if (st.build === null) process.stdout.write('no build yet — run: eg bootstrap\n');
        else if (!st.changed.length) process.stdout.write(`build ${st.build} is current with lang/core\n`);
        else process.stdout.write(`build ${st.build} is behind: ${st.changed.join(', ')} changed — run: eg bootstrap\n`);
        process.exitCode = st.build !== null && !st.changed.length ? 0 : 1;
        return;
      }
      if (rest.includes('--rollback')) {
        try { process.stdout.write(`rolled back: build ${bs.rollback()} is current\n`); }
        catch (e) { die(`error: ${e.message}`, 1); }
        return;
      }
      try {
        const r = bs.bootstrap({ strict: rest.includes('--strict'), log: m => process.stdout.write(m + '\n') });
        for (const c of r.checks) process.stdout.write(`  ✓ ${c}\n`);
        process.stdout.write(`build ${r.build} is current\n`);
      } catch (e) {
        if (!e.stage) throw e;
        process.stderr.write(`✗ ${e.message}\n\nthe current build is unchanged; the candidate is in lang/build/next\n`);
        process.exitCode = 1;
      }
      return;
    }
    case 'map': {
      const m = require('./map');
      const missing = m.unmapped();
      if (missing.length) die(`error: the map has no meaning for: ${missing.join(', ')} — add them in lang/map.js`, 1);
      const text = m.generate();
      const oi = rest.indexOf('--out');
      if (oi !== -1) {
        if (!rest[oi + 1]) die('error: --out needs a path');
        fs.writeFileSync(rest[oi + 1], text);
        process.stdout.write(`wrote ${rest[oi + 1]}\n`);
      } else process.stdout.write(text);
      return;
    }
    case 'new': {
      const dir = rest[0];
      if (!dir) die('usage: eg new <folder>');
      if (fs.existsSync(dir) && fs.readdirSync(dir).length) die(`error: ${dir} is not empty`);
      fs.mkdirSync(dir, { recursive: true });
      const name = path.basename(path.resolve(dir)).replace(/[^A-Za-z0-9_]/g, '_');
      fs.writeFileSync(path.join(dir, 'main.eg'), STARTER(name));
      process.stdout.write(`created ${path.join(dir, 'main.eg')}\n\n  ${process.argv[1] ? 'node ' + path.relative(process.cwd(), process.argv[1]) : 'eg'} run ${path.join(dir, 'main.eg')}\n  ${process.argv[1] ? 'node ' + path.relative(process.cwd(), process.argv[1]) : 'eg'} test ${path.join(dir, 'main.eg')}\n`);
      return;
    }
    case 'ide': {
      const pi = rest.indexOf('--port');
      const port = pi !== -1 ? Number(rest[pi + 1]) : 4343;
      const folder = rest.find((a, i) => !a.startsWith('--') && (pi === -1 || i !== pi + 1));
      require('./ide').start(folder, port);
      return;
    }
    case 'gen': {
      // eg gen <compartment|component|test|module|program> <Name> [folder] — write a new .eg file that checks clean
      const { GENERATORS, OUTPUT } = require('./ide');
      const [kind, name, folder] = rest;
      if (!GENERATORS[kind] || !name) die('usage: eg gen <' + Object.keys(GENERATORS).join('|') + '> <Name> [folder]');
      const dir = folder || OUTPUT;   // default: emerge/output
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name.toLowerCase().replace(/[^a-z0-9_]/g, '_') + '.eg');
      if (fs.existsSync(file)) die(`error: ${file} exists`);
      fs.writeFileSync(file, GENERATORS[kind](name));
      process.stdout.write(`created ${file}\n`);
      return;
    }
    case 'say': case 'teach': case 'words': {
      // his words in, Emerge out (emerge/spec/say.spec). The reading is Emerge's own (lang/say/say.eg); this only checks and writes.
      const SAY = path.join(__dirname, 'say', 'say.eg');
      let argv;
      if (cmd === 'say') {
        if (!rest[0]) die('usage: eg say "<a sentence in your words>" [folder]');
        argv = ['say', rest[0]];
      } else if (cmd === 'teach') {
        if (!rest[0] || rest[1] !== 'as' || !rest[2]) die('usage: eg teach "<phrase>" as <word>');
        argv = ['teach', rest[0], rest[2]];
      } else argv = ['words'];
      const r = require('child_process').spawnSync(process.execPath, [__filename, 'run', SAY, ...argv], { encoding: 'utf8', maxBuffer: 1 << 26 });
      if (r.status !== 0) die((r.stderr || r.stdout).trim(), 1);
      if (cmd === 'words') { process.stdout.write(r.stdout); return; }
      const out = JSON.parse(r.stdout.trim().split('\n').pop());
      if (cmd === 'teach') {
        const file = path.join(__dirname, 'say', 'taught.eg');
        const c = lang.compileSource(out.text, 'taught.eg');
        if (c.errors.length) die('teach refused: taught.eg would not check: ' + c.errors[0].message, 1);
        fs.writeFileSync(file, out.text);
        process.stdout.write(`learned "${out.phrase}" — it means what "${out.word}" means: ${out.means}\n`);
        return;
      }
      process.stdout.write(out.report + '\n');
      if (!out.ok) { process.exitCode = 1; return; }
      const c = lang.compileSource(out.source, out.name + '.eg');
      if (c.errors.length) {
        process.stdout.write('the checker refused what was written (no file):\n' + c.errors.map(e => '  ' + e.message).join('\n') + '\n');
        process.exitCode = 1;
        return;
      }
      if (out.node) {
        try { JSON.parse(out.node); } catch (e) { die('the node file is not valid JSON (no files written): ' + e.message, 1); }
      }
      const { OUTPUT } = require('./ide');
      const dir = rest[1] || OUTPUT;
      fs.mkdirSync(dir, { recursive: true });
      const base = out.name.replace(/[^a-z0-9_]/g, '_');
      const file = path.join(dir, base + '.eg');
      const nodeFile = path.join(dir, base + '.node');
      for (const f of out.node ? [file, nodeFile] : [file]) if (fs.existsSync(f)) die(`error: ${f} exists`, 1);
      // his rule: the numbers and starting data live in the node file, beside the code
      if (out.node) fs.writeFileSync(nodeFile, out.node);
      fs.writeFileSync(file, out.source);
      process.stdout.write(`wrote ${file}${out.node ? ` and ${path.basename(nodeFile)} (its levers and starting data)` : ''} — checks clean. run it: eg run ${file}\n`);
      return;
    }
    case 'learn': {
      // lessons that break themselves down (emerge/spec/learn.spec); the breaking down is Emerge's (lang/learn/learn.eg)
      const DOCS = path.join(__dirname, '..', '..', 'docs', 'learn');
      if (!fs.existsSync(DOCS)) die('error: no docs/learn folder at ' + DOCS, 1);
      const lessons = fs.readdirSync(DOCS).filter(f => /^[0-9]/.test(f) && f.endsWith('.md')).sort();
      const pick = rest.find(a => !a.startsWith('--') && rest[rest.indexOf(a) - 1] !== '--keys');
      const file = pick && lessons.find(f => f.split('-')[0] === pick);
      if (!file) {
        process.stdout.write(lessons.map(f => '  ' + f.split('-')[0].padEnd(4) + fs.readFileSync(path.join(DOCS, f), 'utf8').split('\n')[0].replace(/^# /, '')).join('\n') + '\n  eg learn <n> to start one\n');
        if (pick) process.exitCode = 1;
        return;
      }
      const start = rest.includes('--stub') ? 'stub' : rest.includes('--full') ? 'full' : '';
      const ki = rest.indexOf('--keys');
      const show = keys => {
        const r = require('child_process').spawnSync(process.execPath, [__filename, 'run', path.join(__dirname, 'learn', 'learn.eg'), 'view', path.join(DOCS, file), path.join(DOCS, 'words.md'), keys, start], { encoding: 'utf8' });
        if (r.status !== 0) die((r.stderr || r.stdout).trim(), 1);
        return JSON.parse(r.stdout.trim().split('\n').pop()).text;
      };
      if (ki >= 0 || !process.stdin.isTTY) { process.stdout.write(show(ki >= 0 ? rest[ki + 1] || '' : '') + '\n'); return; }
      let keys = '';
      process.stdout.write('\x1b[2J\x1b[H' + show(keys) + '\n');
      process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
      process.stdin.on('data', k => {
        if (k === 'q' || k === '\u0003') { process.stdin.setRawMode(false); process.exit(0); }
        keys += k === '\r' || k === ' ' ? 'n' : k;
        process.stdout.write('\x1b[2J\x1b[H' + show(keys) + '\n');
      });
      return;
    }
    case 'repl': return repl();
    case 'version': case '--version': case '-v':
      process.stdout.write(`emerge ${lang.VERSION}\n`); return;
    case undefined: case 'help': case '--help': case '-h':
      process.stdout.write(USAGE); return;
    default: {
      // eg file.eg … is eg run file.eg …
      if (cmd.endsWith('.eg')) return main(['run', ...argv]);
      die(`unknown command "${cmd}"\n\n${USAGE}`);
    }
  }
}

// ── REPL ─────────────────────────────────────────────────────────────────────
// Every accepted chunk is kept; a new chunk is checked together with all earlier ones (so names resolve), and only the
// new chunk's items run, against one persistent environment and one world.
function repl() {
  const rt = createRuntime({ file: '<repl>' });
  const interp = createInterpreter(rt, '<repl>');
  const env = interp.newEnv();
  let accepted = '';
  let buf = '';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'eg> ' });
  process.stdout.write(`emerge ${lang.VERSION} — :quit to leave, :ledger for the ledger\n`);
  rl.prompt();
  const balanced = (s) => {
    let d = 0, inStr = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if ('{(['.includes(c)) d++;
      else if ('})]'.includes(c)) d--;
    }
    return d <= 0;
  };
  rl.on('line', (lineText) => {
    if (!buf && lineText.trim() === ':quit') { rl.close(); return; }
    if (!buf && lineText.trim() === ':ledger') { for (const e of rt.world.ledger) process.stdout.write(`${e.seq} ${e.kind} ${show(e.body, true)}\n`); rl.prompt(); return; }
    buf += lineText + '\n';
    if (!balanced(buf)) { rl.setPrompt('... '); rl.prompt(); return; }
    const chunk = buf;
    buf = '';
    rl.setPrompt('eg> ');
    const offset = accepted.split('\n').length - 1;
    const combined = accepted + chunk;
    const r = lang.compileSource(combined, '<repl>');
    const fresh = r.errors.filter(d => d.line > offset);
    if (fresh.length || (r.errors.length && !r.program)) {
      for (const d of (fresh.length ? fresh : r.errors)) process.stdout.write(`error: line ${d.line - offset}:${d.col}: ${d.message}\n`);
      rl.prompt(); return;
    }
    accepted = combined;
    const items = r.program.items.filter(it => it.line > offset);
    const last = items[items.length - 1];
    const showLast = last && last.type === 'ExprStmt';
    try {
      interp.runItems(showLast ? items.slice(0, -1) : items, env, path.join(process.cwd(), '<repl>'), r.program.items.some(i => i.type === 'Axiom'));
      if (showLast) {
        rt.at(last.line, '<repl>');
        const v = interp.evalExpr(last.expr, env);
        if (v !== null && v !== undefined) process.stdout.write(show(v, true) + '\n');
      }
    } catch (e) {
      const x = rt.toError(e);
      process.stdout.write(`error: line ${x.line - offset}: ${x.bare || x.message}\n`);
    }
    if (rt.world.unrouted.length) {
      process.stdout.write(`[emerge] unrouted: ${rt.world.unrouted.join(', ')} (in the ledger)\n`);
      rt.world.unrouted.length = 0;
    }
    rl.prompt();
  });
  rl.on('close', () => process.stdout.write('\n'));
}

process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(process.exitCode || 0); throw e; });
main(process.argv.slice(2));
