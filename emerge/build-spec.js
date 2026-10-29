#!/usr/bin/env node
'use strict';
/**
 * build-spec.js — build any project from its .spec, from the ground up, with nothing but Emerge.
 * UUID: emerge-build-spec-v1-0000-2026-1028-jamesbrooks-001
 * Version: 1.0.0
 *
 *   node build-spec.js <file.spec> --dry-run       plan only: compile into a temp folder, print the plan and open decisions
 *   node build-spec.js <file.spec>                 scaffolds into the build root, a build record in <root>/.emerge/build/
 *   node build-spec.js <file.spec> --build         the same, then T2: a model writes each ready module, checked before it lands
 *
 * Options
 *   --out <dir>        build root (default: meta.build_root, relative to the spec file; else the current folder)
 *   --host <module>    where the build reports (default: the local host — the build record in the build root)
 *   --model <name>     model name for T2 (default qwen2.5-coder:7b, or EMERGE_MODEL)
 *   --api ollama|openai  --url <server>       local model server (default Ollama at http://localhost:11434)
 *   --model-module <module>                   any other model backend (an object with generate(prompt))
 *
 * Emerge depends on nothing above it (CIE-EG section 0). A project that wants its own host or model passes a module;
 * Emerge never imports it. buildSpec() is exported for those projects.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

/** Every decision a spec declares, wherever it keeps them: spec.decisions, or any section's decisions list. */
function decisionsOf(spec) {
  const lists = [spec.decisions, ...Object.values(spec.sections ?? {}).map(s => s && s.decisions)].filter(Array.isArray);
  return lists.flat().filter(d => d && d.id);
}

/** For each open decision: the modules whose build.blocked_by names it. */
function openDecisions(spec) {
  const all = decisionsOf(spec);
  const ids = new Set([...all.filter(d => d.status === 'OPEN').map(d => d.id), ...(spec.modules ?? []).flatMap(m => m.build?.blocked_by ?? [])]);
  return [...ids].map(id => {
    const d = all.find(x => x.id === id) ?? { id, question: '(not declared in the spec)' };
    return { ...d, waiting: (spec.modules ?? []).filter(m => (m.build?.blocked_by ?? []).includes(id)).map(m => m.name ?? m.id) };
  });
}

function buildRoot(specPath, parsedMeta, out) {
  if (out) return path.resolve(out);
  if (parsedMeta?.build_root) return path.resolve(path.dirname(specPath), parsedMeta.build_root);
  return process.cwd();
}

/**
 * buildSpec({ spec, out, dryRun, build, host, model, log }) → { ok, compileResult, decisions, t2, root }
 *   host / model: objects or module paths (compiler/host.js, compiler/model.js); default local host, local Ollama.
 */
async function buildSpec(o) {
  const log = o.log ?? (s => console.log(s));
  const specPath = path.resolve(o.spec);
  if (!fs.existsSync(specPath)) return { ok: false, error: 'spec not found: ' + specPath };

  const yaml = require('js-yaml');
  const { sanitizeSpec, normalizeSpec } = require('./compiler/emit');
  const raw = fs.readFileSync(specPath, 'utf8');
  let doc; try { doc = yaml.load(raw); } catch { doc = yaml.load(sanitizeSpec(raw)); }
  const meta = (doc?.spec ?? doc)?.meta ?? {};

  const root = o.dryRun ? fs.mkdtempSync(path.join(os.tmpdir(), 'emerge-plan-')) : buildRoot(specPath, meta, o.out);
  const { compile } = require('./compiler/pipeline');
  const { loadHost } = require('./compiler/host');
  const host = loadHost(o.host);

  log(`${o.dryRun ? 'PLAN ONLY — ' : ''}${meta.name ?? path.basename(specPath)} v${meta.version ?? '?'} → ${root}   (host: ${host.name})`);
  const r = await compile(specPath, root, { host, tier: 1, skipSync: !!o.dryRun, skipWriteback: !!o.dryRun });
  if (!r.ok) return { ok: false, error: r.error ?? 'compile failed', compileResult: r };

  const plan = r.executionPlan;
  log(`\nplan: ${plan.counts.run} to build, ${plan.counts.defer} deferred, ${plan.counts.skip} done or skipped, ${plan.counts.block} blocked`);
  for (const b of ['run', 'defer', 'skip', 'block']) for (const x of plan[b]) log(`  ${b.padEnd(5)} ${String(x.name).padEnd(14)} ${String(x.tier).padEnd(8)} ${x.reason}`);
  const written = new Set([...r.t0.emitted, ...(r.t1?.emitted ?? [])]);
  const kept = new Set([...r.t0.skipped, ...(r.t1?.skipped ?? [])].filter(s => s.reason === 'exists_not_generated').map(s => s.name));
  log(`\nscaffolds: ${written.size} file(s) written${kept.size ? `, ${kept.size} hand-written file(s) left alone (${[...kept].join(', ')})` : ''}`);

  const decisions = openDecisions(r.parsedSpec);
  if (decisions.length) {
    log(`\nopen decisions (${decisions.length}):`);
    for (const d of decisions) log(`  ${d.id}  ${d.question}${d.waiting.length ? '   — waiting: ' + d.waiting.join(', ') : ''}`);
  }

  let t2 = null;
  if (o.build && !o.dryRun) {
    const { loadModel } = require('./compiler/model');
    const model = loadModel(o.model);
    log(`\nT2 with ${model.name} …`);
    t2 = await require('./compiler/t2-gate').dispatch(r, { model, onProgress: () => {} });
    log(`T2: ${t2.completed ?? 0} written, ${t2.failed ?? 0} failed`);
    for (const x of t2.results ?? []) log(`  ${String(x.node).padEnd(14)} ${x.status}${x.outPath ? '  ' + path.relative(root, x.outPath) : ''}${x.error ? '  ' + String(x.error).slice(0, 140) : ''}`);
    const rec = await host.writeback({ ...r, t2 }, specPath, {});      // the record now includes what T2 did
    if (rec?.record) log(`build record: ${path.relative(root, rec.record)}`);
  } else if (!o.dryRun && r.writeback?.record) {
    log(`build record: ${path.relative(root, r.writeback.record)}`);
  }
  if (o.dryRun) log(`\nnothing written outside ${root}`);
  return { ok: true, compileResult: r, decisions, t2, root };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const val = n => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : undefined; };
  const valued = new Set(['out', 'host', 'model', 'api', 'url', 'model-module']);
  const spec = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && valued.has(argv[i - 1].slice(2))));
  if (!spec) {
    console.log('usage: node build-spec.js <file.spec> [--dry-run] [--build] [--out dir] [--host module] [--model name] [--api ollama|openai] [--url server] [--model-module module]');
    process.exit(1);
  }
  const model = val('model-module') ?? { api: val('api'), url: val('url'), model: val('model') };
  buildSpec({ spec, out: val('out'), dryRun: argv.includes('--dry-run'), build: argv.includes('--build'), host: val('host'), model })
    .then(r => { if (!r.ok) { console.error(r.error); process.exit(1); } })
    .catch(e => { console.error(e.stack || e.message); process.exit(1); });
}

module.exports = { buildSpec, openDecisions, decisionsOf, MODULE_ID: 'emerge-build-spec', VERSION: '1.0.0' };
