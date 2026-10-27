'use strict';
/**
 * kg-builder.js — Knowledge Graph builder
 * UUID: spec-compiler-kg-builder-v1-0000-0001
 * Version: 1.0.0
 *
 * Transforms a ParsedSpec into a KnowledgeGraph: a queryable, self-aware
 * graph of every declared entity — modules, events, gates, schemas, interfaces.
 *
 * Implemented as SISO gates. The build pipeline is itself a stream:
 *
 *   kg.build         → BuildNodesGate     → kg.nodes.built
 *   kg.nodes.built   → BuildEdgesGate     → kg.edges.built
 *   kg.edges.built   → ScoreGate          → kg.scored
 *   kg.scored        → BlastRadiusGate    → kg.blast.done
 *   kg.blast.done    → AssembleGate       → kg.complete  (→ pending)
 *
 * §1.1  Nothing exists until proven — BLACK nodes for referenced-but-undeclared.
 * §1.2  Nothing silently fails — every gap is a typed node.
 * specDepth computation: from spec-parser.spec §MOD-KG-BUILDER.specDepth_computation
 * generationReadiness:   min(effectiveSpecDepth, min(dep.generationReadiness))
 *
 * OUTPUTS per node:
 *   specDepth          float 0.0–1.0  (own completeness)
 *   effectiveSpecDepth float 0.0–1.0  (min of own + referenced schemas)
 *   generationReadiness float 0.0–1.0 (min of effective + all dep readiness)
 *   confidence         GREEN | AMBER | RED | BLACK
 *   blastRadius        KGNode[]  (what breaks if this node changes)
 *   gaps               Gap[]     (what's missing, ranked by downstream impact)
 */

const { Event, Gate, Stream, StreamLog } = require('../siso');

// ── Event type constants ──────────────────────────────────────────────────────

const KG = {
  BUILD:       'kg.build',
  NODES_BUILT: 'kg.nodes.built',
  EDGES_BUILT: 'kg.edges.built',
  SCORED:      'kg.scored',
  BLAST_DONE:  'kg.blast.done',
  COMPLETE:    'kg.complete',
  ERROR:       'kg.error',
};

// ── specDepth thresholds (from spec-parser.spec §specDepth_computation) ───────

const DEPTH = {
  NONE:        0.0,
  NAME:        0.1,
  DESCRIPTION: 0.2,
  EXPORTS:     0.3,
  GATES:       0.5,
  CONTRACTS:   0.7,
  ERROR_PATHS: 0.85,
  FULL:        1.0,
};

// ── Confidence assignment ─────────────────────────────────────────────────────
// GREEN  = generationReadiness >= 0.8
// AMBER  = generationReadiness >= 0.5
// RED    = generationReadiness >= 0.1 (declared, partially specced)
// BLACK  = referenced but never declared (specDepth = 0, no source block)

function assignConfidence(genReadiness, isBlack = false) {
  if (isBlack)          return 'BLACK';
  if (genReadiness >= 0.8) return 'GREEN';
  if (genReadiness >= 0.5) return 'AMBER';
  return 'RED';
}

// ── Gate 1: BuildNodesGate ────────────────────────────────────────────────────
// kg.build → kg.nodes.built
// Converts every declared entity in ParsedSpec into a KGNode.
// Also creates BLACK nodes for any referenced-but-undeclared ids.

class BuildNodesGate extends Gate {
  constructor() { super(KG.BUILD); }

