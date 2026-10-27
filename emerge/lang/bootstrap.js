'use strict';
// emerge/lang/bootstrap.js — the language builds itself from lang/core/*.eg.
// component_id: emerge.lang.bootstrap · spec: emerge/lang/emerge-lang.spec (bootstrap)
//
//   QUARANTINE  core/primitives.eg (seed mode, data only) → build/next/primitives.json
//               core/prelude.eg (against the new primitives, natives only) → build/next/prelude.js
//   PROVE       primitives schema · prelude loads · core/selftest.eg passes in both backends with identical output ·
//               every example gives identical stdout/stderr/exit/ledger in both backends · (--strict) the JS suites
//   INTEGRATE   current → previous, next → current, BUILD.json
// A failed proof never touches current. rollback() swaps previous and current. status() says whether sources moved.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const build = require('./build-loader');
const { compileSource } = require('./index');
const { createRuntime, VERSION } = require('./runtime');
const { createInterpreter } = require('./interpreter');
const { emitProgram } = require('./emitter');

const LANG = __dirname;
const CORE = path.join(LANG, 'core');
const BUILD = path.join(LANG, 'build');
const SOURCES = ['primitives.eg', 'prelude.eg', 'selftest.eg'];
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const srcSha = (text) => sha(text.replace(/\r\n/g, '\n'));   // a CRLF checkout (git on Windows) is the same source

// ── the shape primitives.eg must have (structure only — every value lives in the .eg file) ──────────────────────────
const SEVERITIES = ['error', 'warning', 'off'];
const RULES = ['NO_SILENT_DROP', 'SIGNAL_MUST_ROUTE_OR_LOG', 'GAP_IS_FIRST_CLASS', 'EXECUTION_IS_TRACEABLE', 'unused_constraint'];
function validatePrimitives(P) {
  const bad = [];
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const num = (v, at) => { if (typeof v !== 'number' || !Number.isFinite(v)) bad.push(`${at} must be a num`); };
  const str = (v, at) => { if (typeof v !== 'string' || !v) bad.push(`${at} must be a non-empty string`); };
  const bool = (v, at) => { if (typeof v !== 'boolean') bad.push(`${at} must be a bool`); };
  const obj = (v, at) => { if (!isObj(v)) { bad.push(`${at} must be a map`); return false; } return true; };
  if (!obj(P, 'primitives')) return bad;
  const known = ['constraint_types', 'gaps', 'signals', 'truth', 'dispatch', 'transitions', 'components', 'diagnostics'];
  for (const k of Object.keys(P)) if (!known.includes(k)) bad.push(`unknown section "${k}" — the sections are ${known.join(', ')}`);
  if (obj(P.constraint_types, 'constraint_types')) {
    if (!Object.keys(P.constraint_types).length) bad.push('constraint_types is empty');
    if (!P.constraint_types.hard) bad.push('constraint_types.hard is required — invariant and boundary are hard constraints');
    else if (P.constraint_types.hard.permits_violation !== false) bad.push('constraint_types.hard must not permit a violation');
    for (const [k, t] of Object.entries(P.constraint_types)) {
      if (!/^[a-z][a-z0-9_]*$/.test(k) || k === 'cost') bad.push(`constraint type "${k}" must be a lowercase word other than cost`);
      if (obj(t, `constraint_types.${k}`)) { bool(t.permits_violation, `constraint_types.${k}.permits_violation`); num(t.default_cost, `constraint_types.${k}.default_cost`); }
    }
  }
  if (obj(P.gaps, 'gaps')) {
    const G = P.gaps;
    if (!Array.isArray(G.types) || !G.types.length || !G.types.every(t => typeof t === 'string' && /^[a-z_]+$/.test(t))) bad.push('gaps.types must be a non-empty list of lowercase words');
    str(G.default_type, 'gaps.default_type');
    if (Array.isArray(G.types) && !G.types.includes(G.default_type)) bad.push('gaps.default_type must be one of gaps.types');
    num(G.pressure_min, 'gaps.pressure_min'); num(G.pressure_max, 'gaps.pressure_max');
    if (G.pressure_min > G.pressure_max) bad.push('gaps.pressure_min is above gaps.pressure_max');
    for (const k of ['constraint_gap', 'promotion_refused']) {
      if (obj(G[k], `gaps.${k}`)) {
        num(G[k].pressure, `gaps.${k}.pressure`);
        if (Array.isArray(G.types) && !G.types.includes(G[k].type)) bad.push(`gaps.${k}.type must be one of gaps.types`);
        if (G[k].pressure < G.pressure_min || G[k].pressure > G.pressure_max) bad.push(`gaps.${k}.pressure is outside the pressure range`);
      }
    }
  }
  if (obj(P.signals, 'signals')) {
    for (const k of ['rejected', 'gap_opened', 'promoted']) str(P.signals[k], `signals.${k}`);
    const names = ['rejected', 'gap_opened', 'promoted'].map(k => P.signals[k]);
    if (new Set(names).size !== names.length) bad.push('signals: the three runtime signal names must differ');
  }
  if (obj(P.truth, 'truth')) bool(P.truth.strict, 'truth.strict');
  if (obj(P.dispatch, 'dispatch')) {
    num(P.dispatch.max_deliveries, 'dispatch.max_deliveries');
    if (!(P.dispatch.max_deliveries >= 1)) bad.push('dispatch.max_deliveries must be at least 1');
    if (!['log', 'error'].includes(P.dispatch.unrouted)) bad.push('dispatch.unrouted must be "log" or "error"');
  }
  if (obj(P.transitions, 'transitions')) bool(P.transitions.discard_emits_on_refusal, 'transitions.discard_emits_on_refusal');
  if (obj(P.components, 'components')) {
    num(P.components.boundary_max, 'components.boundary_max');
    if (!(Number.isInteger(P.components.boundary_max) && P.components.boundary_max >= 1)) bad.push('components.boundary_max must be an int ≥ 1');
    str(P.components.hook_type, 'components.hook_type');
  }
  if (obj(P.diagnostics, 'diagnostics')) {
    for (const r of RULES) if (!SEVERITIES.includes(P.diagnostics[r])) bad.push(`diagnostics.${r} must be "error", "warning" or "off"`);
    for (const k of Object.keys(P.diagnostics)) if (!RULES.includes(k)) bad.push(`diagnostics.${k} is not a rule — the rules are ${RULES.join(', ')}`);
  }
  return bad;
}

