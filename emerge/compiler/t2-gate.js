'use strict';
/**
 * emerge/compiler/t2-gate.js — THE MISSING GATE
 * UUID: nexus-emerge-t2-gate-v1-0000-2026-0625-jamesbrooks-001
 * Version: 2.0.0
 *
 * T0 emits structure. T1 emits scaffolds with stubs. T2 fills the stubs with real implementations from a model.
 *
 * §2026-10-28 (2.0.0) — Emerge depends on nothing above it. T2 used to post to Nexus's Guardian (:7820 /command, poll
 * /api/seam/status, register with Cortex). It now calls a model through compiler/model.js:
 *   dispatch(compileResult, { model })   model: an object with generate(prompt, meta), a module path, or settings
 *                                        ({ api: ollama | openai, url, model }); default: local Ollama.
 * Guardian is one model backend, kept in Nexus's repo and passed in.
 *
 * Dispatch path:
 *   T2 node → prompt (spec fragment + T1 stub + axioms, language from the spec) → model.generate → checker (Emerge)
 *   → write the file (or a .t2-rejected / .t2-proposal beside it)
 *
 * §1.1  Nothing exists until the model returns it and the checker passes it
 * §1.2  Every failure is a result entry with its reason, never dropped
 * §1.3  No stubs in production — T2 must produce real code or flag the gap
 * §CC-003  T2 max 800 tokens per chunk
 * §CC-004  One node per chunk — no flooding
 */

const fs     = require('fs');
const path   = require('path');
const { loadModel } = require('./model');
const { isEmergeTarget, modulePaths, EMERGE_CARD } = require('./target');
const { GENERATED_MARK } = require('./emit-emerge');

const MODULE_ID = 't2-gate';
const VERSION   = '1.0.0';

const MAX_TOKENS    = parseInt(process.env.T2_MAX_TOKENS || '800');

// ── Build the SEAM prompt for a single T2 node ────────────────────────────────
// One node per prompt. §CC-004.
function buildNodePrompt(node, parsedSpec, stubSrc, outputDir) {
  const modName  = node.name || node.id;
  const specMod  = (parsedSpec.modules || []).find(m => (m.name || m.id) === modName) || {};
  const exports_ = specMod.exports || [];
  const gates    = specMod.gate_pipeline || [];
  const contracts= specMod.behavioral_contracts || [];
  const axioms   = (parsedSpec.axioms || []).slice(0, 5);
  // §2026-10-28 — the spec decides the language (compiler/target.js); spec entries may be strings or objects.
  const emerge   = isEmergeTarget(parsedSpec.meta || {});
  const fence    = emerge ? 'eg' : 'typescript';
  const asText   = (x, f) => typeof x === 'string' ? x : f(x);

  const lines = [
    `# T2 IMPLEMENTATION — ${modName}`,
    `# Token budget: ${MAX_TOKENS}. One function. No imports that don't exist.`,
    emerge ? `# Return ONLY valid Emerge (.eg). No markdown. No explanation. Never JavaScript or TypeScript.`
           : `# Return ONLY valid JavaScript/TypeScript. No markdown. No explanation.`,
    emerge ? EMERGE_CARD : '',
    ``,
    `## Spec: ${parsedSpec.meta?.name || 'unknown'} v${parsedSpec.meta?.version || '?'}`,
    `## Module: ${modName}`,
    specMod.intent ? `## Intent: ${specMod.intent}` : '',
    ``,
    exports_.length ? [
      `## Exports (implement each):`,
      ...exports_.map(e => `  - ${asText(e, e => `${e.name}(${(e.params||[]).map(p=>p.name).join(', ')}): ${e.returns?.type||'void'}`)}`),
    ].join('\n') : '',
    ``,
    gates.length ? [
      `## Gate pipeline (implement transforms):`,
      ...gates.map(g => `  - ${asText(g, g => `${g.id}: ${g.precondition || ''} → ${g.postcondition || ''}`)}`),
    ].join('\n') : '',
    ``,
    contracts.length ? [
      `## Behavioral contracts:`,
      ...contracts.slice(0, emerge ? 8 : 3).map(c => `  - ${asText(c, c => `${c.when}: ${c.then}`)}`),
    ].join('\n') : '',
    ``,
    axioms.length ? [
      `## Axioms to enforce:`,
      ...axioms.slice(0, 4).map(a => `  - ${typeof a === 'string' ? a : (a.description || JSON.stringify(a)).slice(0, 80)}`),
    ].join('\n') : '',
    ``,
    `## Current stub (replace throw statements with real implementations):`,
    '```' + fence,
    (stubSrc || '// stub not found').slice(0, 1500),
    `\`\`\``,
    ``,
    `## INSTRUCTION:`,
    ...(emerge ? [
      `Replace every raise("... not implemented ...") stub with a real implementation.`,
      `Keep the fn names and parameters. Remove the first line (the GENERATED marker).`,
      `§1.3: No stubs. §1.2: Nothing fails silently: refuse with raise(...) or record a gap, never return a made-up value.`,
    ] : [
      `Replace every 'throw new Error' stub with a real implementation.`,
      `Keep all type annotations. Keep the module structure.`,
      `§1.3: No stubs. §1.2: Every failure must throw with a message.`,
    ]),
    `Return ONLY the complete implementation file:`,
  ].filter(l => l !== '').join('\n');

  return lines;
}

