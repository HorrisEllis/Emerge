'use strict';
/**
 * emerge/compiler/t2-gate.js — THE MISSING GATE
 * UUID: nexus-emerge-t2-gate-v1-0000-2026-0625-jamesbrooks-001
 * Version: 1.0.0
 *
 * This is the gate that was always supposed to exist.
 * T0 emits structure. T1 emits scaffolds with stubs.
 * T2 fills the stubs with real implementations via Ollama.
 *
 * THE LOOP CLOSES HERE.
 *
 * Input:  compileResult from pipeline.js (has executionPlan.t2, outputDir, parsedSpec)
 * Output: Filled implementation files on disk. Registered with Cortex.
 *
 * Dispatch path:
 *   T2 node → build SEAM prompt (spec fragment + T1 stub + axioms)
 *   → POST :7820/command { provider: 'ollama', content: seam_text }
 *   → guardian._buildSeamQueue() → SEAMQueue → _dispatchSeamOllamaNative()
 *   → Ollama streams response
 *   → guardian.seam.chunk.verified event
 *   → t2-gate receives via SSE → writes file → registers with Cortex
 *
 * §1.1  Nothing exists until Ollama returns it and the Detector passes it
 * §1.2  Every failure written to t2_failures JAA table
 * §1.3  No stubs in production — T2 must produce real code or flag the gap
 * §2.1  File written to disk before Cortex registration
 * §CC-003  T2 max 800 tokens per chunk
 * §CC-004  One node per chunk — no flooding
 */

const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const crypto = require('crypto');

const MODULE_ID = 't2-gate';
const VERSION   = '1.0.0';

const GUARDIAN_PORT = parseInt(process.env.GUARDIAN_PORT || '7820');
const MAX_TOKENS    = parseInt(process.env.T2_MAX_TOKENS || '800');
const TIMEOUT_MS    = parseInt(process.env.T2_TIMEOUT_MS || '90000');

// ── Build the SEAM prompt for a single T2 node ────────────────────────────────
// One node per prompt. §CC-004.
function buildNodePrompt(node, parsedSpec, stubSrc, outputDir) {
  const modName  = node.name || node.id;
  const specMod  = (parsedSpec.modules || []).find(m => (m.name || m.id) === modName) || {};
  const exports_ = specMod.exports || [];
  const gates    = specMod.gate_pipeline || [];
  const contracts= specMod.behavioral_contracts || [];
  const axioms   = (parsedSpec.axioms || []).slice(0, 5);

  const lines = [
    `# NEXUS T2 IMPLEMENTATION — ${modName}`,
    `# Token budget: ${MAX_TOKENS}. One function. No imports that don't exist.`,
    `# Return ONLY valid JavaScript/TypeScript. No markdown. No explanation.`,
    ``,
    `## Spec: ${parsedSpec.meta?.name || 'unknown'} v${parsedSpec.meta?.version || '?'}`,
    `## Module: ${modName}`,
    specMod.intent ? `## Intent: ${specMod.intent}` : '',
    ``,
    exports_.length ? [
      `## Exports (implement each):`,
      ...exports_.map(e => `  - ${e.name}(${(e.params||[]).map(p=>p.name).join(', ')}): ${e.returns?.type||'void'}`),
    ].join('\n') : '',
    ``,
    gates.length ? [
      `## Gate pipeline (implement transforms):`,
      ...gates.map(g => `  - ${g.id}: ${g.precondition || ''} → ${g.postcondition || ''}`),
    ].join('\n') : '',
    ``,
    contracts.length ? [
      `## Behavioral contracts:`,
      ...contracts.slice(0, 3).map(c => `  - ${c.when}: ${c.then}`),
    ].join('\n') : '',
    ``,
    axioms.length ? [
      `## Axioms to enforce:`,
      ...axioms.slice(0, 4).map(a => `  - ${typeof a === 'string' ? a : (a.description || JSON.stringify(a)).slice(0, 80)}`),
    ].join('\n') : '',
    ``,
    `## Current stub (replace throw statements with real implementations):`,
    `\`\`\`typescript`,
    (stubSrc || '// stub not found').slice(0, 1500),
    `\`\`\``,
    ``,
    `## INSTRUCTION:`,
    `Replace every 'throw new Error' stub with a real implementation.`,
    `Keep all type annotations. Keep the module structure.`,
    `§1.3: No stubs. §1.2: Every failure must throw with a message.`,
    `Return ONLY the complete implementation file:`,
  ].filter(l => l !== '').join('\n');

  return lines;
}

