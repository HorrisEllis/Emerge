'use strict';
/**
 * cortex-query.js — CORTEX_QUERY_SEAM implementation (compiler side)
 * UUID: spec-compiler-cortex-query-v1-0000-0001
 * Version: 1.0.0
 *
 * Implements every command declared in CORTEX_QUERY_SEAM.
 * All queries are read-only. Cortex is never mutated through this module.
 * Unreachability is non-fatal: fallback = assume_empty + gap logged locally.
 *
 * §1.1  Nothing exists until Cortex confirms it.
 * §1.2  Every failure is typed and returned, never thrown to caller.
 * §2.1  Cortex is the truth. Query first. Always.
 */

const http = require('http');

const CORTEX_PORT    = parseInt(process.env.NEXUS_PORT   || '3748');
const CORTEX_HOST    = process.env.NEXUS_HOST             || '127.0.0.1';
const DEFAULT_TIMEOUT = 3000;

// ── HTTP primitives ───────────────────────────────────────────────────────────

function httpGet(path, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: CORTEX_HOST, port: CORTEX_PORT, path, timeout: timeoutMs },
      (res) => {
        let raw = '';
        res.on('data', d => { raw += d; });
        res.on('end', () => {
          try   { resolve({ ok: true, data: JSON.parse(raw), status: res.statusCode }); }
          catch { resolve({ ok: true, data: raw, status: res.statusCode }); }
        });
      }
    );
    req.on('error',   (e) => resolve({ ok: false, error: e.message, code: 'CORTEX_UNREACHABLE' }));
    req.on('timeout', ()  => { req.destroy(); resolve({ ok: false, error: 'timeout', code: 'CORTEX_UNREACHABLE' }); });
  });
}

function httpPost(path, body, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req  = http.request({
      hostname: CORTEX_HOST, port: CORTEX_PORT, path, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try   { resolve({ ok: true, data: JSON.parse(raw), status: res.statusCode }); }
        catch { resolve({ ok: true, data: raw, status: res.statusCode }); }
      });
    });
    req.on('error',   (e) => resolve({ ok: false, error: e.message, code: 'CORTEX_UNREACHABLE' }));
    req.on('timeout', ()  => { req.destroy(); resolve({ ok: false, error: 'timeout', code: 'CORTEX_UNREACHABLE' }); });
    req.write(data);
    req.end();
  });
}

// ── Empty-result shapes (fallback when Cortex is unreachable) ─────────────────

const EMPTY = {
  project:        null,
  existingFiles:  [],
  openGaps:       [],
  seamRecords:    [],
  memory:         [],
  crystals:       [],
  skipGeneration: false,
  staleFiles:     [],
  summary:        'cortex_unreachable — assumed empty',
};

function unreachableResult(extra = {}) {
  return {
    ok:             false,
    code:           'CORTEX_UNREACHABLE',
    fallback:       'assume_empty',
    ...EMPTY,
    ...extra,
  };
}

// ── Individual query commands ─────────────────────────────────────────────────

/**
 * Does this module exist in project_registry?
 * GET /api/projects → filter by name
 */
async function queryProject(name) {
  const res = await httpGet('/api/projects');
  if (!res.ok) return unreachableResult({ exists: false, uuid: null, version: null, lastSeenAt: null });

  const projects = Array.isArray(res.data) ? res.data : (res.data?.projects ?? []);
  const found    = projects.find(p => p.name === name || p.id === name);

  return {
    ok:         true,
    exists:     !!found,
    uuid:       found?.uuid       ?? null,
    version:    found?.version    ?? null,
    lastSeenAt: found?.lastSeenAt ?? null,
  };
}

/**
 * What files does Cortex have for this project?
 * GET /api/files → filter by project
 */
async function queryFiles(project) {
  const res = await httpGet(`/api/files`);
  if (!res.ok) return unreachableResult({ files: [] });

  const all   = Array.isArray(res.data) ? res.data : (res.data?.files ?? []);
  const files = all.filter(f => f.project === project || f.name?.startsWith(project + '/'));

  return { ok: true, files };
}

/**
 * What open gaps exist for this path/module?
 * GET /api/gaps → filter by path prefix
 */
async function queryGaps(path, severity = null) {
  const res = await httpGet('/api/gaps');
  if (!res.ok) return unreachableResult({ gaps: [] });

  const all  = Array.isArray(res.data) ? res.data : (res.data?.gaps ?? []);
  const gaps = all.filter(g => {
    if (g.status === 'resolved') return false;
    if (!g.path?.includes(path)) return false;
    if (severity && g.severity !== severity) return false;
    return true;
  });

  return { ok: true, gaps };
}

/**
 * What seam records exist for a named seam?
 * GET /api/memory?table=seam_records → filter by name
 */
