'use strict';
/**
 * compiler/host.js — where a build reports to.
 * UUID: spec-compiler-host-v1-0000-2026-1028-jamesbrooks-001
 * Version: 1.0.0
 *
 * §2026-10-28 — James: "don't couple to nexus. it's what i want all my projects to be built from. everything from the
 * ground up." Emerge depends on nothing above it. The compiler used to call Cortex (preflight, writeback) and Idearium
 * (sync) directly; now it calls a host. Emerge ships one host, `local`. Any other host is a module outside emerge/ that
 * a project passes in from its own repo (Nexus keeps one in its repo). Emerge never requires it.
 *
 * A host is an object with:
 *   name                                   string
 *   ping()                         → { reachable, status }
 *   preflight({ moduleName, specPath, outputDir }) → PreflightResult  (existingFiles, openGaps, skipGeneration, summary …)
 *   writeback(compileResult, specPath, opts)       → { ok, host, errors, … }
 *   sync(compileResult)                    → { ok, skipped?, summary }
 *   summarize(report)                      → string
 * Every method is optional except name; a missing one behaves like the local host's.
 *
 * The local host needs no network. Its record of a build is a JSON file in the output folder:
 *   <outputDir>/.emerge/build/<spec name>.json — spec hash, every emitted file with its SHA-256, the plan, the gaps.
 * No wall clock is written (CIE-EG 4.9), so the same spec and the same files give the same bytes.
 *
 * Zero dependencies beyond node. Zero LLM calls.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

const EMPTY_PREFLIGHT = {
  ok: true, project: null, existingFiles: [], openGaps: [], seamRecords: [], memory: [], crystals: [],
  skipGeneration: false, staleFiles: [],
};

const local = {
  name: 'local',

  async ping() { return { reachable: true, status: 'local' }; },

  // The output folder is the record: generated-file protection lives in the emitters (GENERATED_MARK),
  // so nothing needs to be skipped here. The previous build record, if any, is reported for context.
  async preflight({ moduleName, outputDir }) {
    const rec = recordPath(outputDir, moduleName);
    const had = rec && fs.existsSync(rec);
    return { ...EMPTY_PREFLIGHT, host: 'local', moduleName,
      summary: had ? `local host: previous build record at ${path.relative(outputDir, rec)}` : 'local host: no previous build record' };
  },

  async writeback(compileResult, specPath) {
    const outputDir = compileResult.outputDir;
    const name = compileResult.moduleName ?? path.basename(specPath ?? 'spec', '.spec');
    const errors = [];
    if (!outputDir) return { ok: false, host: 'local', errors: ['no outputDir'] };
    const files = [...new Set([...(compileResult.t0?.emitted ?? []), ...(compileResult.t1?.emitted ?? [])])].sort().map(rel => {
      try { return { path: rel, sha256: sha256(fs.readFileSync(path.join(outputDir, rel))) }; }
      catch (e) { errors.push(`${rel}: ${e.message}`); return { path: rel, sha256: null }; }
    });
    const plan = compileResult.executionPlan;
    const record = {
      spec: specPath ? path.relative(outputDir, path.resolve(specPath)) : null,
      spec_sha256: specPath && fs.existsSync(specPath) ? sha256(fs.readFileSync(specPath)) : null,
      module: name,
      files,
      plan: plan ? {
        counts: plan.counts,
        run:   (plan.run ?? []).map(x => ({ name: x.name, tier: x.tier })),
        defer: (plan.defer ?? []).map(x => ({ name: x.name, reason: x.reason })),
        skip:  (plan.skip ?? []).map(x => ({ name: x.name, reason: x.reason })),
        block: (plan.block ?? []).map(x => ({ name: x.name, reason: x.reason })),
      } : null,
      gaps: (compileResult.gapField?.gaps ?? []).map(g => ({ node: g.nodeId, type: g.type, severity: g.severity, description: g.description })),
      ...(compileResult.t2 ? { t2: { model: compileResult.t2.model, results: (compileResult.t2.results ?? []).map(x => ({
        module: x.node, status: x.status, file: x.outPath ? path.relative(outputDir, x.outPath) : null, error: x.error ?? null })) } } : {}),
    };
    const file = recordPath(outputDir, name);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
    } catch (e) { errors.push(e.message); }
    return { ok: errors.length === 0, host: 'local', record: file, filesRecorded: files.map(f => f.path), errors };
  },

  async sync() { return { ok: true, skipped: true, summary: 'local host: nothing to sync' }; },

  summarize(report) {
    if (!report) return '→ no host report';
    if (report.skipped) return '→ host writeback skipped';
    return [`✓ ${report.filesRecorded?.length ?? 0} file(s) recorded`, report.record ? `  record: ${report.record}` : '',
      report.errors?.length ? `⚠ ${report.errors.length} error(s)` : ''].filter(Boolean).join('\n');
  },
};

function recordPath(outputDir, name) {
  if (!outputDir) return null;
  return path.join(outputDir, '.emerge', 'build', String(name).replace(/[^\w.-]/g, '_') + '.json');
}

/**
 * loadHost(h) → host
 *   h: a host object · a path to a module exporting one (or exporting createHost()) · 'local' · undefined
 *   undefined → process.env.EMERGE_HOST if set, else the local host.
 */
function loadHost(h) {
  if (h === undefined || h === null || h === '') h = process.env.EMERGE_HOST || 'local';
  if (h === 'local') return local;
  if (typeof h === 'string') {
    const mod = require(path.resolve(h));
    h = typeof mod.createHost === 'function' ? mod.createHost() : (mod.host ?? mod);
  }
  if (!h || typeof h !== 'object' || !h.name) throw new Error('host must be an object with a name (see emerge/compiler/host.js)');
  return {
    name: h.name,
    ping:      h.ping      ? h.ping.bind(h)      : local.ping,
    preflight: h.preflight ? h.preflight.bind(h) : local.preflight,
    writeback: h.writeback ? h.writeback.bind(h) : local.writeback,
    sync:      h.sync      ? h.sync.bind(h)      : local.sync,
    summarize: h.summarize ? h.summarize.bind(h) : local.summarize,
  };
}

module.exports = { local, loadHost, recordPath, EMPTY_PREFLIGHT, MODULE_ID: 'spec-compiler-host', VERSION: '1.0.0' };
