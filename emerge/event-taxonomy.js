'use strict';
// emerge/event-taxonomy.js — every event EMERGE emits, in the ET1 shape (lib/event-taxonomy-pattern.js).
// component_id: emerge.event-taxonomy
// Map: docs/2026-10-02-emerge-field-memory-build-phasemap.spec (EV0, invariant E14)
//
// Written from the code, not invented: each entry is an event a file under emerge/ emits today, its payloadShape the
// fields at the emit site (read by lib/event-contract-check.js). Most are SISO stream events — the compiler pipeline
// (spec.load → … → compiler.complete), the knowledge-graph build (kg.*), the invariant gates (inv.*), the gap field
// (gap.*), the reply scheduler (reply.*) and the IDE's own streams (io.*, llm.*, compiler.*). A step that passes its
// input on (`...event.data`) carries the previous step's fields as well as the ones named here.
// E10: zero dependencies — this file requires nothing. `nexus contracts check --system=emerge` holds it to the code.

module.exports = Object.freeze({
  // ── the kernel (emerge-kernel.js) ────────────────────────────────────────────────────────────────────────────
  KERNEL_BOOTED: { description: 'The kernel booted and registered its compartments from the compiled IR.', payloadShape: ['compartments', 'source'], severity: 'info' },
  SIGNAL_PASSED: { description: 'An ingested signal had tokens above the SNR gate; they went on to be parsed.', payloadShape: ['snr', 'tokens'], severity: 'info' },
  SIGNAL_NOISE: { description: 'An ingested signal had no token above the SNR gate; all of it was kept as noise.', payloadShape: ['snr', 'reason'], severity: 'info' },

  // ── the compiler pipeline (compiler/pipeline.js) ─────────────────────────────────────────────────────────────
  SPEC_LOAD: { description: 'A compile was asked for: the pipeline\'s input, a spec path and its options.', payloadShape: ['specPath', 'options'], severity: 'info' },
  SPEC_PARSED: { description: 'The spec file parsed into a normalised spec with its module name and version.', payloadShape: ['specPath', 'options', 'parsedSpec', 'moduleName', 'specVersion'], severity: 'info' },
  CORTEX_READY: { description: 'Cortex was asked what already exists for this module (or was skipped); its answer rides on.', payloadShape: ['cortexResult'], severity: 'info' },
  COMPILER_SKIPPED: { description: 'Nothing to generate: every file is already in Cortex and no high gap is open (and --force was not set).', payloadShape: ['moduleName', 'reason', 'summary', 'cortex'], severity: 'info' },
  COMPILER_T0_DONE: { description: 'T0 finished: the structure, its graph and the tier map, with no model involved.', payloadShape: ['t0', 'graph', 'tierMap'], severity: 'info' },
  COMPILER_T1_DONE: { description: 'T1 finished: the scaffold for the module, with no model involved.', payloadShape: ['t1'], severity: 'info' },
  COMPILER_COMPLETE: { description: 'The compile finished: its result, what was written back, and the Idearium sync.', payloadShape: ['writeback', 'idearium'], severity: 'notable' },
  COMPILER_ERROR: { description: 'A pipeline step failed; the step, its error and where it happened.', payloadShape: ['step', 'error', 'specPath', 'moduleName', 'gateSig', 'stack', 'filename'], severity: 'failure' },

  // ── the knowledge graph (compiler/kg-builder.js) ─────────────────────────────────────────────────────────────
  KG_BUILD: { description: 'A knowledge-graph build was asked for from a parsed spec.', payloadShape: ['parsedSpec'], severity: 'info' },
  KG_NODES_BUILT: { description: 'Every declared entity is a node; referenced-but-undeclared ones are BLACK nodes.', payloadShape: ['nodes', 'allIds'], severity: 'info' },
  KG_EDGES_BUILT: { description: 'The edges between the nodes are built.', payloadShape: ['edges'], severity: 'info' },
  KG_SCORED: { description: 'Each node has its spec depth and generation readiness.', payloadShape: [], severity: 'info' },
  KG_BLAST_DONE: { description: 'Each node\'s blast radius (what depends on it) is computed.', payloadShape: [], severity: 'info' },
  KG_COMPLETE: { description: 'The knowledge graph is assembled.', payloadShape: ['graph'], severity: 'info' },

  // ── the invariants (compiler/invariants-engine.js) ───────────────────────────────────────────────────────────
  INVARIANTS_CHECK_REQUESTED: { description: 'The graph\'s invariants were asked to be checked.', payloadShape: ['graph', 'violations'], severity: 'info' },
  INV_001_DONE: { description: 'INV-001 checked: every node\'s map key is its id (identity consistency).', payloadShape: ['violations'], severity: 'info' },
  INV_002_DONE: { description: 'INV-002 checked: every edge\'s source exists (no phantom sources).', payloadShape: ['violations'], severity: 'info' },
  INV_003_DONE: { description: 'INV-003 checked: every edge\'s target exists (no phantom targets).', payloadShape: ['violations'], severity: 'info' },
  INV_004_DONE: { description: 'INV-004 checked: every readiness is between 0 and 1 (bounded propagation).', payloadShape: ['violations'], severity: 'info' },
  INV_005_DONE: { description: 'INV-005 checked: BLACK nodes have readiness 0 (semantic consistency).', payloadShape: ['violations'], severity: 'info' },
  INV_006_DONE: { description: 'INV-006 checked: members of one cycle share one readiness (convergence symmetry).', payloadShape: ['violations'], severity: 'info' },
  INV_007_DONE: { description: 'INV-007 checked: the build order is topologically valid (no dependency after its dependent).', payloadShape: ['violations'], severity: 'info' },
  INVARIANTS_CHECK_COMPLETE: { description: 'All seven invariants are checked; the report lists every violation.', payloadShape: ['report'], severity: 'notable' },

  // ── the gap field (compiler/gap-field-engine.js) ─────────────────────────────────────────────────────────────
  GAP_FIELD_BUILD_REQUESTED: { description: 'A gap field was asked for from the graph and its invariant violations.', payloadShape: ['graph', 'violations'], severity: 'info' },
  GAP_STRUCTURAL_DONE: { description: 'Structural gaps derived: what the spec\'s structure omits.', payloadShape: ['gaps'], severity: 'info' },
  GAP_SCHEMA_DONE: { description: 'Schema gaps derived: what referenced schemas leave unspecified.', payloadShape: ['gaps'], severity: 'info' },
  GAP_SEMANTIC_DONE: { description: 'Semantic gaps derived: what must be true given what is declared, and is not.', payloadShape: ['gaps'], severity: 'info' },
  GAP_BEHAVIORAL_DONE: { description: 'Behavioural gaps derived: declared behaviour without its contract.', payloadShape: ['gaps'], severity: 'info' },
  GAP_EXECUTION_DONE: { description: 'Execution gaps derived: what blocks a node from being generated or run.', payloadShape: ['gaps'], severity: 'info' },
  GAP_PROPAGATION_DONE: { description: 'Propagation gaps derived: a weak dependency lowering what depends on it.', payloadShape: ['gaps'], severity: 'info' },
  GAP_COSTS_DONE: { description: 'Each gap is weighed and priced; the total gap weight, token cost and budget forecast.', payloadShape: ['gaps', 'totalGapWeight', 'totalTokenCost', 'tokenBudgetForecast'], severity: 'info' },
  GAP_FIELD_COMPLETE: { description: 'The gap field is assembled.', payloadShape: ['field'], severity: 'notable' },

  // ── the reply scheduler (compiler/reply-engine.js) ───────────────────────────────────────────────────────────
  REPLY_PLAN_REQUESTED: { description: 'An execution plan was asked for from the nodes, tier map, gap field and violations.', payloadShape: ['nodes', 'tierMap', 'gapField', 'violations'], severity: 'info' },
  REPLY_BLOCK_DONE: { description: 'Blocked nodes sorted out: a cycle, a missing dependency or a critical violation.', payloadShape: ['block', 'remaining'], severity: 'info' },
  REPLY_SKIP_DONE: { description: 'Skipped nodes sorted out: below the T0 threshold, nothing to emit.', payloadShape: ['skip', 'remaining'], severity: 'info' },
  REPLY_DEFER_DONE: { description: 'Deferred nodes sorted out: a tier decision exists but open gaps come first.', payloadShape: ['defer', 'remaining'], severity: 'info' },
  REPLY_RUN_DONE: { description: 'The nodes ready to run now are chosen.', payloadShape: ['run'], severity: 'info' },
  REPLY_PRIORITIZE_DONE: { description: 'The run bucket is ordered: highest readiness first.', payloadShape: ['run'], severity: 'info' },
  REPLY_PLAN_READY: { description: 'The execution plan is ready: run, defer, skip and block, in order.', payloadShape: ['plan'], severity: 'notable' },

  // ── the IDE (emerge-ide.js — its io, compiler, llm and ui streams) ───────────────────────────────────────────
  IO_COMPILE: { description: 'The IDE was asked to compile a source (POST /compile).', payloadShape: ['source', 'filename'], severity: 'info' },
  IO_CHECK: { description: 'The IDE was asked to check a source without booting it (POST /check).', payloadShape: ['source', 'filename'], severity: 'info' },
  IO_SPEC: { description: 'The IDE was given a new language spec to hot-load (POST /spec).', payloadShape: ['source'], severity: 'info' },
  COMPILER_RESULT: { description: 'A source compiled and its kernel booted: SNR, validity, gaps, noise, regime and the IR.', payloadShape: ['filename', 'snr', 'valid', 'gaps', 'noise', 'regime', 'ir'], severity: 'info' },
  COMPILER_CHECK: { description: 'A source was checked: SNR, validity, gaps, noise and whether it passed.', payloadShape: ['filename', 'snr', 'valid', 'gaps', 'noise', 'passed'], severity: 'info' },
  COMPILER_SNAPSHOT: { description: 'A snapshot of the IDE\'s state was asked for (POST /snapshot).', payloadShape: [], severity: 'info' },
  COMPILER_SNAPSHOT_RESULT: { description: 'The IDE\'s state: regime, schema, the event log and its streams.', payloadShape: ['ts', 'regime', 'schema', 'log', 'streams'], severity: 'info' },
  SPEC_UPDATED: { description: 'A new language spec was hot-loaded and saved.', payloadShape: ['keywords', 'version'], severity: 'notable' },
  SPEC_ERROR: { description: 'A language spec could not be loaded.', payloadShape: ['error'], severity: 'failure' },
  LLM_REQUEST: { description: 'A prompt was sent to the local model through the IDE.', payloadShape: ['prompt', 'context', 'model', 'task'], severity: 'info' },
  LLM_TOKEN: { description: 'One streamed token of the local model\'s reply.', payloadShape: ['text', 'model'], severity: 'info' },
  LLM_COMPLETE: { description: 'The local model finished its reply.', payloadShape: ['model'], severity: 'info' },
  LLM_ERROR: { description: 'The local model failed to reply.', payloadShape: ['error', 'model'], severity: 'failure' },
  OLLAMA_MODELS: { description: 'The models the local Ollama has, as the IDE found them.', payloadShape: ['models'], severity: 'info' },
  EIDOLON_READY: { description: 'The IDE is serving on its port.', payloadShape: ['port'], severity: 'info' },
});
