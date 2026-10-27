'use strict';
/**
 * chunk-format.js — CHUNK: the minimal token payload for small LLMs
 * UUID: spec-compiler-chunk-v1-0000-0001
 * Version: 1.0.0
 *
 * THE PROBLEM THIS SOLVES:
 *   A small LLM (7B-13B) cannot hold an entire spec in context.
 *   It also doesn't need to. It needs to implement ONE gate function.
 *   The Chunk is everything that gate function needs — nothing more.
 *
 * TOKEN BUDGET:
 *   Tier 0 (structure)  = 0 LLM tokens. Fully deterministic.
 *   Tier 1 (scaffold)   = 0 LLM tokens. Fully deterministic.
 *   Tier 2 (skeleton)   = ~400-800 tokens per node. Small LLM handles this.
 *   Tier 3 (impl)       = ~800-2000 tokens per node. Better LLM preferred.
 *
 * CHUNK STRUCTURE:
 *   subject      — the one node to implement (ID, name, kind, what it does)
 *   signature    — the exact function signature(s) to fill
 *   constraints  — the invariants this node must satisfy (IDs only, not full text)
 *   deps         — direct dependencies (ID + name only — not their implementations)
 *   events       — events this node produces or consumes (name + payload shape only)
 *   errors       — error paths declared in spec (what must be handled)
 *   gates        — gate pipeline steps (what gates must exist)
 *   gaps         — open gaps from Cortex (what's still unknown)
 *   seam         — the SEAM contract this output will be tested against
 *   cortex       — what Cortex already knows (prevents re-generation)
 *   budget       — token ceiling for LLM response
 */

// ── Chunk builder ─────────────────────────────────────────────────────────────

/**
 * buildChunk(node, graph, cortexPreflight, tier)
 *
 * node            — KGNode from the knowledge graph
 * graph           — KnowledgeGraph (for dep resolution + similar node lookup)
 * cortexPreflight — result of cortex-query.preflight()
 * tier            — 2 | 3
 *
 * Returns a Chunk object ready for emitToPrompt().
 */
function buildChunk(node, graph, cortexPreflight, tier = 2) {
  if (!node)  throw new Error('buildChunk: node is required');
  if (!graph) throw new Error('buildChunk: graph is required');

  const preflight = cortexPreflight ?? { openGaps: [], existingFiles: [], memory: [], crystals: [] };

  // Direct deps only — depth 1. No transitive flood.
  const deps = (node.dependsOn ?? [])
    .map(edge => graph.getNode(edge.targetId))
    .filter(Boolean)
    .map(dep => ({ id: dep.id, name: dep.name, kind: dep.kind, confidence: dep.confidence }));

  // Analogues: same-kind GREEN nodes already implemented — examples, not templates
  const analogues = graph.getNodesByKind(node.kind)
    .filter(n => n.id !== node.id && n.confidence === 'GREEN')
    .slice(0, 2)
    .map(n => ({ id: n.id, name: n.name }));

  // Gates from gate_pipeline (names only — compact)
  const gates = (node.gatePipeline ?? []).map(g => ({
    id:     g.id   ?? g,
    label:  g.label ?? String(g),
    input:  g.input  ?? null,
    output: g.output ?? null,
  }));

  // Events (produce + consume)
  const events = {
    produces: (node.produces ?? []).map(e => ({ name: e.name, payloadShape: e.payloadShape ?? '{}' })),
    consumes: (node.consumes ?? []).map(e => ({ name: e.name, payloadShape: e.payloadShape ?? '{}' })),
  };

  // Constraints — ID + one-line statement only (not full enforcement text)
  const constraints = (node.constraints ?? []).map(c => ({
    id:       c.id,
    statement: c.statement ?? c.description ?? '',
    type:      c.type ?? 'hard',
  }));

  // Error paths declared in spec
  const errorPaths = node.errorPaths ?? [];

  // Behavioral contracts (each one → one test)
  const contracts = node.behavioralContracts ?? [];

  // Open gaps from Cortex relevant to this node
  const gaps = preflight.openGaps
    .filter(g => g.path?.includes(node.name) || g.path?.includes(node.id))
    .map(g => ({ id: g.uuid, type: g.type, severity: g.severity, body: g.body }));

  // What Cortex already knows — inject as context (prevents hallucination)
  const cortexContext = {
    projectExists:   !!preflight.project,
    existingFileCount: (preflight.existingFiles ?? []).length,
    crystals:        (preflight.crystals ?? []).slice(0, 3).map(c => c.content),
    memory:          (preflight.memory   ?? []).slice(0, 2).map(m => m.content),
    openGapCount:    gaps.length,
  };

  // Auto-generate SEAM contract from exports + gates + behavioral contracts
  const seamContract = buildSeamContract(node);

  // Token budget per tier
  // T2: 1024 (raised from 800 — dense well-specced modules are real, not errors)
  // Advisory thresholds: WARN > 85%, CRITICAL > 95% of budget
  const budget      = tier === 2 ? 1024 : 2000;
  const warnAt      = Math.floor(budget * 0.85);
  const criticalAt  = Math.floor(budget * 0.95);

  return {
    // ── Identity ────────────────────────────────────────────────────────
    chunkId:     `chunk-${node.id}-t${tier}-${Date.now()}`,
    tier,
    specRef:     node.specRef    ?? null,
    specDepth:   node.specDepth  ?? 0,
    genReadiness:node.generationReadiness ?? 0,
    confidence:  node.confidence ?? 'RED',

    // ── Subject ─────────────────────────────────────────────────────────
    subject: {
      id:          node.id,
      name:        node.name,
      kind:        node.kind,
      description: (node.description ?? '').slice(0, 300), // hard cap
      uuid:        node.uuid ?? null,
    },

    // ── Signatures (what to implement) ──────────────────────────────────
    signatures: (node.exports ?? []).map(ex => ({
      signature: ex,
      stub:      exportToStub(ex, node.name),
    })),

    // ── Structure ────────────────────────────────────────────────────────
    deps,
    gates,
    events,
    constraints,
    errorPaths,
    contracts,
    analogues,
    gaps,

    // ── Cortex context ───────────────────────────────────────────────────
    cortexContext,

    // ── SEAM acceptance criterion ────────────────────────────────────────
    seamContract,

    // ── Token budget ─────────────────────────────────────────────────────
    budget,
    warnAt,
    criticalAt,
  };
}

