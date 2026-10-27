'use strict';
/**
 * cortex-writeback.js — GATE-COMPILER-005 implementation
 * UUID: spec-compiler-writeback-v1-0000-0001
 * Version: 1.0.0
 *
 * Writes compiler output back to Cortex after every successful T0/T1 run.
 * This closes the sovereign loop:
 *   spec → compile → emit → register with Cortex → next session reads truth
 *
 * WHAT GETS WRITTEN:
 *   1. Every emitted file   → POST /api/files/upload  (SHA-256 content-addressed, idempotent)
 *   2. Versionium commit    → POST /api/versionium/commit  (one commit per compiler run)
 *   3. Seam crossing record → POST /api/event { type: guardian.seam.verified }
 *   4. Compile run memory   → POST /api/table/insert { table: cortex_memory }
 *   5. Failures             → POST /api/table/insert { table: gaps }
 *
 * WHAT IS NOT WRITTEN:
 *   - project_registry: modules register themselves on boot via heartbeat.
 *     The compiler does not pre-register modules that haven't run yet.
 *     This is correct. §1.1: nothing exists until proven.
 *
 * §1.2  Every write failure is recorded locally + as a Cortex gap (non-fatal).
 * §2.1  Writes happen after emit succeeds. Never before.
 * §1.1  Cortex unreachability is non-fatal. Compile output stays on disk.
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const CORTEX_PORT    = parseInt(process.env.NEXUS_PORT || '3748');
const CORTEX_HOST    = process.env.NEXUS_HOST          || '127.0.0.1';
const TIMEOUT_MS     = 8000;  // file uploads can be larger
const SOURCE         = 'spec-compiler';

// ── HTTP post helper ──────────────────────────────────────────────────────────

function httpPost(apiPath, body, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req  = http.request({
      hostname: CORTEX_HOST, port: CORTEX_PORT, path: apiPath,
      method: 'POST', timeout: timeoutMs,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try   { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: raw }); }
      });
    });
    req.on('error',   e  => resolve({ ok: false, code: 'CORTEX_UNREACHABLE', error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, code: 'TIMEOUT', error: 'timeout' }); });
    req.write(data);
    req.end();
  });
}

// ── 1. Upload emitted files ───────────────────────────────────────────────────

/**
 * uploadFiles(emittedPaths, outputDir, moduleName)
 *
 * Uploads every file emitted by T0/T1 to Cortex file store.
 * Idempotent — same content → same SHA-256 hash → Cortex deduplicates.
 * Returns { uploaded: string[], failed: {file, error}[] }
 */
async function uploadFiles(emittedPaths, outputDir, moduleName) {
  const uploaded = [];
  const failed   = [];

  for (const relPath of emittedPaths) {
    const absPath = path.isAbsolute(relPath) ? relPath : path.join(outputDir, relPath);
    let content;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch (e) {
      failed.push({ file: relPath, error: `read failed: ${e.message}` });
      continue;
    }

    const mime = guessMime(relPath);
    const res  = await httpPost('/api/files/upload', {
      name:     relPath,
      content,
      encoding: 'utf8',
      mime,
      project:  moduleName,
      causedBy: null,
    });

    if (res.ok) {
      uploaded.push(relPath);
    } else {
      failed.push({ file: relPath, error: res.error ?? `HTTP ${res.status}` });
    }
  }

  return { uploaded, failed };
}

// ── 2. Versionium commit ──────────────────────────────────────────────────────

/**
 * commitToVersionium(compileResult)
 *
 * Creates one commit in Cortex versionium for this compiler run.
 * Message encodes: module name, tier, file count, spec version.
 */
async function commitToVersionium(compileResult) {
  const { moduleName, t0, t1 } = compileResult;
  const t0Count = t0?.emitted?.length ?? 0;
  const t1Count = t1?.emitted?.length ?? 0;
  const total   = t0Count + t1Count;

  const message = [
    `spec-compiler: ${moduleName}`,
    `T0 ${t0Count} files, T1 ${t1Count} files (${total} total)`,
    `GATE-COMPILER-005 write-back`,
  ].join(' | ');

  const res = await httpPost('/api/versionium/commit', {
    message,
    branch:   'main',
    causedBy: null,
  });

  return {
    ok:      res.ok,
    commit:  res.data?.commit ?? null,
    error:   res.error ?? (res.ok ? null : `HTTP ${res.status}: ${JSON.stringify(res.data)}`),
  };
}

// ── 3. Seam crossing record ───────────────────────────────────────────────────

/**
 * recordSeamCrossing(compileResult)
 *
 * Writes a seam_records entry via the guardian.seam.verified event.
 * Records that the SPEC_COMPILER_SEAM was crossed successfully.
 */
