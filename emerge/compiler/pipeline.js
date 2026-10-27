'use strict';
/**
 * compiler/pipeline.js — spec-compiler as a SISO stream
 * UUID: spec-compiler-pipeline-v2-0000-0001
 * Version: 1.1.0
 *
 * THE INSIGHT (from the SISO paper):
 *   "Rather than asking LLMs to navigate arbitrary architectural decisions,
 *    we constrain the architecture such that correct implementations become
 *    the path of least resistance."
 *
 * The compiler IS the spec it compiles. Every stage is a Gate.
 * The stream is the pipeline. The log is observability.
 * Same input → same output. Always. §CC-002.
 *
 * PIPELINE:
 *   spec.load        → SpecLoadGate      → spec.parsed
 *   spec.parsed      → CortexQueryGate   → cortex.ready
 *   cortex.ready     → T0Gate            → compiler.t0.done
 *   compiler.t0.done → T1Gate            → compiler.t1.done
 *   compiler.t1.done → WritebackGate     → compiler.complete
 *   compiler.complete → (pending)        → read result via sampleHere()
 *
 * Every gate:
 *   - Receives one event
 *   - Does one thing
 *   - Emits the next event (or compiler.error on failure)
 *   - Never throws — errors become events
 *
 * §1.2  Nothing silently fails — errors are events, not exceptions
 * §CC-002  T0Gate and T1Gate call zero LLM APIs
 * §CC-001  CortexQueryGate runs before any emit
 */

const fs   = require('fs');
const path = require('path');

const { Event, Gate, Stream, StreamLog } = require('../siso');
const { preflight, ping }                = require('../cortex-query');
const { writeback, summarizeWriteback }  = require('../cortex-query/writeback');
const { sync: ideaSync }                 = require('../idearium/client');
const {
  emitT0, emitT1,
  normalizeSpec, sanitizeSpec,
  computeSpecDepth,
} = require('./emit');
const { build: buildKG } = require('./kg-builder');
const { decideAll, summarize: summarizeContract, decideTier } = require('./tier-contract');
const { computeGapField } = require('./gap-field-engine');
const { check: checkInvariants } = require('./invariants-engine');
const { plan: replyPlan } = require('./reply-engine');

// ── Event type constants ──────────────────────────────────────────────────────

const E = {
  LOAD:       'spec.load',
  PARSED:     'spec.parsed',
  CORTEX:     'cortex.ready',
  T0_DONE:    'compiler.t0.done',
  T1_DONE:    'compiler.t1.done',
  T1_5_DONE:  'compiler.t1_5.done',  // Phase 40 T1.5: descriptor projections
  COMPLETE:   'compiler.complete',
  ERROR:      'compiler.error',
  SKIPPED:    'compiler.skipped',
};

// ── Gate 1: SpecLoadGate ──────────────────────────────────────────────────────
// spec.load → spec.parsed | compiler.error

class SpecLoadGate extends Gate {
  constructor() { super(E.LOAD); }

  async transform(event, stream) {
    const { specPath, options } = event.data;
    try {
      const { load } = await import('js-yaml');
      const raw  = fs.readFileSync(specPath, 'utf-8');
      let doc;
      try { doc = load(raw); }
      catch (_) { doc = load(sanitizeSpec(raw)); }

      const parsed = normalizeSpec(doc?.spec ?? doc);
      if (!parsed?.meta) throw new Error('no meta block in spec');

      stream.emit(new Event(E.PARSED, {
        specPath,
        options,
        parsedSpec:  parsed,
        moduleName:  parsed.meta?.name ?? path.basename(specPath, '.spec'),
        specVersion: parsed.meta?.version ?? '0.0.0',
      }));
    } catch (e) {
      stream.emit(new Event(E.ERROR, {
        step:    'spec.load',
        error:   e.message,
        specPath,
      }));
    }
  }
}

// ── Gate 2: CortexQueryGate ───────────────────────────────────────────────────
// spec.parsed → cortex.ready
// §CC-001: always runs. Unreachability → assume_empty, not failure.

class CortexQueryGate extends Gate {
  constructor() { super(E.PARSED); }