function fail(stage, problems, report) {
  const e = new Error(`${stage}:\n  ${problems.join('\n  ')}`);
  e.stage = stage; e.problems = problems; e.report = report;
  return e;
}

function compileOrFail(file, src, stage, report) {
  const r = compileSource(src, file);
  if (r.errors.length) throw fail(stage, r.errors.map(d => `${file}:${d.line}:${d.col}: ${d.message}`), report);
  return r;
}

const node = (args, env, cwd) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });

/** every runnable example: each .eg under examples/ that is not inside a lib/ folder */
function examplesOf(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'lib') walk(full); }
      else if (e.name.endsWith('.eg')) out.push(full);
    }
  })(dir);
  return out.sort();
}

/** run file.eg both ways against the build in dir; returns problems */
function parity(file, dir, mode, tmp) {
  const env = { EMERGE_BUILD: dir };
  const eg = path.join(LANG, 'eg.js');
  const outDir = path.join(tmp, path.basename(file, '.eg') + '_' + mode + '_' + sha(file).slice(0, 6));
  const b = node([eg, 'build', file, '-o', outDir], env);
  if (b.status !== 0) return { problems: [`${path.relative(LANG, file)}: build failed\n${b.stderr}`], run: null };
  const la = path.join(outDir, 'a.ledger.json'), lb = path.join(outDir, 'b.ledger.json');
  const flags = mode === 'test' ? ['--test'] : [];
  const a = node([eg, mode, file, '--ledger', la], env);
  const c = node([path.join(outDir, path.basename(file).replace(/\.eg$/, '.js')), ...flags, '--ledger', lb], env);
  const p = [];
  const rel = path.relative(LANG, file);
  if (a.stdout !== c.stdout) p.push(`${rel}: stdout differs between interpreter and compiled`);
  if (a.stderr !== c.stderr) p.push(`${rel}: stderr differs between interpreter and compiled\n--- interpreter\n${a.stderr}--- compiled\n${c.stderr}`);
  if (a.status !== c.status) p.push(`${rel}: exit ${a.status} interpreted, ${c.status} compiled`);
  if (fs.existsSync(la) && fs.existsSync(lb) && fs.readFileSync(la, 'utf8') !== fs.readFileSync(lb, 'utf8')) p.push(`${rel}: ledgers differ`);
  return { problems: p, run: a };
}