// ── Write implementation back to disk ─────────────────────────────────────────
function _writeImpl(outputDir, modName, src, parsedSpec = {}) {
  // Strip markdown fences if Ollama wrapped the response
  src = src
    .replace(/^```(?:typescript|javascript|ts|js|eg|emerge)?\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  // §2026-10-28 — the path follows the spec's language and build plan (compiler/target.js)
  const specMod = (parsedSpec.modules || []).find(m => (m.name || m.id) === modName) || { name: modName };
  let   outPath = path.join(outputDir, modulePaths(specMod, parsedSpec.meta || {}).impl);
  // Never overwrite code a person or an earlier run wrote: only a file still carrying the generator's mark is replaced.
  // Otherwise the result goes beside it as <file>.t2-proposal.<ext> for review.
  // (Emerge targets only: TypeScript stubs predate the mark, and their behaviour is unchanged.)
  if (isEmergeTarget(parsedSpec.meta || {}) && fs.existsSync(outPath) && !fs.readFileSync(outPath, 'utf8').startsWith(GENERATED_MARK)) {
    outPath = outPath.replace(/(\.[a-z]+)$/, '.t2-proposal$1');
  }
  const modDir  = path.dirname(outPath);

  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(outPath, src, 'utf8');
  return outPath;
}

// ── Main: dispatch T2 nodes ───────────────────────────────────────────────────
/**
 * dispatch — take a compileResult and run T2 generation for all ready nodes.
 *
 * @param {object} compileResult   from pipeline.js compile()
 * @param {object} opts
 *   model      — model object { generate(prompt, meta) }, a module path, or settings { api, url, model }
 *                (default: local Ollama, compiler/model.js)
 *   sequential — true = one node at a time (the only mode; kept for callers)
 *   dryRun     — true = build prompts but don't dispatch
 *   onProgress — callback(node, status, detail)
 *
 * @returns {object} { ok, dispatched, completed, failed, skipped, results }
 */
async function dispatch(compileResult, opts = {}) {
  const {
    sequential  = true,
    dryRun      = false,
    onProgress  = null,
  } = opts;
  const model = dryRun ? null : loadModel(opts.model);

  const { executionPlan, parsedSpec, outputDir } = compileResult;

  if (!executionPlan) return { ok: false, error: 'no executionPlan in compileResult' };

  const t2Nodes = executionPlan.t2 || executionPlan.run?.filter(n => n.tier === 'T2') || [];
  if (!t2Nodes.length) {
    return { ok: true, dispatched: 0, completed: 0, failed: 0, skipped: 0,
      message: 'No T2 nodes in execution plan — all nodes are T0/T1 or deferred' };
  }

  const results = [];
  let completed = 0, failed = 0;

  const _progress = (node, status, detail) => {
    console.log(`[${MODULE_ID}] ${node.name} → ${status}${detail ? ': ' + detail : ''}`);
    if (onProgress) onProgress(node, status, detail);
  };

  // Process nodes sequentially (Ollama can only handle one at a time efficiently)
  for (const node of t2Nodes) {
    const modName = node.name || node.id;
    _progress(node, 'starting');

    // Read the T1 stub that was emitted
    const specMod  = ((parsedSpec || {}).modules || []).find(m => (m.name || m.id) === modName) || { name: modName };
    const stubPath = path.join(outputDir, modulePaths(specMod, (parsedSpec || {}).meta || {}).impl);
    let stubSrc = '';
    try { stubSrc = fs.readFileSync(stubPath, 'utf8'); }
    catch(_) { stubSrc = '// stub not found — T0 may not have run yet'; }

    // Build the SEAM prompt
    const prompt = buildNodePrompt(node, parsedSpec || {}, stubSrc, outputDir);

    if (dryRun) {
      results.push({ node: modName, status: 'dry_run', prompt: prompt.slice(0, 200) });
      _progress(node, 'dry_run', `${prompt.split('\n').length} lines`);
      continue;
    }

    try {
      _progress(node, 'generating', model.name);
      const gen = await model.generate(prompt, { module: modName, spec: (parsedSpec || {}).meta?.name, outputDir });
      if (!gen.ok) {
        failed++;
        results.push({ node: modName, status: 'failed', error: gen.error });
        _progress(node, 'failed', gen.error);
        continue;
      }
      const result = { response: String(gen.text ?? '') };

      // §2026-10-28 — Emerge targets: the answer must pass the Emerge checker before it replaces anything.
      // A failing answer is kept beside the scaffold as <file>.t2-rejected.eg with the checker's message, and counted failed.
      if (isEmergeTarget((parsedSpec || {}).meta || {})) {
        const clean = result.response.replace(/^```(?:eg|emerge)?\n?/m, '').replace(/\n?```\s*$/m, '').trim();
        let err = null;
        try { const c = require('../lang').compileSource(clean, modName + '.eg'); if (c.errors.length) err = String(c.errors[0].message ?? c.errors[0]); }
        catch (e) { err = e.message; }
        if (err) {
          const rej = stubPath.replace(/(\.[a-z]+)$/, '.t2-rejected$1');
          fs.mkdirSync(path.dirname(rej), { recursive: true });
          fs.writeFileSync(rej, `// T2 answer rejected by the Emerge checker: ${err.replace(/\n/g, ' ')}\n` + clean + '\n', 'utf8');
          failed++;
          results.push({ node: modName, status: 'rejected', error: err, outPath: rej });
          _progress(node, 'rejected', err);
          continue;
        }
      }

      // Write implementation to disk
      const outPath = _writeImpl(outputDir, modName, result.response, parsedSpec || {});
      completed++;
      results.push({ node: modName, status: 'complete', outPath, chars: result.response.length });
      _progress(node, 'complete', outPath);

    } catch(e) {
      failed++;
      results.push({ node: modName, status: 'error', error: e.message });
      _progress(node, 'error', e.message);
    }
  }

  return {
    ok: failed === 0,
    dispatched: t2Nodes.length,
    completed,
    failed,
    skipped: t2Nodes.length - completed - failed,
    results,
    model: model ? model.name : null,
  };
}