// ── SEAM contract auto-generation ────────────────────────────────────────────

function buildSeamContract(node) {
  const tests = [];

  // One test per export
  for (const ex of (node.exports ?? [])) {
    tests.push({
      kind:    'export',
      label:   `${ex} exists and is callable`,
      check:   `typeof module.${exportName(ex)} === 'function'`,
    });
  }

  // One test per gate
  for (const g of (node.gatePipeline ?? [])) {
    tests.push({
      kind:  'gate',
      label: `Gate ${g.id ?? g} is registered`,
      check: `stream has handler for ${g.id ?? g}`,
    });
  }

  // One test per behavioral contract
  for (const bc of (node.behavioralContracts ?? [])) {
    tests.push({
      kind:  'contract',
      label: bc.slice(0, 120),
      check: 'manual verification',
    });
  }

  // One test per error path
  for (const ep of (node.errorPaths ?? [])) {
    tests.push({
      kind:  'error_path',
      label: `handles: ${ep.slice(0, 80)}`,
      check: 'error path test',
    });
  }

  return {
    nodeId:    node.id,
    version:   '1.0.0',
    passCount: tests.filter(t => t.kind === 'export').length,
    tests,
  };
}

// ── Prompt emitter — converts Chunk to LLM prompt string ─────────────────────

/**
 * emitToPrompt(chunk, options)
 *
 * Produces the minimal prompt for a small LLM.
 * Stripped of all narrative. Pure signal.
 * Target: ~400-800 tokens for Tier 2, ~800-1600 for Tier 3.
 */