/** bootstrap({ strict, log }) → { ok, build, checks } — throws an Error with .stage/.problems when a stage fails. */
function bootstrap(opts = {}) {
  const log = opts.log || (() => {});
  const report = [];
  const next = path.join(BUILD, 'next');
  fs.rmSync(next, { recursive: true, force: true });
  fs.mkdirSync(next, { recursive: true });
  const srcs = {};
  for (const f of SOURCES) {
    const p = path.join(CORE, f);
    if (!fs.existsSync(p)) throw fail('QUARANTINE', [`core/${f} is missing`], report);
    srcs[f] = fs.readFileSync(p, 'utf8');
  }

  // ── QUARANTINE 1: primitives, evaluated before any primitive exists ──────────────────────────────────────────────
  log('quarantine  core/primitives.eg → build/next/primitives.json');
  let P;
  try {
    build.setMode({ primitives: build.SEED, prelude: null });
    const r = compileOrFail('primitives.eg', srcs['primitives.eg'], 'QUARANTINE primitives.eg', report);
    const bad = r.program.items.filter(i => i.type !== 'Let');
    if (bad.length) throw fail('QUARANTINE primitives.eg', bad.map(i => `primitives.eg:${i.line}: only let declarations of data belong here (found ${i.type})`), report);
    const rt = createRuntime({ file: 'primitives.eg', prelude: false, out: () => {}, err: () => {} });
    const interp = createInterpreter(rt, 'primitives.eg');
    let env;
    try { env = interp.runProgram(r.program, path.join(CORE, 'primitives.eg')); }
    catch (e) { throw fail('QUARANTINE primitives.eg', [rt.toError(e).message], report); }
    P = JSON.parse(JSON.stringify(interp.exportsOf(r.program, env)));
  } finally { build.reset(); }
  const problems = validatePrimitives(P);
  if (problems.length) throw fail('PROVE primitives schema', problems.map(p => `primitives.eg: ${p}`), report);
  fs.writeFileSync(path.join(next, 'primitives.json'), JSON.stringify(P, null, 2) + '\n');
  report.push('primitives: schema ok');

  // ── QUARANTINE 2: the prelude, against the new primitives, natives only ─────────────────────────────────────────
  log('quarantine  core/prelude.eg → build/next/prelude.js');
  let preludeNames, replaced;
  try {
    build.setMode({ primitives: P, prelude: null });
    const nativeNames = Object.keys(createRuntime({ prelude: false, out: () => {}, err: () => {} }).b);
    const r = compileOrFail('<prelude>', srcs['prelude.eg'], 'QUARANTINE prelude.eg', report);
    const bad = r.program.items.filter(i => i.type !== 'FnDecl' && i.type !== 'Let');
    if (bad.length) throw fail('QUARANTINE prelude.eg', bad.map(i => `prelude.eg:${i.line}: the prelude holds fn declarations and lets only (found ${i.type})`), report);
    let req = path.relative(next, path.join(LANG, 'runtime.js')).split(path.sep).join('/');
    if (!path.isAbsolute(req) && !/^[A-Za-z]:/.test(req) && !req.startsWith('.')) req = './' + req; // cross-drive on Windows: path.relative returns an absolute path
    const out = path.join(next, 'prelude.js');
    fs.writeFileSync(out, emitProgram(r.program, { file: '<prelude>', runtimeRequire: req }));
    // it must load
    build.setMode({ primitives: P, prelude: out });
    delete require.cache[require.resolve(out)];
    let rt;
    try { rt = createRuntime({ out: () => {}, err: () => {} }); }
    catch (e) { throw fail('PROVE prelude loads', [e.message], report); }
    preludeNames = r.program.items.filter(i => i.type === 'FnDecl' && !i.name.startsWith('_')).map(i => i.name);
    replaced = preludeNames.filter(n => nativeNames.includes(n));
    void rt;
  } finally { build.reset(); }
  report.push(`prelude: ${preludeNames.length} builtins (${replaced.length} replace natives)`);

  // ── PROVE: selftest and every example, both backends, against build/next ─────────────────────────────────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emerge-bootstrap-'));
  log('prove       core/selftest.eg in both backends');
  const st = parity(path.join(CORE, 'selftest.eg'), next, 'test', tmp);
  if (st.problems.length) throw fail('PROVE selftest', st.problems, report);
  if (st.run.status !== 0) throw fail('PROVE selftest', [`core/selftest.eg failed:\n${st.run.stdout}${st.run.stderr}`], report);
  report.push(`selftest: ${(st.run.stdout.match(/^\d+ passed.*$/m) || ['?'])[0]} in both backends`);

  const examples = examplesOf(path.join(LANG, 'examples'));
  log(`prove       ${examples.length} examples, interpreter vs compiled`);
  const exProblems = [];
  for (const f of examples) exProblems.push(...parity(f, next, 'run', tmp).problems);
  if (exProblems.length) throw fail('PROVE examples', exProblems, report);
  report.push(`examples: ${examples.length} identical in both backends`);

  if (opts.strict) {
    log('prove       --strict: the JS test suites against build/next');
    for (const t of ['lang.test.js', 'differential.test.js']) {
      const r = node([path.join(LANG, 'test', t)], { EMERGE_BUILD: next });
      if (r.status !== 0) throw fail(`PROVE ${t}`, [(r.stdout.split('\n').filter(l => l.includes('✗') || /passed/.test(l)).join('\n')) || r.stderr], report);
      report.push(`${t}: ${(r.stdout.match(/\d+ passed, \d+ failed/) || ['?'])[0]}`);
    }
  }

  // ── INTEGRATE ────────────────────────────────────────────────────────────────────────────────────────────────────
  const current = path.join(BUILD, 'current'), previous = path.join(BUILD, 'previous');
  let n = 1;
  try { n = JSON.parse(fs.readFileSync(path.join(current, 'BUILD.json'), 'utf8')).build + 1; } catch (_) { /* first build */ }
  const manifest = {
    emerge: VERSION,
    build: n,
    sources: Object.fromEntries(SOURCES.map(f => [`core/${f}`, srcSha(srcs[f])])),
    outputs: Object.fromEntries(['primitives.json', 'prelude.js'].map(f => [f, sha(fs.readFileSync(path.join(next, f)))])),
    prelude_builtins: preludeNames,
    replaces_natives: replaced,
    checks: report.slice(),
  };
  fs.writeFileSync(path.join(next, 'BUILD.json'), JSON.stringify(manifest, null, 2) + '\n');
  log(`integrate   build ${n} → build/current${n > 1 ? ` (build ${n - 1} kept as build/previous)` : ""}`);
  fs.rmSync(previous, { recursive: true, force: true });
  if (fs.existsSync(current)) fs.renameSync(current, previous);
  fs.renameSync(next, current);
  build.reset();
  // the map follows the build: lang/MAP.md now describes the primitives and library just integrated
  fs.writeFileSync(path.join(LANG, 'MAP.md'), require('./map').generate());
  report.push('MAP.md regenerated');
  fs.rmSync(tmp, { recursive: true, force: true });
  return { ok: true, build: n, checks: report };
}

function rollback() {
  const current = path.join(BUILD, 'current'), previous = path.join(BUILD, 'previous'), swap = path.join(BUILD, 'swap');
  if (!fs.existsSync(previous)) throw new Error('no previous build to roll back to');
  fs.rmSync(swap, { recursive: true, force: true });
  fs.renameSync(current, swap);
  fs.renameSync(previous, current);
  fs.renameSync(swap, previous);
  build.reset();
  return JSON.parse(fs.readFileSync(path.join(current, 'BUILD.json'), 'utf8')).build;
}

/** which core sources changed since the build in use → [] when the build is current */
function status() {
  const dir = build.buildDir();
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'BUILD.json'), 'utf8')); } catch (_) { return { build: null, changed: SOURCES.map(f => `core/${f}`) }; }
  const changed = [];
  for (const f of SOURCES) {
    const p = path.join(CORE, f);
    if (!fs.existsSync(p) || srcSha(fs.readFileSync(p, 'utf8')) !== m.sources[`core/${f}`]) changed.push(`core/${f}`);
  }
  return { build: m.build, changed, manifest: m };
}

module.exports = { bootstrap, rollback, status, validatePrimitives };