  transform(event, stream) {
    const { parsedSpec } = event.data;
    const nodes = new Map();   // id → KGNode
    const allIds = new Set();  // every declared id
    const refs   = new Set();  // every referenced id (in deps, gate pipeline, events)

    // ── Modules ──────────────────────────────────────────────────────────────
    for (const mod of (parsedSpec.modules ?? [])) {
      const id   = mod.id ?? mod.name;
      const node = buildNode(id, mod, 'module');
      nodes.set(id, node);
      allIds.add(id);
      if (mod.name && mod.name !== id) allIds.add(mod.name); // name alias

      // Collect refs from deps
      for (const dep of (mod.deps ?? mod.runtime_deps ?? [])) {
        if (dep.name) refs.add(dep.name);
      }
      // Gate pipeline entries are stage labels, NOT module references.
      // Only explicit dep declarations become refs (and potential BLACK nodes).
    }

    // ── Events ───────────────────────────────────────────────────────────────
    const evBlock = parsedSpec.events ?? parsedSpec.event_model ?? {};
    const eventList = Array.isArray(evBlock)
      ? evBlock
      : Object.values(evBlock).flat();

    for (const ev of eventList) {
      const raw   = typeof ev === 'string' ? ev : (ev.name ?? ev.id ?? '');
      const name  = raw.split(/[\s{]/)[0];
      if (!name) continue;
      const id    = `event:${name}`;

      // Parse payload block: 'event.name { field1, field2 }' — extract capitalised names as schema_refs
      const payloadMatch = raw.match(/\{([^}]+)\}/);
      const payloadFields = payloadMatch
        ? payloadMatch[1].split(',').map(s => s.trim()).filter(Boolean)
        : [];
      // Capitalised standalone words in payload are likely schema type refs
      const schemaRefs = payloadFields.filter(f => /^[A-Z][A-Za-z]+$/.test(f));

      const node = buildNode(id, {
        id,
        name,
        description: typeof ev === 'string' ? ev : null,
        schema_refs: schemaRefs,
        payload_fields: payloadFields,
      }, 'event');
      nodes.set(id, node);
      allIds.add(id);
    }

    // ── Schemas ───────────────────────────────────────────────────────────────
    for (const schema of (parsedSpec.schemas ?? [])) {
      const id   = schema.id ?? schema.name;
      if (!id) continue;
      const node = buildNode(id, schema, 'schema');
      nodes.set(id, node);
      allIds.add(id);
    }

    // ── Interfaces ────────────────────────────────────────────────────────────
    const ifaceList = Array.isArray(parsedSpec.interfaces) ? parsedSpec.interfaces : Object.values(parsedSpec.interfaces ?? {});
    for (const iface of ifaceList) {
      const id   = iface.id ?? iface.name;
      if (!id) continue;
      const node = buildNode(id, iface, 'interface');
      nodes.set(id, node);
      allIds.add(id);
    }

    // Build a name→id index so ref lookups can find nodes by name
    // Build name→id index for fast ref resolution
    const nameIndex = new Map();
    for (const [id, node] of nodes) nameIndex.set(node.name, id);

    // ── BLACK nodes — referenced but never declared ───────────────────────────
    for (const refId of refs) {
      // Skip if already declared by id or by name
      const alreadyDeclared = allIds.has(refId) || nodes.has(refId) || nameIndex.has(refId);
      if (alreadyDeclared) continue;

      // Not declared anywhere — create BLACK node
      {
        const blackNode = {
          id:                   refId,
          name:                 refId,
          kind:                 'unknown',
          uuid:                 null,
          description:          null,
          specDepth:            0.0,
          effectiveSpecDepth:   0.0,
          generationReadiness:  0.0,
          confidence:           'BLACK',
          isBlack:              true,
          declaredIn:           null,
          exports:              [],
          gatePipeline:         [],
          behavioralContracts:  [],
          errorPaths:           [],
          constraints:          [],
          deps:                 [],
          produces:             [],
          consumes:             [],
          blastRadius:          [],
          gaps:                 [],
          specRef:              null,
        };
        nodes.set(refId, blackNode);
      }
    }

    stream.emit(new Event(KG.NODES_BUILT, {
      ...event.data,
      nodes,
      allIds,
    }));
  }
}

// ── Gate 2: BuildEdgesGate ────────────────────────────────────────────────────
// kg.nodes.built → kg.edges.built
// Builds typed edges between nodes: depends_on, produces, consumes, enforces.

class BuildEdgesGate extends Gate {
  constructor() { super(KG.NODES_BUILT); }

