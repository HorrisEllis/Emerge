'use strict';
// lib/compiler.js — component emerge.compiler, capability emerge.compiler.spec: Emerge's spec compiler through the system's door.
// EAS4 L1 (Nexus docs/2026-10-31-emerge-as-a-system-phasemap.spec EAS4, EAS_D5). James, 2026-11-05: "One primitive per gate. Compounds,
// each layer." Its command is a node (data/nodes/command/emerge.compiler.compile.command, its expectation in the node), served at
// POST /compiler/compile; this file is only what it runs.
//
// A caller in another system cannot share a folder with Emerge, so the spec comes in as text and the emitted files go back as text.
// Each call writes the spec into a fresh work folder, runs compiler/index.js compile() there on the local host (compiler/host.js: no
// network, no Cortex, "Emerge depends on nothing above it", 2026-10-28), reads back every file it emitted, and removes the folder.
// A host's preflight or writeback above Emerge (Cortex's) is the caller's to do around this call, not Emerge's.
const fs = require('fs');
const os = require('os');
const path = require('path');

function _bad(field) { return Object.assign(new Error(`missing ${field}`), { status: 400 }); }

/** POST /compiler/compile { spec, name?, tier?, host?, skipWriteback? } -> { ok, files, t0, t1, cortex?, writeback?, ms } | { ok:false, error, step }
 *  host: route settings (EAS_D9, as /compiler/build); without one it runs on the local host (no preflight, no writeback) */
async function compile(args = {}) {
  if (typeof args.spec !== 'string' || !args.spec.trim()) throw _bad('spec (the spec\'s YAML text)');
  const tier = args.tier === 0 ? 0 : 1;
  // checked before anything runs (and before the compiler's narration is silenced): only settings cross the door
  const host = args.host === undefined || args.host === null ? undefined : (typeof args.host === 'object' && !Array.isArray(args.host) ? args.host : (() => { throw _bad('host as settings ({ … routes } — a path or a module is not taken through the door)'); })());
  const name = path.basename(String(args.name || 'spec.spec')).replace(/[^\w.-]/g, '_') || 'spec.spec';
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'emerge-compile-'));
  const t0 = Date.now();
  try {
    const src = path.join(work, name.endsWith('.spec') ? name : `${name}.spec`);
    const out = path.join(work, 'out');
    fs.writeFileSync(src, args.spec);
    const { compile: run } = require('../compiler/index.js');
    const log = console.log; console.log = () => {};   // the compiler narrates; the door answers in JSON only
    let r; try { r = await run(src, out, { tier, skipCortex: !host, host, skipWriteback: !!args.skipWriteback }); } finally { console.log = log; }
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'the compiler did not run', step: (r && r.step) || 'compile', ms: Date.now() - t0 };
    const emitted = (t) => (r[t] && r[t].emitted) || [];
    const files = {};
    for (const rel of [...new Set([...emitted('t0'), ...emitted('t1')])].sort()) files[rel] = fs.readFileSync(path.join(out, rel), 'utf8');
    const safe = (v) => { try { return v == null ? null : JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x))); } catch (_) { return null; } };
    return { ok: true, files, t0: { emitted: emitted('t0') }, t1: { emitted: emitted('t1') }, ...(host ? { cortex: safe(r.cortex), writeback: safe(r.writeback) } : {}), ms: Date.now() - t0 };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* a temp folder left behind is not an error of the call */ }
  }
}

// ── EAS4 L2 build and L3 run (2026-11-05). James: "Emerge calls back by route" (EAS_D9): a request may name a host and a model as routes
// (compiler/host.js routeHost, compiler/model.js api "route"); without them Emerge uses its own (the local host; local Ollama).

function _settings(x, field) {
  if (x === undefined || x === null) return undefined;
  if (typeof x !== 'object' || Array.isArray(x)) throw _bad(`${field} as settings ({ … routes } — a path or a module is not taken through the door)`);
  return x;
}
function _jsonSafe(v) { try { return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x))); } catch (_) { return null; } }