  async transform(event, stream) {
    const { specPath, options, parsedSpec, moduleName } = event.data;

    let cortexResult = null;

    if (!options.skipCortex) {
      cortexResult = await preflight({
        moduleName,
        specPath,
        outputDir: options.outputDir,
      });

      // skipGeneration: all files exist, no high gaps, --force not set
      if (cortexResult.skipGeneration && !options.force) {
        stream.emit(new Event(E.SKIPPED, {
          moduleName,
          reason:  'all files present in Cortex, no high gaps',
          summary: cortexResult.summary,
          cortex:  cortexResult,
        }));
        return;
      }
    }

    stream.emit(new Event(E.CORTEX, {
      ...event.data,
      cortexResult,
    }));
  }
}

// ── Gate 3: T0Gate ────────────────────────────────────────────────────────────
// cortex.ready → compiler.t0.done
// §CC-002: zero LLM calls. Deterministic structure emission.

class T0Gate extends Gate {
  constructor() { super(E.CORTEX); }

  async transform(event, stream) {
    const { parsedSpec, cortexResult, options } = event.data;
    try {
      const t0 = await emitT0(parsedSpec, options.outputDir, cortexResult);
      // Build KG after T0 — T1 needs real generationReadiness scores
      const kgResult = buildKG(parsedSpec);
      const graph    = kgResult.ok ? kgResult.graph : null;
      // Apply tier contract to every node — gates read decisions, not raw scores
      const tierMap  = graph ? decideAll(graph) : null;
      if (graph && options.verbose) {
        console.log('[pipeline] tier contract:\n' + summarizeContract(tierMap).split('\n').map(l=>'  '+l).join('\n'));
      }
      stream.emit(new Event(E.T0_DONE, { ...event.data, t0, graph, tierMap }));
    } catch (e) {
      stream.emit(new Event(E.ERROR, {
        step: 'compiler.t0',
        error: e.message,
        moduleName: event.data.moduleName,
      }));
    }
  }
}

// ── Gate 4: T1Gate ────────────────────────────────────────────────────────────
// compiler.t0.done → compiler.t1.done
// §CC-002: zero LLM calls. Scaffold emission from spec.

class T1Gate extends Gate {
  constructor() { super(E.T0_DONE); }

  async transform(event, stream) {
    const { parsedSpec, cortexResult, options, t0 } = event.data;

    if ((options.tier ?? 1) < 1) {
      // tier 0 only — skip T1
      stream.emit(new Event(E.T1_DONE, { ...event.data, t1: null }));
      return;
    }

    try {
      // Use real KG if available (built in T0Gate), fallback to minimal stub
      // T1 emission uses the tier contract: only nodes with tier T1 or T2 get scaffold
      const { tierMap } = event.data;
      const realGraph = event.data.graph ?? {
        getNode:        id   => parsedSpec.modules?.find(m => m.id === id),
        getNodeByName:  name => parsedSpec.modules?.find(m => m.name === name),
        getNodesByKind: kind => (parsedSpec.modules ?? []).filter(m => m.kind === kind),
      };
      const t1 = await emitT1(parsedSpec, realGraph, options.outputDir, cortexResult);
      stream.emit(new Event(E.T1_DONE, { ...event.data, t1 }));
    } catch (e) {
      stream.emit(new Event(E.ERROR, {
        step: 'compiler.t1',
        error: e.message,
        moduleName: event.data.moduleName,
      }));
    }
  }
}

// ── Gate 5: WritebackGate ─────────────────────────────────────────────────────
// compiler.t1.done → compiler.complete
// §GATE-COMPILER-005: register every emitted file with Cortex.

class WritebackGate extends Gate {
  constructor() { super(E.T1_DONE); }