  transform(event, stream) {
    const { parsedSpec, nodes } = event.data;
    const edges = [];  // { from, to, kind }

    for (const mod of (parsedSpec.modules ?? [])) {
      const fromId = mod.id ?? mod.name;
      if (!nodes.has(fromId)) continue;

      // depends_on edges
      for (const dep of (mod.deps ?? mod.runtime_deps ?? [])) {
        const toId = dep.id ?? dep.name;
        // Try exact id first, then search by name
        const depNode = nodes.get(toId)
          ?? [...nodes.values()].find(n => n.name === (dep.name ?? toId));
        if (depNode) {
          edges.push({ from: fromId, to: depNode.id, kind: 'depends_on' });
          nodes.get(fromId).deps.push({ id: depNode.id, name: depNode.name });
        }
      }

      // produces / consumes edges from event declarations
      for (const ev of (mod.produces ?? [])) {
        const evId = `event:${ev.name ?? ev}`;
        if (nodes.has(evId)) {
          edges.push({ from: fromId, to: evId, kind: 'produces' });
          nodes.get(fromId).produces.push({ name: ev.name ?? ev, payloadShape: ev.payloadShape ?? '{}' });
        }
      }
      for (const ev of (mod.consumes ?? [])) {
        const evId = `event:${ev.name ?? ev}`;
        if (nodes.has(evId)) {
          edges.push({ from: fromId, to: evId, kind: 'consumes' });
          nodes.get(fromId).consumes.push({ name: ev.name ?? ev, payloadShape: ev.payloadShape ?? '{}' });
        }
      }
    }

    stream.emit(new Event(KG.EDGES_BUILT, {
      ...event.data,
      edges,
    }));
  }
}

// ── Gate 3: ScoreGate ─────────────────────────────────────────────────────────
// kg.edges.built → kg.scored
// Computes specDepth, effectiveSpecDepth, generationReadiness, confidence per node.
// Two-pass: own scores first, then propagate through dep edges.

class ScoreGate extends Gate {
  constructor() { super(KG.EDGES_BUILT); }

  transform(event, stream) {
    const { nodes, edges, parsedSpec } = event.data;

    // Pass 1: own specDepth for every non-BLACK node
    for (const [id, node] of nodes) {
      if (node.isBlack) continue;

      const raw = node._raw ?? {};
      let depth = DEPTH.NONE;
      if (raw.name || node.name !== id)            depth = Math.max(depth, DEPTH.NAME);
      if (raw.description || raw.purpose)          depth = Math.max(depth, DEPTH.DESCRIPTION);
      if ((raw.exports        ?? []).length > 0)   depth = Math.max(depth, DEPTH.EXPORTS);
      if ((raw.gate_pipeline  ?? []).length > 0)   depth = Math.max(depth, DEPTH.GATES);
      if ((raw.behavioral_contracts ?? []).length > 0) depth = Math.max(depth, DEPTH.CONTRACTS);
      if ((raw.error_paths    ?? []).length > 0)   depth = Math.max(depth, DEPTH.ERROR_PATHS);
      // Schema nodes: fields are the completeness signal (no exports/gates/contracts)
      if (node.kind === 'schema') {
        const fieldCount = Object.keys(raw.fields ?? {}).length;
        if (fieldCount >= 8) depth = Math.max(depth, DEPTH.FULL);
        else if (fieldCount >= 4) depth = Math.max(depth, DEPTH.CONTRACTS);
        else if (fieldCount > 0)  depth = Math.max(depth, DEPTH.EXPORTS);
      }

      // FULL requires all declared fields + any explicit schema_refs resolve
      const explicitRefs = (raw.schema_refs ?? []);
      const unresolvedExplicit = explicitRefs.filter(s =>
        !nodes.has(s) && !nodes.has(`schema:${s}`)
      );
      if (depth >= DEPTH.ERROR_PATHS && unresolvedExplicit.length === 0) {
        depth = DEPTH.FULL;
      }

      node.specDepth = depth;

      // effectiveSpecDepth: min of own depth and *explicitly declared* schema refs.
      // We do NOT penalise export type signatures — those are TypeScript notation,
      // not spec-declared schema dependencies. Only schema_refs or schema deps reduce depth.
      const explicitSchemaRefs = (raw.schema_refs ?? []);
      const schemaDepths = explicitSchemaRefs.map(s => {
        const schemaNode = nodes.get(s) ?? nodes.get(`schema:${s}`);
        return schemaNode ? schemaNode.specDepth : 0.5; // unknown schema → 0.5 penalty, not 0.0
      });
      node.effectiveSpecDepth = schemaDepths.length > 0
        ? Math.min(depth, ...schemaDepths)
        : depth;
    }

    // Pass 2: generationReadiness — propagate through dep graph
    // Uses topological relaxation: iterate until stable (max 10 passes for cycles)
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      for (const [id, node] of nodes) {
        if (node.isBlack) continue;
        const depEdges = edges.filter(e => e.from === id && e.kind === 'depends_on');
        const depReadiness = depEdges.map(e => {
          const dep = nodes.get(e.to);
          return dep ? dep.generationReadiness : 0.0;
        });
        const newReadiness = depReadiness.length > 0
          ? Math.min(node.effectiveSpecDepth, ...depReadiness)
          : node.effectiveSpecDepth;
        if (Math.abs(newReadiness - node.generationReadiness) > 0.001) {
          node.generationReadiness = newReadiness;
          changed = true;
        }
      }
      if (!changed) break;
    }