/**
 * run — convenience wrapper: compile a spec then dispatch T2.
 * This is the single entry point for "build this spec".
 *
 * @param {string} specPath   path to .spec file
 * @param {string} outputDir  where to emit
 * @param {object} opts       model, host, dryRun, onProgress
 */
async function run(specPath, outputDir, opts = {}) {
  const { compile } = require('./pipeline');

  console.log(`[${MODULE_ID}] compiling ${path.basename(specPath)}…`);
  const compileResult = await compile(specPath, outputDir, {
    verbose:       opts.verbose || false,
    skipCortex:    opts.skipCortex || false,
    skipIdearium:  opts.skipIdearium || false,
    host:          opts.host,
  });

  if (!compileResult.ok) {
    return { ok: false, stage: 'compile', error: compileResult.error, compileResult };
  }

  const plan = compileResult.executionPlan;
  const t2Count = plan?.t2?.length || 0;

  console.log(`[${MODULE_ID}] compile OK — ${t2Count} T2 nodes to implement`);
  if (opts.onProgress) opts.onProgress(null, 'compiled', `${t2Count} T2 nodes`);

  if (t2Count === 0) {
    return { ok: true, stage: 'compile_only', compileResult,
      message: plan?.summarize?.() || 'No T2 nodes — compile complete' };
  }

  const t2Result = await dispatch(compileResult, opts);

  return {
    ok:            t2Result.ok && compileResult.ok,
    stage:         'complete',
    compileResult,
    t2Result,
    summary: [
      `Compiled: ${compileResult.moduleName}`,
      `T2 nodes: ${t2Count} dispatched · ${t2Result.completed} complete · ${t2Result.failed} failed`,
      `Model: ${t2Result.model}`,
      t2Result.results.map(r => `  ${r.node}: ${r.status}${r.error?' — '+r.error:''}`).join('\n'),
    ].join('\n'),
  };
}

module.exports = { run, dispatch, buildNodePrompt, MODULE_ID, VERSION };