  async transform(event, stream) {
    const { parsedSpec, options, t0, t1, moduleName, cortexResult, graph, tierMap: rawTierMap } = event.data;

    const specDepths = (parsedSpec.modules ?? []).map(m => ({
      name:      m.name ?? m.id,
      specDepth: computeSpecDepth(m).toFixed(2),
    }));

    // Run invariants + gap field — co-equal outputs alongside tierMap
    const violationReport = graph ? checkInvariants(graph) : null;
    const gapResult       = graph ? computeGapField(graph, violationReport) : null;
    const gapField        = gapResult?.field ?? null;
    const tierMap         = rawTierMap ?? null;

    // Build order: foundation-first, annotated with tier and gap count
    const buildOrder = graph
      ? graph.getBuildOrder().filter(n => n.kind === 'module').map(n => ({
          id:        n.id,
          name:      n.name,
          tier:      decideTier(n).tier,
          readiness: n.generationReadiness,
          gapCount:  gapField ? (gapField.getByNode(n.id)?.length ?? 0) : 0,
        }))
      : [];

    // Readiness distribution snapshot
    const readiness = graph ? {
      green:   graph.meta.greenCount   ?? 0,
      amber:   graph.meta.amberCount   ?? 0,
      red:     graph.meta.redCount     ?? 0,
      black:   graph.meta.blackCount   ?? 0,
      blocked: (tierMap?.blocked?.length ?? 0),
    } : null;

    // Execution plan — the reply engine consumes tierMap + gapField, produces run/defer/skip/block
    const executionPlan = graph
      ? replyPlan(tierMap, gapField, graph, violationReport)
      : null;

    // Synthesis: actionable recommendations from gap field + tier map
    const recommendations = buildRecommendations(graph, gapField, tierMap, violationReport);

    const compileResult = {
      ok: true, skipped: false,
      moduleName,
      outputDir: options.outputDir,

      // Emission artifacts
      t0, t1,

      // KG layer — what exists
      graph,
      specDepths,
      buildOrder,
      readiness,

      // Uncertainty layer — what is missing
      gapField,
      totalGapWeight:  gapField?.totalGapWeight       ?? 0,
      tokenForecast:   gapField?.tokenBudgetForecast  ?? null,
      violations:      violationReport,

      // Execution layer — what should happen
      tierMap: rawTierMap ?? null,

      // Scheduler — what to do next, in order
      executionPlan,

      // Synthesis — human-readable
      recommendations,

      // Infrastructure
      cortex: cortexResult,
    };

    let writebackReport = null;
    if (!options.skipCortex && !options.skipWriteback) {
      writebackReport = await writeback(compileResult, event.data.specPath, {
        verbose: options.verbose,
      });
    }

    // Idearium sync — push compile result, pull open ideas (non-fatal)
    let idearium = null;
    if (!options.skipIdearium) {
      idearium = await ideaSync(compileResult);
      if (options.verbose && idearium.ok) {
        console.log('[pipeline] Idearium: ' + idearium.summary);
      }
    }

    stream.emit(new Event(E.COMPLETE, {
      ...compileResult,
      writeback: writebackReport,
      idearium,
    }));
  }
}

// ── Pipeline factory ──────────────────────────────────────────────────────────

/**
 * createPipeline(logLevel)
 *
 * Returns a Stream with all gates registered, ready to accept 'spec.load'.
 * One pipeline per compile run — streams are not reused.
 */
function createPipeline(logLevel = 'EVENTS') {
  const log    = new StreamLog(logLevel);
  const stream = new Stream({ log });

  stream.register(new SpecLoadGate());
  stream.register(new CortexQueryGate());
  stream.register(new T0Gate());
  stream.register(new T1Gate());
  stream.register(new WritebackGate());

  return { stream, log };
}

// ── compile() — the public interface ─────────────────────────────────────────

/**
 * buildRecommendations(graph, gapField, tierMap, violationReport) → string[]
 * Synthesises actionable next steps from gap field + tier map.
 * Returns ordered list: most urgent first.
 * Not scheduling — that is the reply engine's job.
 * This is human-readable signal about what the compile result means.
 */