    // Pass 3: confidence from generationReadiness
    for (const [, node] of nodes) {
      node.confidence = assignConfidence(node.generationReadiness, node.isBlack);
    }

    stream.emit(new Event(KG.SCORED, { ...event.data }));
  }
}

// ── Gate 4: BlastRadiusGate ───────────────────────────────────────────────────
// kg.scored → kg.blast.done
// For each node: compute which other nodes break if this node changes.
// Also populates node.gaps — ranked by downstream impact.

class BlastRadiusGate extends Gate {
  constructor() { super(KG.SCORED); }

  transform(event, stream) {
    const { nodes, edges } = event.data;

    // Build reverse adjacency: who depends on me?
    const reverseDeps = new Map();  // nodeId → Set of dependents
    for (const [id] of nodes) reverseDeps.set(id, new Set());
    for (const edge of edges) {
      if (edge.kind === 'depends_on') {
        if (!reverseDeps.has(edge.to)) reverseDeps.set(edge.to, new Set());
        reverseDeps.get(edge.to).add(edge.from);
      }
    }

    // BFS blast radius for each node
    for (const [id, node] of nodes) {
      const visited = new Set();
      const queue   = [id];
      while (queue.length > 0) {
        const cur = queue.shift();
        for (const dep of (reverseDeps.get(cur) ?? [])) {
          if (!visited.has(dep)) {
            visited.add(dep);
            queue.push(dep);
          }
        }
      }
      visited.delete(id); // exclude self
      node.blastRadius = [...visited].map(bid => ({
        id:   bid,
        name: nodes.get(bid)?.name ?? bid,
        kind: nodes.get(bid)?.kind ?? 'unknown',
      }));

      // Gaps: what's missing from this node, ranked by blast radius size
      node.gaps = computeGaps(node, node.blastRadius.length);
    }

    stream.emit(new Event(KG.BLAST_DONE, { ...event.data }));
  }
}

// ── Gate 5: AssembleGate ──────────────────────────────────────────────────────
// kg.blast.done → kg.complete
// Packages nodes + edges + meta into the final KnowledgeGraph object.

class AssembleGate extends Gate {
  constructor() { super(KG.BLAST_DONE); }