function emitToPrompt(chunk, options = {}) {
  const { includeAnalogues = true, includeMemory = true } = options;
  const lines = [];

  // ── System header (ultra-compact) ────────────────────────────────────────
  lines.push(`# IMPLEMENT: ${chunk.subject.name} [${chunk.subject.kind}]`);
  lines.push(`# Tier ${chunk.tier} | Confidence: ${chunk.confidence} | specDepth: ${chunk.specDepth.toFixed(2)}`);
  if (chunk.cortexContext.projectExists) {
    lines.push(`# Cortex: project exists | ${chunk.cortexContext.existingFileCount} files known | ${chunk.cortexContext.openGapCount} open gaps`);
  }
  lines.push('');

  // ── Description (capped) ─────────────────────────────────────────────────
  if (chunk.subject.description) {
    lines.push(`## Purpose`);
    lines.push(chunk.subject.description);
    lines.push('');
  }

  // ── Constraints (IDs + one-liners) ───────────────────────────────────────
  if (chunk.constraints.length) {
    lines.push(`## Constraints (MUST satisfy)`);
    for (const c of chunk.constraints) {
      lines.push(`- [${c.id}] ${c.statement}`);
    }
    lines.push('');
  }

  // ── Dependencies (names only — not implementations) ───────────────────────
  if (chunk.deps.length) {
    lines.push(`## Dependencies (do not implement — import only)`);
    for (const d of chunk.deps) {
      lines.push(`- ${d.name} [${d.kind}] (${d.confidence})`);
    }
    lines.push('');
  }

  // ── Gate pipeline ─────────────────────────────────────────────────────────
  if (chunk.gates.length) {
    lines.push(`## Gate Pipeline (implement each gate)`);
    for (const g of chunk.gates) {
      const arrow = g.input && g.output ? ` ${g.input} → ${g.output}` : '';
      lines.push(`- ${g.id}:${arrow}`);
    }
    lines.push('');
  }

  // ── Events ────────────────────────────────────────────────────────────────
  if (chunk.events.produces.length || chunk.events.consumes.length) {
    lines.push(`## Events`);
    for (const e of chunk.events.produces) lines.push(`- EMITS:    ${e.name}  ${e.payloadShape}`);
    for (const e of chunk.events.consumes) lines.push(`- CONSUMES: ${e.name}  ${e.payloadShape}`);
    lines.push('');
  }

  // ── Error paths ───────────────────────────────────────────────────────────
  if (chunk.errorPaths.length) {
    lines.push(`## Error Paths (must handle)`);
    for (const ep of chunk.errorPaths) lines.push(`- ${ep}`);
    lines.push('');
  }

  // ── Open gaps from Cortex ─────────────────────────────────────────────────
  if (chunk.gaps.length) {
    lines.push(`## Open Gaps (context — these are known unknowns)`);
    for (const g of chunk.gaps) {
      lines.push(`- [${g.severity}] ${g.type}: ${g.body.slice(0, 100)}`);
    }
    lines.push('');
  }

  // ── Cortex memory (crystals) ──────────────────────────────────────────────
  if (includeMemory && chunk.cortexContext.crystals.length) {
    lines.push(`## Cortex Knowledge`);
    for (const c of chunk.cortexContext.crystals) lines.push(`- ${c.slice(0, 120)}`);
    lines.push('');
  }

  // ── Analogues ─────────────────────────────────────────────────────────────
  if (includeAnalogues && chunk.analogues.length) {
    lines.push(`## Analogues (same-kind GREEN nodes — study, don't copy)`);
    for (const a of chunk.analogues) lines.push(`- ${a.name} [${a.id}]`);
    lines.push('');
  }

  // ── Function stubs (what to fill in) ─────────────────────────────────────
  lines.push(`## Implement`);
  lines.push(`// §1.2 Nothing silently fails. §1.3 No stubs. §2.1 Persistence first.`);
  lines.push('');
  for (const sig of chunk.signatures) {
    lines.push(sig.stub);
    lines.push('');
  }

  // ── SEAM contract (acceptance criterion) ─────────────────────────────────
  lines.push(`## SEAM Contract (must pass)`);
  for (const t of chunk.seamContract.tests.slice(0, 8)) {
    lines.push(`- [ ] ${t.label}`);
  }

  const prompt = lines.join('\n');

  // Threshold reporting — warn on density, not just overflow
  const approxTokens = Math.ceil(prompt.length / 4);
  if (approxTokens >= chunk.criticalAt) {
    console.warn(`[chunk] ${chunk.subject.name}: ~${approxTokens} tokens CRITICAL (${Math.round(approxTokens/chunk.budget*100)}% of ${chunk.budget} budget)`);
  } else if (approxTokens >= chunk.warnAt) {
    console.warn(`[chunk] ${chunk.subject.name}: ~${approxTokens} tokens WARN (${Math.round(approxTokens/chunk.budget*100)}% of ${chunk.budget} budget — dense but within limits)`);
  }

  return prompt;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function exportName(exportStr) {
  // "parse(tokens: SpecToken[]) → ParsedSpec"  →  "parse"
  const m = exportStr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
  return m ? m[1] : exportStr;
}

function exportToStub(exportStr, moduleName) {
  const name   = exportName(exportStr);
  const isAsync = exportStr.includes('Promise') || exportStr.includes('async');
  const prefix  = isAsync ? 'async ' : '';
  return [
    `// ${exportStr}`,
    `${prefix}function ${name}(...args) {`,
    `  // TODO: implement ${name}`,
    `  // §1.3 No stubs in production — replace this body`,
    `  throw new Error('${moduleName}.${name}: not implemented');`,
    `}`,
  ].join('\n');
}

// ── Token counter (approximate) ───────────────────────────────────────────────

function estimateTokens(chunk) {
  const prompt = emitToPrompt(chunk);
  return Math.ceil(prompt.length / 4);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  buildChunk,
  emitToPrompt,
  buildSeamContract,
  estimateTokens,
};