async function querySeams(name) {
  const res = await httpGet(`/api/memory?table=seam_records&n=100`);
  if (!res.ok) return unreachableResult({ records: [], verified: false });

  const all     = Array.isArray(res.data) ? res.data : (res.data?.rows ?? []);
  const records = all.filter(r => r.name === name || r.seamName === name);
  const verified = records.some(r => r.verified === true);

  return { ok: true, records, verified };
}

/**
 * What does Cortex memory say about a term?
 * POST /api/memory/search { q }
 * Also GET /api/memory?table=crystals → filter by content match
 */
async function queryMemory(q) {
  const [memRes, crystalRes] = await Promise.all([
    httpPost('/api/memory/search', { q }),
    httpGet(`/api/memory?table=crystals&n=50`),
  ]);

  const results  = memRes.ok    ? (Array.isArray(memRes.data)    ? memRes.data    : (memRes.data?.results    ?? [])) : [];
  const rawCryst = crystalRes.ok? (Array.isArray(crystalRes.data)? crystalRes.data: (crystalRes.data?.rows   ?? [])) : [];
  const crystals = rawCryst.filter(c => c.content?.toLowerCase().includes(q.toLowerCase()));

  return { ok: memRes.ok || crystalRes.ok, results, crystals };
}

// ── PREFLIGHT — the main entry point ─────────────────────────────────────────

/**
 * cortex.query.preflight
 *
 * Full pre-build check. Compiler calls this once per module before generating.
 * Returns a complete picture of what already exists.
 *
 * Decision logic:
 *   skipGeneration = true  → all target files exist in versionium AND no open high gaps
 *   staleFiles             → files that exist but spec is newer than file.createdAt
 *   openGaps               → surfaced to chunk, not blocking (compiler generates with context)
 */
async function preflight({ moduleName, specPath, outputDir }) {
  // Run all queries in parallel — don't serialize what doesn't depend on each other
  const [projectRes, filesRes, gapsRes, seamsRes, memoryRes] = await Promise.all([
    queryProject(moduleName),
    queryFiles(moduleName),
    queryGaps(moduleName),
    querySeams(moduleName),
    queryMemory(moduleName),
  ]);

  const cortexReachable = projectRes.ok || filesRes.ok || gapsRes.ok;

  const project       = projectRes.exists ? { uuid: projectRes.uuid, name: moduleName, version: projectRes.version, lastSeenAt: projectRes.lastSeenAt } : null;
  const existingFiles = filesRes.ok  ? filesRes.files   : [];
  const openGaps      = gapsRes.ok   ? gapsRes.gaps     : [];
  const seamRecords   = seamsRes.ok  ? seamsRes.records : [];
  const memory        = memoryRes.ok ? memoryRes.results: [];
  const crystals      = memoryRes.ok ? memoryRes.crystals: [];

  // Determine if we can skip generation entirely
  const highGaps       = openGaps.filter(g => g.severity === 'high');
  const hasExisting    = existingFiles.length > 0;
  const skipGeneration = hasExisting && highGaps.length === 0;

  // Stale = file exists but is older than 1 hour (proxy for spec being newer)
  const oneHourAgo = Date.now() - 3_600_000;
  const staleFiles = existingFiles
    .filter(f => f.createdAt < oneHourAgo)
    .map(f => f.name);

  // Human-readable summary for chunk context
  const lines = [];
  if (!cortexReachable)    lines.push('⚠ Cortex unreachable — assuming empty state');
  if (project)             lines.push(`✓ Project exists: ${moduleName} v${project.version ?? '?'}`);
  else                     lines.push(`✗ Project not found: ${moduleName}`);
  if (existingFiles.length) lines.push(`✓ ${existingFiles.length} file(s) already in versionium`);
  if (openGaps.length)     lines.push(`⚠ ${openGaps.length} open gap(s) — ${highGaps.length} high severity`);
  if (seamRecords.length)  lines.push(`✓ ${seamRecords.length} seam record(s) — verified: ${seamsRes.verified}`);
  if (skipGeneration)      lines.push('→ SKIP: all files present, no high gaps');
  else                     lines.push('→ GENERATE: missing files or open high gaps');

  return {
    ok:             cortexReachable,
    cortexReachable,
    moduleName,
    project,
    existingFiles,
    openGaps,
    seamRecords,
    memory,
    crystals,
    skipGeneration,
    staleFiles,
    summary:        lines.join('\n'),
  };
}

// ── Health check ──────────────────────────────────────────────────────────────

async function ping() {
  const res = await httpGet('/health', 2000);
  if (!res.ok) return { reachable: false, error: res.error };
  return {
    reachable: true,
    status:    res.data?.status ?? 'unknown',
    uptime:    res.data?.uptime ?? 0,
    tables:    res.data?.jaa?.counts ?? {},
  };
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  // CORTEX_QUERY_SEAM commands
  queryProject,
  queryFiles,
  queryGaps,
  querySeams,
  queryMemory,
  preflight,
  ping,

  // Config
  CORTEX_PORT,
  CORTEX_HOST,
};