  transform(event, stream) {
    const { nodes, edges, parsedSpec } = event.data;

    const nodeArr = [...nodes.values()];

    const graph = {
      // ── Core data ──────────────────────────────────────────────────────────
      nodes,      // Map<id, KGNode> — primary store
      edges,      // Edge[]

      // ── Meta ───────────────────────────────────────────────────────────────
      meta: {
        specName:    parsedSpec.meta?.name    ?? 'unknown',
        specVersion: parsedSpec.meta?.version ?? '0.0.0',
        nodeCount:   nodeArr.length,
        edgeCount:   edges.length,
        blackCount:  nodeArr.filter(n => n.isBlack).length,
        greenCount:  nodeArr.filter(n => n.confidence === 'GREEN').length,
        amberCount:  nodeArr.filter(n => n.confidence === 'AMBER').length,
        redCount:    nodeArr.filter(n => n.confidence === 'RED').length,
        builtAt:     Date.now(),
      },

      // ── Query interface ────────────────────────────────────────────────────
      getNode(id)          { return nodes.get(id) ?? null; },
      getNodeByName(name)  { return nodeArr.find(n => n.name === name) ?? null; },
      getNodesByKind(kind) { return nodeArr.filter(n => n.kind === kind); },
      getNodesByConfidence(c) { return nodeArr.filter(n => n.confidence === c); },
      getBlackNodes()      { return nodeArr.filter(n => n.isBlack); },
      getBlastRadius(id)   { return nodes.get(id)?.blastRadius ?? []; },
      getGaps(minImpact = 0) {
        return nodeArr
          .flatMap(n => n.gaps)
          .filter(g => g.impact >= minImpact)
          .sort((a, b) => b.impact - a.impact);
      },
      getChunk(id, cortexPreflight = null, tier = 2) {
        const node = nodes.get(id);
        if (!node) return null;
        // Lazy import chunk builder to avoid circular dep
        const { buildChunk } = require('../chunk');
        return buildChunk(node, graph, cortexPreflight, tier);
      },
      getChain(fromId, toId) {
        // BFS path from fromId to toId through depends_on edges
        const visited = new Set([fromId]);
        const queue   = [[fromId]];
        while (queue.length) {
          const path = queue.shift();
          const cur  = path[path.length - 1];
          if (cur === toId) return path;
          for (const edge of edges) {
            if (edge.from === cur && edge.kind === 'depends_on' && !visited.has(edge.to)) {
              visited.add(edge.to);
              queue.push([...path, edge.to]);
            }
          }
        }
        return null; // no path
      },

      // ── Ordering ───────────────────────────────────────────────────────────
      // Bottom-up build order: deps before dependents.
      // Primary sort: ascending generationReadiness (foundations first).
      // Tiebreaker: topological order — if A depends on B, B must come first
      // even when both have equal readiness.
      getBuildOrder() {
        const nonBlack = [...nodeArr].filter(n => !n.isBlack);
        // Build dep-count map for topological tiebreaking
        const depCount = new Map(nonBlack.map(n => [n.id, 0]));
        for (const edge of edges) {
          if (edge.kind !== 'depends_on') continue;
          // edge.from depends on edge.to → edge.from should come AFTER edge.to
          // So edge.from's position in sort should be higher
          if (depCount.has(edge.from)) depCount.set(edge.from, (depCount.get(edge.from) ?? 0) + 1);
        }
        const tiebreak = (a, b) => {
          // Primary: lower readiness first (foundations first)
          const rDiff = a.generationReadiness - b.generationReadiness;
          if (Math.abs(rDiff) > 0.001) return rDiff;
          // Tiebreaker: fewer deps first (more foundational), then id (deterministic)
          return ((depCount.get(a.id) ?? 0) - (depCount.get(b.id) ?? 0)) || String(a.id).localeCompare(String(b.id));
        };
        // §2026-10-20 (SPEC_COMPILER.spec MOD-KG-BUILDER) — a topological order (Kahn) with the old sort as the tiebreak among
        // nodes ready together. The sort alone put a dependent before its foundation whenever the foundation was more ready
        // (chains longer than two, fully specced interfaces), and INV-007 reported false build-order violations.
        const byId = new Map(nonBlack.map(n => [n.id, n]));
        const waits = new Map(nonBlack.map(n => [n.id, new Set()]));
        const after = new Map(nonBlack.map(n => [n.id, []]));
        for (const edge of edges) {
          if (edge.kind !== 'depends_on' || !byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) continue;
          waits.get(edge.from).add(edge.to); after.get(edge.to).push(edge.from);
        }
        const out = [], done = new Set();
        let ready = nonBlack.filter(n => waits.get(n.id).size === 0).sort(tiebreak);
        while (ready.length) {
          const n = ready.shift(); out.push(n); done.add(n.id);
          for (const d of after.get(n.id)) { const w = waits.get(d); w.delete(n.id); if (w.size === 0 && !done.has(d)) ready.push(byId.get(d)); }
          ready.sort(tiebreak);
        }
        // a cycle's members: after the acyclic part, in the tiebreak order (the invariants engine names the cycle)
        return out.concat(nonBlack.filter(n => !done.has(n.id)).sort(tiebreak));
      },
    };

    stream.emit(new Event(KG.COMPLETE, { graph }));
  }
}

// ── Gap computation ───────────────────────────────────────────────────────────