function buildRecommendations(graph, gapField, tierMap, violations) {
  const recs = [];
  if (!graph) return ['No graph — spec parse may have failed'];

  if (violations && violations.criticalCount > 0)
    recs.push('CRITICAL: ' + violations.criticalCount + ' invariant violation(s) — resolve before generation');

  const blocking = gapField ? gapField.getBlocking() : [];
  if (blocking.length > 0) {
    const names = [...new Set(blocking.map(g => g.nodeId))].slice(0, 3).join(', ');
    recs.push('BLOCKED: ' + blocking.length + ' cycle(s) [' + names + '] — break cycle before T2 dispatch');
  }

  const black = graph.getBlackNodes ? graph.getBlackNodes() : [];
  if (black.length > 0)
    recs.push('MISSING: ' + black.length + ' undeclared dep(s) [' + black.map(n => n.name).join(', ') + '] — declare in spec');

  const t2 = tierMap ? tierMap.t2 : [];
  if (t2 && t2.length > 0) {
    const names = t2.slice(0, 3).map(x => x.node ? x.node.name : x.id).join(', ');
    recs.push('READY: ' + t2.length + ' node(s) ready for T2 [' + names + ']');
  }

  const expensive = (gapField ? gapField.gaps : []).filter(g => g.estimatedTokenCost > 100).slice(0, 3);
  for (const g of expensive)
    recs.push('SPEC: ' + g.nodeId + ' — ' + g.description.slice(0, 80) + ' (~' + g.estimatedTokenCost + ' tokens)');

  const forecast = gapField ? gapField.tokenBudgetForecast : null;
  if (forecast && forecast.estimatedTokens > 0)
    recs.push('FORECAST: ~' + forecast.estimatedTokens + ' tokens for remaining generation (confidence: ' + Math.round(forecast.confidence * 100) + '%)');

  if (recs.length === 0) recs.push('CLEAN: no gaps, no violations — ready for T2 dispatch');
  return recs;
}

/**
 * compile(specPath, outputDir, options)
 *
 * Runs the SISO pipeline from spec.load to compiler.complete.
 * Returns the result from pending (compiler.complete or compiler.error).
 *
 * The pipeline is async — gates use async transform via a promise queue.
 * We drive it by emitting the seed event and awaiting settlement.
 */
async function compile(specPath, outputDir, options = {}) {
  const { verbose = false } = options;
  const opts = { outputDir, verbose, ...options };

  const logLevel = verbose ? 'DATA' : 'EVENTS';
  const { stream, log } = createPipeline(logLevel);

  // Drive the async pipeline
  // Gates are async but Stream.emit() is sync — we use a micro-task queue
  // to let each gate's promise resolve before the next emit.
  await driveAsync(stream, new Event(E.LOAD, { specPath, options: opts }));

  const { pending } = stream.sampleHere();

  if (verbose) {
    const logData = log.sample();
    console.log(`[pipeline] ${logData.count} events processed`);
    for (const entry of logData.entries) {
      const claimed = entry.claimed ? `→ ${entry.claimed}` : '→ pending';
      console.log(`  [${entry.seq}] ${entry.type} ${claimed}`);
    }
  }

  // Find result event
  const complete = pending.find(e => e.type === E.COMPLETE);
  if (complete) return { ok: true,  ...complete.data };

  const skipped  = pending.find(e => e.type === E.SKIPPED);
  if (skipped)  return { ok: true,  skipped: true, ...skipped.data };

  const error    = pending.find(e => e.type === E.ERROR);
  if (error)    return { ok: false, ...error.data };

  return { ok: false, error: 'pipeline produced no result', pending };
}

/**
 * driveAsync(stream, seedEvent)
 *
 * CONTRACT — this function has exactly one job and is forbidden from growing.
 *
 * ONE JOB:
 *   Allow async gate transforms to participate in a synchronous SISO stream
 *   by wrapping each gate's transform in a sequential promise queue.
 *
 * WHAT IT IS ALLOWED TO DO:
 *   - Intercept gate.transform to queue async work
 *   - Drain that queue sequentially (one task at a time, in order)
 *   - Surface gate errors as compiler.error events via the stream
 *
 * WHAT IT IS FORBIDDEN TO DO (hard boundaries — if you find yourself
 * adding any of these, stop and build a Gate instead):
 *   - Retry logic           → build a RetryGate
 *   - Timeout logic         → build a TimeoutGate
 *   - Parallel execution    → build a ForkGate + MergeGate
 *   - Queue depth limits    → not this function's concern
 *   - Cancellation          → not this function's concern
 *   - Backpressure          → not this function's concern
 *
 * WHY:
 *   driveAsync is infrastructure, not policy. Policy belongs in Gates.
 *   If this function grows scheduling logic, it becomes a second execution
 *   engine sitting underneath the stream — invisible, untestable as a gate,
 *   and in conflict with SISO's single execution model.
 *   (See: Jonathan Bailey's review, point 4.)
 *
 * FAILURE CONTRACT:
 *   Gate errors are caught here and emitted as compiler.error events.
 *   driveAsync itself never throws. The stream always settles.
 *   Unhandled gate errors appear in stream.sampleHere().pending as
 *   { type: 'compiler.error', data: { step, error, gateSig } }.
 */