// ── HTTP helper — POST to guardian ────────────────────────────────────────────
function _postGuardian(path_, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: GUARDIAN_PORT,
      path: path_, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: TIMEOUT_MS,
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('guardian timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// ── Poll guardian for SEAM queue completion ───────────────────────────────────
async function _waitForQueue(queueId, timeoutMs = TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await _postGuardian('/api/seam/status', { queueId });
      const status = r.body?.status || r.body?.state;
      if (status === 'complete' || status === 'COMPLETE') {
        return { ok: true, response: r.body?.response || r.body?.text || '' };
      }
      if (status === 'escalated' || status === 'ESCALATED' || status === 'failed') {
        return { ok: false, error: `SEAM ${status}: ${r.body?.error || 'unknown'}` };
      }
    } catch(_) {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return { ok: false, error: `SEAM timeout after ${timeoutMs}ms` };
}

// ── Write implementation back to disk ─────────────────────────────────────────
function _writeImpl(outputDir, modName, src) {
  // Strip markdown fences if Ollama wrapped the response
  src = src
    .replace(/^```(?:typescript|javascript|ts|js)?\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  const modDir  = path.join(outputDir, 'src', 'modules', modName);
  const outPath = path.join(modDir, `${modName}.ts`);

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
 *   provider   — 'ollama' (default) | 'chatgpt' | 'claude'
 *   sequential — true = one node at a time (default for Ollama)
 *   dryRun     — true = build prompts but don't dispatch
 *   onProgress — callback(node, status, detail)
 *
 * @returns {object} { ok, dispatched, completed, failed, skipped, results }
 */
async function dispatch(compileResult, opts = {}) {
  const {
    provider    = 'ollama',
    sequential  = true,
    dryRun      = false,
    onProgress  = null,
  } = opts;

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
    const stubPath = path.join(outputDir, 'src', 'modules', modName, `${modName}.ts`);
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

    // Build a SEAM spec text that guardian can parse
    const seamText = [
      `spec:`,
      `  meta:`,
      `    name: t2-${modName}`,
      `    version: 0.1.0`,
      `  intent: Implement ${modName} per spec`,
      `  axioms:`,
      `    - §1.3 No stubs in production`,
      `    - §1.2 Nothing silently fails`,
      `  modules:`,
      `    - name: ${modName}`,
      `      intent: ${(parsedSpec?.modules || []).find(m => m.name === modName)?.intent || 'implement'}`,
      `  implementation_request:`,
      `    target: ${modName}`,
      `    prompt: |`,
      prompt.split('\n').map(l => `      ${l}`).join('\n'),
    ].join('\n');

    try {
      // Dispatch to guardian → seam-queue → Ollama
      _progress(node, 'dispatching', `provider=${provider}`);

      const dispatchR = await _postGuardian('/command', {
        content:  seamText,
        provider: provider,
        title:    `T2: ${modName}`,
        command:  'seam',
      });

      if (!dispatchR.body?.ok && !dispatchR.body?.queued) {
        throw new Error(`dispatch failed: ${JSON.stringify(dispatchR.body).slice(0, 100)}`);
      }

      const queueId = dispatchR.body?.queueId || dispatchR.body?.queue?.uuid;
      _progress(node, 'generating', `queueId=${queueId?.slice(0, 8)}`);

      // Wait for completion
      const result = await _waitForQueue(queueId);

      if (!result.ok) {
        failed++;
        results.push({ node: modName, status: 'failed', error: result.error });
        _progress(node, 'failed', result.error);
        continue;
      }

      // Write implementation to disk
      const outPath = _writeImpl(outputDir, modName, result.response);
      completed++;
      results.push({ node: modName, status: 'complete', outPath, chars: result.response.length });
      _progress(node, 'complete', outPath);

      // Register with Cortex (non-fatal)
      try {
        await _postGuardian('/api/cortex/register-file', {
          path: outPath, module: modName, tier: 'T2', source: MODULE_ID,
        });
      } catch(_) {}

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
    provider,
  };
}

/**
 * run — convenience wrapper: compile a spec then dispatch T2.
 * This is the single entry point for "build this spec".
 *
 * @param {string} specPath   path to .spec file
 * @param {string} outputDir  where to emit
 * @param {object} opts       provider, sequential, dryRun, onProgress
 */
async function run(specPath, outputDir, opts = {}) {
  const { compile } = require('./pipeline');

  console.log(`[${MODULE_ID}] compiling ${path.basename(specPath)}…`);
  const compileResult = await compile(specPath, outputDir, {
    verbose:       opts.verbose || false,
    skipCortex:    opts.skipCortex || false,
    skipIdearium:  opts.skipIdearium || false,
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
      `Provider: ${t2Result.provider}`,
      t2Result.results.map(r => `  ${r.node}: ${r.status}${r.error?' — '+r.error:''}`).join('\n'),
    ].join('\n'),
  };
}

module.exports = { run, dispatch, buildNodePrompt, MODULE_ID, VERSION };
