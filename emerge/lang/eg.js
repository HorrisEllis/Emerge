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
  eg repl                                                     interactive; an expression prints its value
  eg components <file.eg> [--out graph.json]                  export components, hooks and wires as loom records,
                                                              validated against emerge/schemas/schema.component|hook|wire
  eg bootstrap [--strict | --status | --rollback]             rebuild the language from lang/core/*.eg (primitives,
                                                              prelude, selftest): quarantine → prove → integrate
  eg ast   <file.eg>                                          the checked syntax tree as JSON
  eg tokens <file.eg>                                         the token stream
  eg version
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
        for (const m of g.modules) warnings.push(...m.warnings);
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
      process.stdout.write(JSON.stringify(r.program, (k, v) => (k === 'binding' ? undefined : v), 2) + '\n');
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