/** _inWork(args, fn) — the spec into a fresh folder; fn(src, out) runs there; every file under out comes back as text */
async function _inWork(args, fn) {
  if (typeof args.spec !== 'string' || !args.spec.trim()) throw _bad('spec (the spec\'s YAML text)');
  const name = path.basename(String(args.name || 'spec.spec')).replace(/[^\w.-]/g, '_') || 'spec.spec';
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'emerge-build-'));
  const t0 = Date.now();
  try {
    const src = path.join(work, name.endsWith('.spec') ? name : `${name}.spec`);
    const out = path.join(work, 'out');
    fs.writeFileSync(src, args.spec);
    const log = console.log; console.log = () => {};
    let r; try { r = await fn(src, out); } finally { console.log = log; }
    const files = {};
    const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
      for (const e of es) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else files[path.relative(out, q).split(path.sep).join('/')] = fs.readFileSync(q, 'utf8'); } };
    walk(out);
    return { ...r, files, ms: Date.now() - t0 };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* a temp folder left behind is not an error of the call */ }
  }
}

/** POST /compiler/build { spec, name?, host?, skipHost? } — the whole pipeline (host preflight → T0/T1 → host writeback and sync) */
async function build(args = {}) {
  const host = _settings(args.host, 'host');
  return _inWork(args, async (src, out) => {
    const tierArg = args.tier === 0 || args.tier === 1 ? args.tier : undefined;   // as the pipeline takes it; left out, its own default
    const r = await require('../compiler/pipeline.js').compile(src, out, { host, skipHost: !!args.skipHost || !host, skipWriteback: !!args.skipWriteback, force: !!args.force, ...(tierArg === undefined ? {} : { tier: tierArg }) });
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'the pipeline did not run', step: (r && r.step) || 'build' };
    const tier = (t) => (r[t] ? { emitted: r[t].emitted || [], failures: _jsonSafe(r[t].failures || []) } : null);
    return { ok: true, skipped: !!r.skipped, moduleName: r.moduleName || null, t0: tier('t0'), t1: tier('t1'), cortex: _jsonSafe(r.cortex), writeback: _jsonSafe(r.writeback), sync: _jsonSafe(r.idearium || r.sync) };
  });
}

/** POST /compiler/run { spec, name?, host?, model?, dryRun? } — compile, then T2 through the model; progress comes back as a list */
async function run(args = {}) {
  const host = _settings(args.host, 'host'), model = _settings(args.model, 'model');
  const progress = [];
  return _inWork(args, async (src, out) => {
    const r = await require('../compiler/t2-gate.js').run(src, out, { host, skipCortex: !host, model, dryRun: !!args.dryRun,
      onProgress: (node, status, detail) => progress.push({ node: node ? (node.name || node.id || null) : null, status, detail: detail ?? null, ts: Date.now() }) });
    const t2 = r.t2Result ? { dispatched: r.t2Result.dispatched, completed: r.t2Result.completed, failed: r.t2Result.failed, skipped: r.t2Result.skipped, model: r.t2Result.model, results: _jsonSafe(r.t2Result.results) } : null;
    return { ok: !!r.ok, stage: r.stage || null, error: r.error || null, summary: r.summary || r.message || null, moduleName: (r.compileResult && r.compileResult.moduleName) || null, t2, progress };
  });
}

/** POST /compiler/check { spec } · cli `check-spec --file <path>` — the spec's knowledge graph (kg-builder), no files written:
 *  { ok, ids: [every non-BLACK node's id and name], black: [ids], nodes } | { ok:false, error }. EAS_D10 (2026-11-05, his: "Idearium, via
 *  the door"): Idearium's phase-specs asks this, through the CLI so it runs with no server up. */
async function check(args = {}) {
  let text = args.spec;
  if ((typeof text !== 'string' || !text.trim()) && typeof args.file === 'string') { try { text = fs.readFileSync(path.resolve(args.file), 'utf8'); } catch (e) { return { ok: false, error: `the spec could not be read: ${e.message}` }; } }
  if (typeof text !== 'string' || !text.trim()) throw _bad('spec (the spec\'s YAML text) or file (its path, on the command line)');
  let raw; try { raw = require('js-yaml').load(text); } catch (e) { return { ok: false, error: `not YAML: ${e.message}` }; }
  const log = console.log; console.log = () => {};
  let r; try { r = require('../compiler/kg-builder.js').build(raw && raw.spec ? raw.spec : raw); } catch (e) { r = { ok: false, error: e.message }; } finally { console.log = log; }
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'kg-builder returned no graph' };
  const nodes = r.graph.nodes instanceof Map ? [...r.graph.nodes.values()] : (r.graph.nodes || []);
  const ids = new Set(), black = [];
  for (const n of nodes) { if (n.isBlack) { black.push(n.id); continue; } ids.add(n.id); if (n.name) ids.add(n.name); }
  return { ok: true, ids: [...ids], black, nodes: nodes.length };
}

module.exports = { compile, build, run, check };
