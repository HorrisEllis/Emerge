'use strict';
/**
 * idearium/client.js — Idearium push/pull client
 * UUID: spec-compiler-idearium-client-v1-0000-0001
 * Version: 1.0.0
 *
 * Pushes spec-compiler compile results into Idearium as structured ideas.
 * Pulls open ideas back for injection into the compile pipeline.
 *
 * PUSH — after every compile, the following are pushed to Idearium:
 *   1. Execution plan (run/defer/skip/block buckets)
 *   2. Gap field (each gap becomes a tension-tagged idea)
 *   3. Recommendations (human-readable synthesis → vortex log)
 *   4. Baseline trajectory snapshot (sigma regime, trend)
 *
 * PULL — before compile (or on demand), pull:
 *   1. Open ideas tagged spec-compiler (unresolved tensions)
 *   2. Crystals matching current module name
 *   3. Vortex events relevant to this spec
 *
 * IDEARIUM API (expected at IDEARIUM_PORT, default 7820):
 *   POST /api/idea/create      { title, body, tags, tension, source }
 *   GET  /api/idea/list        ?tags=spec-compiler&status=open
 *   POST /api/vortex/log       { event, source, payload }
 *   GET  /api/crystal/search   ?q=moduleName
 *   POST /api/tension/resolve  { ideaId, resolution }
 *
 * §1.1  Idearium unreachability is non-fatal. Compile proceeds without it.
 * §1.2  Every push failure is typed and returned, never thrown.
 * §1.3  Pull results are advisory — compiler does not block on Idearium data.
 */

const http = require('http');

const IDEARIUM_PORT    = parseInt(process.env.IDEARIUM_PORT || '7820');
const IDEARIUM_HOST    = process.env.IDEARIUM_HOST          || '127.0.0.1';
const DEFAULT_TIMEOUT  = 4000;
const SOURCE           = 'spec-compiler';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpGet(path, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: IDEARIUM_HOST, port: IDEARIUM_PORT, path, timeout: timeoutMs },
      (res) => {
        let raw = '';
        res.on('data', d => { raw += d; });
        res.on('end', () => {
          try   { resolve({ ok: true, data: JSON.parse(raw), status: res.statusCode }); }
          catch { resolve({ ok: true, data: raw,             status: res.statusCode }); }
        });
      }
    );
    req.on('error',   (e) => resolve({ ok: false, error: e.message,  code: 'IDEARIUM_UNREACHABLE' }));
    req.on('timeout', ()  => { req.destroy(); resolve({ ok: false, error: 'timeout', code: 'IDEARIUM_UNREACHABLE' }); });
  });
}

function httpPost(path, body, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req  = http.request({
      hostname: IDEARIUM_HOST, port: IDEARIUM_PORT, path, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try   { resolve({ ok: true, data: JSON.parse(raw), status: res.statusCode }); }
        catch { resolve({ ok: true, data: raw,             status: res.statusCode }); }
      });
    });
    req.on('error',   (e) => resolve({ ok: false, error: e.message,  code: 'IDEARIUM_UNREACHABLE' }));
    req.on('timeout', ()  => { req.destroy(); resolve({ ok: false, error: 'timeout', code: 'IDEARIUM_UNREACHABLE' }); });
    req.write(data);
    req.end();
  });
}

// ── Ping ──────────────────────────────────────────────────────────────────────

async function ping() {
  const r = await httpGet('/api/health');
  return { reachable: r.ok && r.status < 500, status: r.status, error: r.error ?? null };
}

// ── Push ──────────────────────────────────────────────────────────────────────

/**
 * pushCompileResult(compileResult) → PushReport
 *
 * Pushes the full compile result into Idearium.
 * Non-fatal — returns a PushReport with per-item outcomes.
 */