async function driveAsync(stream, seedEvent) {
  // Validate: only call on a stream that has not yet been driven.
  // Driving the same stream twice produces undefined behaviour.
  if (stream._driven) {
    throw new Error('driveAsync: stream has already been driven. Create a new pipeline per compile.');
  }
  stream._driven = true;

  const queue = [];

  // Patch each gate to intercept async transforms.
  // The patch is applied once, before any events flow.
  for (const [sig, gate] of stream.gates) {
    const originalTransform = gate.transform.bind(gate);
    gate.transform = (event, s) => {
      // Enqueue. Do not await here — Stream.emit() is synchronous.
      queue.push({ fn: () => originalTransform(event, s), sig, eventType: event.type });
    };
  }

  // Emit seed synchronously — pushes first task onto queue.
  stream.emit(seedEvent);

  // Drain sequentially. Each awaited task may push more tasks
  // (because gate.transform calls stream.emit, which calls the patched
  // gate.transform of the next gate, which enqueues the next task).
  // This preserves SISO's depth-first ordering in the async domain.
  while (queue.length > 0) {
    const { fn, sig, eventType } = queue.shift();
    try {
      await fn();
    } catch (err) {
      // Gate threw instead of emitting compiler.error. Surface it as an event.
      // This is the ONLY error handling in driveAsync — catching escaping gate errors.
      // driveAsync does not retry, does not rethrow, does not log.
      // The error event is the gate's fault; the stream records it.
      stream.emit(new Event(E.ERROR, {
        step:     eventType,
        error:    err.message,
        gateSig:  sig,
        stack:    err.stack?.slice(0, 500),
      }));
    }
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args       = process.argv.slice(2);
  const specPath   = args[0];
  const outputDir  = args[1] ?? './output';
  const verbose    = args.includes('--verbose');
  const force      = args.includes('--force');
  const skipCortex = args.includes('--skip-cortex');

  if (!specPath) {
    console.error('Usage: node pipeline.js <spec-path> [output-dir] [--verbose] [--force] [--skip-cortex]');
    process.exit(1);
  }

  compile(specPath, outputDir, { verbose, force, skipCortex, tier: 1 })
    .then(result => {
      if (!result.ok) {
        console.error(`[pipeline] FAILED: ${result.error}`);
        process.exit(1);
      }
      if (result.skipped) {
        console.log(`[pipeline] SKIPPED: ${result.reason}`);
      } else {
        console.log(`[pipeline] OK: ${result.moduleName}`);
        console.log(`  T0: ${result.t0?.emitted?.length ?? 0} emitted, ${result.t0?.skipped?.length ?? 0} skipped`);
        console.log(`  T1: ${result.t1?.emitted?.length ?? 0} emitted, ${result.t1?.skipped?.length ?? 0} skipped`);
        if (result.writeback && !result.writeback.skipped) {
          const wb = result.writeback;
          console.log(`  Writeback: ${wb.filesUploaded?.length ?? 0} files, commit: ${wb.commit?.ok ? 'ok' : 'failed'}`);
        }
        if (result.specDepths?.length) {
          console.log('  specDepths:');
          for (const s of result.specDepths) console.log(`    ${s.name}: ${s.specDepth}`);
        }
      }
    })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { compile, createPipeline, driveAsync, E };