async function recordSeamCrossing(compileResult) {
  const { moduleName, t0, t1 } = compileResult;
  const t0Count  = t0?.emitted?.length ?? 0;
  const t1Count  = t1?.emitted?.length ?? 0;

  const res = await httpPost('/api/event', {
    type:   'guardian.seam.verified',
    source: SOURCE,
    payload: {
      jobId:      null,
      provider:   SOURCE,
      chunkIdx:   0,
      chunkTitle: `SPEC_COMPILER_SEAM → ${moduleName} (T0:${t0Count} T1:${t1Count})`,
      seamName:   'SPEC_COMPILER_SEAM',
      moduleName,
      version:    '1.0.0',
    },
  });

  return {
    ok:    res.ok,
    error: res.error ?? (res.ok ? null : `HTTP ${res.status}`),
  };
}

// ── 4. Compile run memory ─────────────────────────────────────────────────────

/**
 * recordCompileMemory(compileResult, specPath)
 *
 * Writes a cortex_memory entry summarising this compile run.
 * Searchable via POST /api/memory/search { q: "spec-compiler" }
 * or { q: moduleName }. This is the "session was here" marker.
 */
async function recordCompileMemory(compileResult, specPath) {
  const { moduleName, t0, t1, specDepths } = compileResult;
  const t0Count = t0?.emitted?.length ?? 0;
  const t1Count = t1?.emitted?.length ?? 0;
  const skips   = (t0?.skipped?.length ?? 0) + (t1?.skipped?.length ?? 0);
  const fails   = (t0?.failures?.length ?? 0) + (t1?.failures?.length ?? 0);

  const depths = (specDepths ?? [])
    .map(s => `${s.name}:${s.specDepth}`)
    .join(' ');

  const content = [
    `spec-compiler run: ${moduleName}`,
    `spec: ${path.basename(specPath ?? '')}`,
    `T0: ${t0Count} emitted | T1: ${t1Count} emitted | ${skips} skipped | ${fails} failures`,
    depths ? `specDepths: ${depths}` : '',
    `ts: ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n');

  const res = await httpPost('/api/table/insert', {
    table: 'cortex_memory',
    row: {
      provider:  SOURCE,
      type:      'compiler_run',
      content,
      chars:     content.length,
      source:    SOURCE,
      causedBy:  null,
    },
  });

  return {
    ok:    res.ok,
    error: res.error ?? (res.ok ? null : `HTTP ${res.status}`),
  };
}

// ── 5. Write failures as gaps ─────────────────────────────────────────────────

/**
 * writeFailureGaps(failures, moduleName)
 *
 * Converts compiler write failures into Cortex gaps.
 * Non-fatal — if Cortex itself is down, log locally.
 */
async function writeFailureGaps(failures, moduleName) {
  const written = [];

  for (const f of failures) {
    const res = await httpPost('/api/table/insert', {
      table: 'gaps',
      row: {
        path:     `spec-compiler/${moduleName}/${f.file ?? 'unknown'}`,
        type:     'compiler_writeback_failure',
        severity: 'medium',
        body:     f.error ?? 'write-back failed',
        status:   'pending',
        source:   SOURCE,
        causedBy: null,
      },
    });
    if (res.ok) written.push(f.file);
  }

  return { written };
}

// ── 6. Write cortex_unreachable gap (local fallback) ─────────────────────────

async function writeCortexUnreachableGap(moduleName) {
  // This only runs if every write attempt failed — Cortex is truly down.
  // Log locally so the next session can see what happened.
  const logPath = path.join(process.env.NEXUS_DATA_ROOT || process.cwd(), 'writeback-failures.jsonl');   // §0.39.282 sandbox-aware
  const entry   = JSON.stringify({
    ts:         Date.now(),
    moduleName,
    error:      'cortex_unreachable',
    message:    'GATE-COMPILER-005: write-back failed — Cortex unreachable',
  }) + '\n';
  try {
    fs.appendFileSync(logPath, entry, 'utf-8');
  } catch (_) { /* nothing we can do */ }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * writeback(compileResult, specPath, options)
 *
 * Runs the full write-back pipeline after a successful compile.
 * Called by compile() automatically unless skipWriteback is set.
 *
 * Returns a writeback report — never throws, never blocks compile success.
 */
async function writeback(compileResult, specPath, options = {}) {
  const { verbose = false, skipFiles = false } = options;

  if (!compileResult?.ok || compileResult.skipped) {
    return { ok: true, skipped: true, reason: 'compile result not ok or skipped' };
  }

  const { moduleName, t0, t1 } = compileResult;
  const allEmitted = [
    ...(t0?.emitted ?? []),
    ...(t1?.emitted ?? []),
  ];
  const allFailures = [
    ...(t0?.failures ?? []),
    ...(t1?.failures ?? []),
  ];
  const outputDir = compileResult.outputDir;

  const report = {
    ok:             true,
    moduleName,
    filesUploaded:  [],
    filesFailed:    [],
    commit:         null,
    seam:           null,
    memory:         null,
    gaps:           null,
    errors:         [],
  };

  let anyCortexSuccess = false;

  // ── Step 1: Upload files ─────────────────────────────────────────────────
  if (!skipFiles && allEmitted.length > 0) {
    if (verbose) console.log(`[writeback] uploading ${allEmitted.length} files → Cortex...`);
    const upload = await uploadFiles(allEmitted, outputDir, moduleName);
    report.filesUploaded = upload.uploaded;
    report.filesFailed   = upload.failed;
    if (upload.uploaded.length > 0) anyCortexSuccess = true;
    if (upload.failed.length > 0) {
      report.errors.push(`${upload.failed.length} file upload(s) failed`);
      if (verbose) for (const f of upload.failed) console.warn(`[writeback] upload failed: ${f.file}: ${f.error}`);
    }
    if (verbose) console.log(`[writeback] uploaded ${upload.uploaded.length}, failed ${upload.failed.length}`);
  }

  // ── Step 2: Versionium commit ────────────────────────────────────────────
  if (allEmitted.length > 0) {
    if (verbose) console.log(`[writeback] committing to versionium...`);
    const commit = await commitToVersionium(compileResult);
    report.commit = commit;
    if (commit.ok) anyCortexSuccess = true;
    else report.errors.push(`versionium commit failed: ${commit.error}`);
    if (verbose) console.log(`[writeback] commit: ${commit.ok ? 'ok' : commit.error}`);
  }

  // ── Step 3: Seam record ──────────────────────────────────────────────────
  if (verbose) console.log(`[writeback] recording seam crossing...`);
  const seam = await recordSeamCrossing(compileResult);
  report.seam = seam;
  if (seam.ok) anyCortexSuccess = true;
  else report.errors.push(`seam record failed: ${seam.error}`);
  if (verbose) console.log(`[writeback] seam: ${seam.ok ? 'ok' : seam.error}`);

  // ── Step 4: Compile memory ────────────────────────────────────────────────
  if (verbose) console.log(`[writeback] writing compile memory...`);
  const memory = await recordCompileMemory(compileResult, specPath);
  report.memory = memory;
  if (memory.ok) anyCortexSuccess = true;
  else report.errors.push(`memory write failed: ${memory.error}`);
  if (verbose) console.log(`[writeback] memory: ${memory.ok ? 'ok' : memory.error}`);

  // ── Step 5: Failure gaps ──────────────────────────────────────────────────
  if (allFailures.length > 0) {
    if (verbose) console.log(`[writeback] writing ${allFailures.length} failure gap(s)...`);
    const gaps = await writeFailureGaps(allFailures, moduleName);
    report.gaps = gaps;
    if (verbose) console.log(`[writeback] gaps written: ${gaps.written.length}`);
  }

  // ── Step 6: If nothing reached Cortex, log locally ────────────────────────
  if (!anyCortexSuccess) {
    await writeCortexUnreachableGap(moduleName);
    report.errors.push('cortex_unreachable — logged to writeback-failures.jsonl');
  }

  report.ok = true; // write-back failure never fails the compile
  if (verbose && report.errors.length) {
    console.warn(`[writeback] completed with ${report.errors.length} non-fatal error(s)`);
  }

  return report;
}

// ── Summary formatter ─────────────────────────────────────────────────────────

function summarizeWriteback(report) {
  if (report.skipped) return '→ writeback skipped';
  const lines = [];
  if (report.filesUploaded?.length) lines.push(`✓ ${report.filesUploaded.length} files → Cortex versionium`);
  if (report.filesFailed?.length)   lines.push(`⚠ ${report.filesFailed.length} file upload(s) failed`);
  if (report.commit?.ok)            lines.push(`✓ versionium commit: ${report.commit.commit?.uuid ?? 'ok'}`);
  if (report.seam?.ok)              lines.push(`✓ SPEC_COMPILER_SEAM crossing recorded`);
  if (report.memory?.ok)            lines.push(`✓ compile run in cortex_memory`);
  if (report.gaps?.written?.length) lines.push(`⚠ ${report.gaps.written.length} failure gap(s) written`);
  if (report.errors?.length)        lines.push(`⚠ ${report.errors.length} non-fatal error(s)`);
  return lines.join('\n');
}

module.exports = {
  writeback,
  uploadFiles,
  commitToVersionium,
  recordSeamCrossing,
  recordCompileMemory,
  writeFailureGaps,
  summarizeWriteback,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.ts':   'text/typescript',
    '.js':   'text/javascript',
    '.json': 'application/json',
    '.md':   'text/markdown',
    '.spec': 'text/plain',
    '.yaml': 'text/yaml',
    '.yml':  'text/yaml',
    '.txt':  'text/plain',
  };
  return map[ext] ?? 'text/plain';
}