async function pushCompileResult(compileResult) {
  const {
    moduleName,
    recommendations = [],
    executionPlan,
    gapField,
    violations,
    tierMap,
    specDepths,
    readiness,
    tokenForecast,
  } = compileResult;

  const report = {
    moduleName,
    pushed: [],
    failed: [],
    skipped: [],
    ts: Date.now(),
  };

  // 1. Push each recommendation as a vortex event
  for (const rec of recommendations) {
    const r = await httpPost('/api/vortex/log', {
      event:   'spec-compiler.recommendation',
      source:  SOURCE,
      module:  moduleName,
      payload: { text: rec, ts: Date.now() },
    });
    if (r.ok) report.pushed.push({ type: 'vortex', text: rec.slice(0, 60) });
    else      report.failed.push({ type: 'vortex', error: r.error, text: rec.slice(0, 40) });
  }

  // 2. Push each gap as a tension-tagged idea
  const gaps = gapField?.gaps ?? [];
  for (const gap of gaps) {
    const tension = gapSeverityToTension(gap.severity);
    const r = await httpPost('/api/idea/create', {
      title:   `[GAP] ${gap.nodeId}: ${gap.type}`,
      body:    gap.description ?? '',
      tags:    [SOURCE, 'gap', gap.type, gap.reason ?? '', moduleName].filter(Boolean),
      tension,
      source:  SOURCE,
      meta: {
        gapId:              gap.gapId,
        nodeId:             gap.nodeId,
        severity:           gap.severity,
        estimatedTokenCost: gap.estimatedTokenCost,
        blockers:           gap.blockers ?? [],
      },
    });
    if (r.ok) report.pushed.push({ type: 'gap-idea', gapId: gap.gapId });
    else      report.failed.push({ type: 'gap-idea', error: r.error, gapId: gap.gapId });
  }

  // 3. Push execution plan summary as a structured idea
  if (executionPlan) {
    const runCount   = executionPlan.run?.length   ?? 0;
    const deferCount = executionPlan.defer?.length  ?? 0;
    const blockCount = executionPlan.block?.length  ?? 0;
    const r = await httpPost('/api/idea/create', {
      title:   `[PLAN] ${moduleName} — ${runCount} ready, ${deferCount} deferred, ${blockCount} blocked`,
      body:    formatExecutionPlan(executionPlan),
      tags:    [SOURCE, 'execution-plan', moduleName],
      tension: blockCount > 0 ? 0.7 : deferCount > 0 ? 0.4 : 0.1,
      source:  SOURCE,
      meta: {
        runCount, deferCount, blockCount,
        skipCount: executionPlan.skip?.length ?? 0,
        tokenForecast: tokenForecast ?? null,
      },
    });
    if (r.ok) report.pushed.push({ type: 'execution-plan' });
    else      report.failed.push({ type: 'execution-plan', error: r.error });
  }

  // 4. Push baseline / readiness snapshot as a vortex event
  if (readiness) {
    const r = await httpPost('/api/vortex/log', {
      event:   'spec-compiler.readiness',
      source:  SOURCE,
      module:  moduleName,
      payload: {
        green:    readiness.green,
        amber:    readiness.amber,
        red:      readiness.red,
        black:    readiness.black,
        blocked:  readiness.blocked,
        specDepths: specDepths ?? [],
        ts: Date.now(),
      },
    });
    if (r.ok) report.pushed.push({ type: 'readiness-vortex' });
    else      report.failed.push({ type: 'readiness-vortex', error: r.error });
  }

  // 5. Push critical violations as high-tension ideas
  const criticalViolations = (violations?.violations ?? []).filter(v => v.severity === 'critical');
  for (const v of criticalViolations) {
    const r = await httpPost('/api/idea/create', {
      title:   `[CRITICAL] ${v.invariantId}: ${v.nodeId ?? 'graph'}`,
      body:    v.message ?? '',
      tags:    [SOURCE, 'invariant-violation', 'critical', moduleName],
      tension: 0.95,
      source:  SOURCE,
      meta:    { invariantId: v.invariantId, nodeId: v.nodeId, severity: 'critical' },
    });
    if (r.ok) report.pushed.push({ type: 'violation-idea', invariantId: v.invariantId });
    else      report.failed.push({ type: 'violation-idea', error: r.error });
  }

  report.summary = `pushed ${report.pushed.length}, failed ${report.failed.length}`;
  return report;
}

// ── Pull ──────────────────────────────────────────────────────────────────────

/**
 * pullForModule(moduleName) → PullResult
 *
 * Pulls open ideas and crystals relevant to this module.
 * Returns advisory data — never blocks compile.
 */
async function pullForModule(moduleName) {
  const result = {
    moduleName,
    openIdeas:   [],
    crystals:    [],
    vortexEvents: [],
    ok:          false,
    error:       null,
  };

  // Open ideas tagged with this module
  const ideasR = await httpGet(`/api/idea/list?tags=${encodeURIComponent(SOURCE)},${encodeURIComponent(moduleName)}&status=open`);
  if (ideasR.ok && Array.isArray(ideasR.data)) {
    result.openIdeas = ideasR.data;
  } else if (ideasR.ok && ideasR.data?.ideas) {
    result.openIdeas = ideasR.data.ideas;
  }

  // Crystals matching module name
  const crystalsR = await httpGet(`/api/crystal/search?q=${encodeURIComponent(moduleName)}`);
  if (crystalsR.ok) {
    result.crystals = crystalsR.data?.crystals ?? crystalsR.data ?? [];
  }

  // Recent vortex events from this module
  const vortexR = await httpGet(`/api/vortex/recent?source=${encodeURIComponent(SOURCE)}&module=${encodeURIComponent(moduleName)}&limit=10`);
  if (vortexR.ok) {
    result.vortexEvents = vortexR.data?.events ?? vortexR.data ?? [];
  }

  result.ok = true;
  return result;
}

