'use strict';
/**
 * verify.js — smoke test for spec-compiler pipeline
 *
 * Runs the full T0+T1 pipeline against spec-parser.spec
 * (or any .spec passed as first arg).
 *
 * Also verifies:
 *   - Cortex query seam responds correctly
 *   - Chunk format produces valid prompt
 *   - Token estimates are within budget
 *
 * Usage:
 *   node verify.js [spec-path] [--skip-cortex] [--verbose]
 */

const path    = require('path');

function sanitizeSpec(raw) {
  return raw.replace(
    /^(\s*-\s+)([^'"#\n].+?:\s+.+?)(\s*)$/gm,
    (match, indent, val, trail) => {
      if (val.startsWith('"') || val.startsWith("'")) return match;
      if (/^[A-Za-z].*:\s/.test(val) && !/^[a-z_]+:\s*$/.test(val)) {
        const escaped = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return indent + '"' + escaped + '"' + trail;
      }
      return match;
    }
  );
}
const fs      = require('fs');
const { ping, preflight } = require('./cortex-query');
const { compile }         = require('./compiler');
const { buildChunk, emitToPrompt, estimateTokens } = require('./chunk');
const { writeback, summarizeWriteback } = require('./cortex-query/writeback');

const args       = process.argv.slice(2);
const specPath   = args.find(a => !a.startsWith('--')) ?? path.join(__dirname, 'SPEC_COMPILER.spec');
const verbose    = args.includes('--verbose');
const skipCortex = args.includes('--skip-cortex');

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m',
};
const ok   = t => `${C.green}✓${C.reset}  ${t}`;
const fail = t => `${C.red}✗${C.reset}  ${t}`;
const info = t => `${C.cyan}→${C.reset}  ${t}`;
const warn = t => `${C.yellow}⚠${C.reset}  ${t}`;
const dim  = t => `${C.dim}${t}${C.reset}`;

async function run() {
  console.log();
  console.log(`${C.bold}  spec-compiler verify${C.reset}`);
  console.log(`  spec: ${specPath}`);
  console.log();

  const results = { pass: 0, fail: 0, warn: 0 };

  // ── 1. Cortex ping ────────────────────────────────────────────────────────
  if (!skipCortex) {
    process.stdout.write('  Cortex ping... ');
    const health = await ping();
    if (health.reachable) {
      console.log(ok(`reachable  status=${health.status}  uptime=${Math.floor(health.uptime)}s`));
      if (verbose && health.tables) {
        const counts = Object.entries(health.tables).filter(([,v]) => v > 0);
        for (const [t, n] of counts.slice(0, 5)) console.log(dim(`    ${t}: ${n}`));
      }
      results.pass++;
    } else {
      console.log(warn(`unreachable — ${health.error} — will run with --skip-cortex`));
      results.warn++;
    }
  }

  // ── 2. Spec parse check ───────────────────────────────────────────────────
  process.stdout.write('  Spec parse... ');
  try {
    const { load } = await import('js-yaml');
    const raw = fs.readFileSync(specPath, 'utf-8');
    let doc;
    try { doc = load(raw); } catch(_) { doc = load(sanitizeSpec(raw)); }
    const spec = doc?.spec ?? doc;
    if (!spec?.meta) throw new Error('no meta block');
    console.log(ok(`${spec.meta.name} v${spec.meta.version}  modules=${spec.modules?.length ?? 0}  events=${countEvents(spec)}`));
    results.pass++;
  } catch (e) {
    console.log(fail(`spec parse: ${e.message}`));
    results.fail++;
  }

  // ── 3. Cortex preflight ───────────────────────────────────────────────────
  if (!skipCortex) {
    process.stdout.write('  Cortex preflight... ');
    try {
      const pre = await preflight({ moduleName: 'spec-compiler', specPath, outputDir: './output' });
      const status = pre.skipGeneration ? 'SKIP (all files present)' : 'GENERATE';
      console.log(ok(`${status}  gaps=${pre.openGaps?.length ?? 0}  files=${pre.existingFiles?.length ?? 0}`));
      if (verbose) console.log(dim(pre.summary?.split('\n').map(l => '    ' + l).join('\n')));
      results.pass++;
    } catch (e) {
      console.log(warn(`preflight error: ${e.message}`));
      results.warn++;
    }
  }

  // ── 4. T0 emit ────────────────────────────────────────────────────────────
  const outputDir = path.join(__dirname, 'output', 'verify-run');
  process.stdout.write('  T0 emit... ');
  try {
    const result = await compile(specPath, outputDir, { skipCortex: true, tier: 0, verbose: false });
    if (!result.ok) throw new Error(result.error);
    const t0 = result.t0;
    console.log(ok(`emitted=${t0.emitted.length}  skipped=${t0.skipped.length}  failures=${t0.failures.length}`));
    if (t0.failures.length) {
      for (const f of t0.failures) console.log(fail(`  ${f.file}: ${f.error}`));
      results.fail += t0.failures.length;
    } else {
      results.pass++;
    }
    if (verbose) for (const f of t0.emitted.slice(0, 5)) console.log(dim(`    + ${f}`));
  } catch (e) {
    console.log(fail(`T0: ${e.message}`));
    results.fail++;
  }

  // ── 5. T1 emit ────────────────────────────────────────────────────────────
  process.stdout.write('  T1 emit... ');
  try {
    const result = await compile(specPath, outputDir, { skipCortex: true, tier: 1, verbose: false, force: true });
    if (!result.ok) throw new Error(result.error);
    const t1 = result.t1;
    const msg = t1 ? `emitted=${t1.emitted.length}  skipped=${t1.skipped.length}  failures=${t1.failures.length}` : 'tier 1 not run';
    console.log(ok(msg));
    results.pass++;
  } catch (e) {
    console.log(fail(`T1: ${e.message}`));
    results.fail++;
  }

  // ── 6. Chunk build + token estimate ──────────────────────────────────────
  process.stdout.write('  Chunk build... ');
  try {
    // Build a mock node from the spec
    const { load } = await import('js-yaml');
    const raw = fs.readFileSync(specPath, 'utf-8');
    let doc;
    try { doc = load(raw); } catch(_) { doc = load(sanitizeSpec(raw)); }
    const spec = doc?.spec ?? doc;
    const mod  = spec?.modules?.[0];

    if (!mod) {
      console.log(warn('no modules in spec — skipping chunk test'));
      results.warn++;
    } else {
      const mockNode = {
        id:                   mod.id,
        name:                 mod.name ?? mod.id,
        kind:                 'module',
        description:          mod.description ?? '',
        uuid:                 mod.uuid ?? null,
        specRef:              null,
        specDepth:            0.7,
        generationReadiness:  0.6,
        confidence:           'AMBER',
        dependsOn:            [],
        produces:             [],
        consumes:             [],
        exports:              mod.exports ?? [],
        gatePipeline:         mod.gate_pipeline ?? [],
        behavioralContracts:  mod.behavioral_contracts ?? [],
        errorPaths:           mod.error_paths ?? [],
        constraints:          spec?.meta?.constraints ?? [],
      };

      const mockGraph = {
        getNode:        () => null,
        getNodeByName:  () => null,
        getNodesByKind: () => [],
      };

      const chunk   = buildChunk(mockNode, mockGraph, null, 2);
      const prompt  = emitToPrompt(chunk);
      const tokens  = estimateTokens(chunk);
      const budget  = chunk.budget;   // from tier-contract (1024)
      const warnAt  = chunk.warnAt;   // 85% of budget
      const level   = tokens >= (chunk.criticalAt ?? budget * 0.95) ? 'CRITICAL'
                    : tokens >= (warnAt ?? budget * 0.85)            ? 'WARN'
                    : 'within';

      const msg = 'node=' + mockNode.name + '  ~' + tokens + ' tokens  budget=' + budget + '  ' + level;
      if (level === 'within') {
        console.log(ok(msg));
        results.pass++;
      } else {
        console.log(warn(msg));
        results.warn++;
      }

      if (verbose) {
        console.log();
        console.log(dim('  ── CHUNK PROMPT PREVIEW ──────────────────────────────────────'));
        for (const line of prompt.split('\n').slice(0, 20)) {
          console.log(dim('  ' + line));
        }
        if (prompt.split('\n').length > 20) console.log(dim('  ... (truncated)'));
        console.log();
      }
    }
  } catch (e) {
    console.log(fail(`chunk: ${e.message}`));
    if (verbose) console.error(e.stack);
    results.fail++;
  }

  // ── 7. Write-back (if Cortex reachable + T0 ran) ───────────────────────────
  if (!skipCortex && results.pass >= 2) {
    process.stdout.write('  Writeback... ');
    try {
      // Build a minimal compile result from the T0 run
      const t0OutputDir = path.join(__dirname, 'output', 'verify-run');
      const mockResult = {
        ok: true, skipped: false,
        moduleName: 'verify-test',
        outputDir: t0OutputDir,
        t0: { emitted: ['package.json', 'tsconfig.json'], skipped: [], failures: [] },
        t1: null,
        specDepths: [],
      };
      const wb = await writeback(mockResult, specPath, { verbose });
      if (wb.skipped) {
        console.log(warn('skipped (compile not ok)'));
        results.warn++;
      } else {
        const parts = [];
        if (wb.filesUploaded?.length) parts.push(`${wb.filesUploaded.length} files uploaded`);
        if (wb.commit?.ok)            parts.push('commit ok');
        if (wb.seam?.ok)              parts.push('seam ok');
        if (wb.memory?.ok)            parts.push('memory ok');
        if (wb.errors?.length)        parts.push(`${wb.errors.length} warn(s)`);
        const allOk = wb.commit?.ok && wb.seam?.ok && wb.memory?.ok;
        if (allOk) {
          console.log(ok(parts.join('  ')));
          results.pass++;
        } else {
          console.log(warn(parts.join('  ') || 'cortex unreachable — logged locally'));
          results.warn++;
        }
        if (verbose) console.log(dim(summarizeWriteback(wb).split('\n').map(l=>'    '+l).join('\n')));
      }
    } catch(e) {
      console.log(fail(`writeback: ${e.message}`));
      results.fail++;
    }
  }

    // ── Summary ───────────────────────────────────────────────────────────────
  console.log();
  console.log(`  ${C.bold}─────────────────────────────────────────────${C.reset}`);
  const status = results.fail > 0 ? `${C.red}${C.bold}  ✗  FAILED${C.reset}` : `${C.green}${C.bold}  ✓  PASS${C.reset}`;
  console.log(`  ${status}   ${C.green}${results.pass} pass${C.reset}  ${C.yellow}${results.warn} warn${C.reset}  ${C.red}${results.fail} fail${C.reset}`);
  console.log();

  if (results.fail > 0) process.exit(1);
}

function countEvents(spec) {
  const ev = spec?.events ?? spec?.event_model ?? {};
  if (Array.isArray(ev)) return ev.length;
  return Object.values(ev).reduce((n, v) => n + (Array.isArray(v) ? v.length : 1), 0);
}

run().catch(e => { console.error(e); process.exit(1); });