function computeGaps(node, blastSize) {
  const gaps = [];
  const impact = blastSize / 50; // normalise blast size to 0-1 (50 = large system)

  if (!node.isBlack) {
    // Only modules need exports — events/schemas/interfaces are data declarations
    const isModule = !node.kind || node.kind === 'module' || node.kind === 'unknown';
    if (isModule && (node._raw?.exports ?? []).length === 0)
      gaps.push({ nodeId: node.id, kind: 'missing_exports',    description: 'No exports declared', impact: Math.min(1, impact + 0.2), blocksNodes: node.blastRadius?.map(n=>n.id) ?? [] });
    if (isModule && (node._raw?.gate_pipeline ?? []).length === 0 && node.kind === 'module')
      gaps.push({ nodeId: node.id, kind: 'missing_gate_logic', description: 'No gate_pipeline declared', impact: Math.min(1, impact + 0.1), blocksNodes: node.blastRadius?.map(n=>n.id) ?? [] });
    if (isModule && (node._raw?.behavioral_contracts ?? []).length === 0 && node.kind === 'module')
      gaps.push({ nodeId: node.id, kind: 'missing_behavioral_contract', description: 'No behavioral_contracts declared', impact, blocksNodes: [] });
    if (isModule && (node._raw?.error_paths ?? []).length === 0 && node.kind === 'module')
      gaps.push({ nodeId: node.id, kind: 'missing_error_paths', description: 'No error_paths declared', impact: impact * 0.8, blocksNodes: [] });
  } else {
    gaps.push({ nodeId: node.id, kind: 'orphaned_reference', description: `'${node.id}' is referenced but never declared`, impact: Math.min(1, impact + 0.5), blocksNodes: node.blastRadius?.map(n=>n.id) ?? [] });
  }

  return gaps.sort((a, b) => b.impact - a.impact);
}

// ── Node factory ──────────────────────────────────────────────────────────────

function buildNode(id, raw, kind) {
  return {
    id,
    name:                 raw.name ?? id,
    kind,
    uuid:                 raw.uuid ?? null,
    description:          raw.description ?? raw.purpose ?? null,
    specDepth:            0.0,
    effectiveSpecDepth:   0.0,
    generationReadiness:  0.0,
    confidence:           'RED',
    isBlack:              false,
    declaredIn:           raw.file_ref ?? null,
    exports:              raw.exports ?? [],
    gatePipeline:         raw.gate_pipeline ?? [],
    behavioralContracts:  raw.behavioral_contracts ?? [],
    errorPaths:           raw.error_paths ?? [],
    constraints:          raw.constraints ?? [],
    deps:                 [],       // populated by BuildEdgesGate
    produces:             [],       // populated by BuildEdgesGate
    consumes:             [],       // populated by BuildEdgesGate
    blastRadius:          [],       // populated by BlastRadiusGate
    gaps:                 [],       // populated by BlastRadiusGate
    specRef:              raw.spec_ref ?? null,
    _raw:                 raw,      // preserve source for ScoreGate
  };
}

// ── KG pipeline factory ───────────────────────────────────────────────────────

function createKGPipeline(logLevel = 'EVENTS') {
  const log    = new StreamLog(logLevel);
  const stream = new Stream({ log });

  stream.register(new BuildNodesGate());
  stream.register(new BuildEdgesGate());
  stream.register(new ScoreGate());
  stream.register(new BlastRadiusGate());
  stream.register(new AssembleGate());

  return { stream, log };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * build(parsedSpec, options)
 *
 * Synchronous — the KG pipeline has no async gates (pure computation).
 * Returns KnowledgeGraph directly.
 */
function build(parsedSpec, options = {}) {
  const { logLevel = 'EVENTS' } = options;
  const { stream, log } = createKGPipeline(logLevel);

  stream.emit(new Event(KG.BUILD, { parsedSpec }));

  const { pending } = stream.sampleHere();

  const complete = pending.find(e => e.type === KG.COMPLETE);
  if (complete) return { ok: true, graph: complete.data.graph, log };

  const error = pending.find(e => e.type === KG.ERROR);
  if (error)   return { ok: false, error: error.data.error, log };

  return { ok: false, error: 'KG pipeline produced no result', pending, log };
}

module.exports = {
  build,
  createKGPipeline,
  buildNode,
  computeGaps,
  assignConfidence,
  DEPTH,
  KG,
};