/**
 * pullAllOpen() → PullResult
 *
 * Pull all open spec-compiler ideas — full tension ledger.
 * Use for dashboard / status overview.
 */
async function pullAllOpen() {
  const r = await httpGet(`/api/idea/list?tags=${encodeURIComponent(SOURCE)}&status=open`);
  if (!r.ok) return { ok: false, error: r.error, ideas: [] };
  const ideas = r.data?.ideas ?? (Array.isArray(r.data) ? r.data : []);
  return { ok: true, ideas, count: ideas.length };
}

/**
 * resolveIdea(ideaId, resolution) → ResolveResult
 *
 * Mark an open gap/idea as resolved. Called after a node is implemented.
 */
async function resolveIdea(ideaId, resolution) {
  const r = await httpPost('/api/tension/resolve', { ideaId, resolution, source: SOURCE });
  return { ok: r.ok, ideaId, error: r.error ?? null };
}

// ── Full sync: push + pull in one call ───────────────────────────────────────

/**
 * sync(compileResult) → SyncReport
 *
 * Push compile result, pull open ideas, return combined report.
 * Non-fatal — always returns, even if Idearium is down.
 */
async function sync(compileResult) {
  const health = await ping();

  if (!health.reachable) {
    return {
      ok:      false,
      skipped: true,
      reason:  'Idearium unreachable',
      error:   health.error,
      push:    null,
      pull:    null,
    };
  }

  const [push, pull] = await Promise.all([
    pushCompileResult(compileResult),
    pullForModule(compileResult.moduleName),
  ]);

  return {
    ok:   true,
    push,
    pull,
    summary: `pushed ${push.pushed.length} items, pulled ${pull.openIdeas.length} open ideas`,
  };
}

// ── Formatters ────────────────────────────────────────────────────────────────

function gapSeverityToTension(severity) {
  // severity is 0-1 float; tension is Idearium's 0-1 urgency axis
  if (severity >= 0.8) return 0.9;
  if (severity >= 0.6) return 0.7;
  if (severity >= 0.4) return 0.5;
  return 0.3;
}

function formatExecutionPlan(plan) {
  const lines = [];
  const fmt = (arr, label) => {
    if (!arr?.length) return;
    lines.push(`## ${label} (${arr.length})`);
    for (const entry of arr.slice(0, 10)) {
      const name = entry.node?.name ?? entry.id ?? '?';
      const reason = entry.reason ? ` — ${entry.reason.slice(0, 60)}` : '';
      lines.push(`  - ${name}${reason}`);
    }
    if (arr.length > 10) lines.push(`  ... and ${arr.length - 10} more`);
  };
  fmt(plan.run,   'RUN');
  fmt(plan.defer, 'DEFER');
  fmt(plan.block, 'BLOCK');
  fmt(plan.skip,  'SKIP');
  return lines.join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args    = process.argv.slice(2);
  const cmd     = args[0];

  async function run() {
    if (cmd === 'ping') {
      const h = await ping();
      console.log(`Idearium ${h.reachable ? 'reachable' : 'unreachable'} at ${IDEARIUM_HOST}:${IDEARIUM_PORT}`);
      if (h.error) console.log(`  error: ${h.error}`);
      return;
    }

    if (cmd === 'pull') {
      const moduleName = args[1] ?? '';
      const r = moduleName ? await pullForModule(moduleName) : await pullAllOpen();
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === 'push') {
      // Push from a compile result JSON file
      const file = args[1];
      if (!file) { console.error('Usage: node client.js push <compile-result.json>'); process.exit(1); }
      const result = JSON.parse(require('fs').readFileSync(file, 'utf-8'));
      const r = await pushCompileResult(result);
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    console.log('Usage: node client.js [ping|pull [module]|push <file>]');
  }

  run().catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  ping,
  pushCompileResult,
  pullForModule,
  pullAllOpen,
  resolveIdea,
  sync,
};
