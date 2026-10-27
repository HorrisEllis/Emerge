spec:

  # ════════════════════════════════════════════════════════════════════════════
  # SPEC_COMPILER.spec
  # The spec for the spec compiler.
  # This is the bootstrap — it describes the system that reads specs.
  # When the compiler can compile this file and produce correct output,
  # the loop is closed.
  # ════════════════════════════════════════════════════════════════════════════

  meta:
    name:        spec-compiler
    version:     1.0.0
    author:      james-brooks
    created_at:  2026-06-10T00:00:00Z
    status:      bootstrapping
    uuid:        spec-compiler-v1-0000-2026-0610-jamesbrooks-001
    purpose: >
      The spec compiler reads .spec files and emits code deterministically.
      Token cost for T0+T1: zero.
      Token cost for T2+T3: one chunk per node, scoped to that node only.
      Cortex is queried before any emission — nothing is re-built if it already exists.
    tagline: "Compress intent. Decompress deterministically. Pay tokens once."
    target_runtime: [node]
    language_stack: [javascript]
    paradigm: [SISO, functional, deterministic, cortex-first]
    deps:
      - name: js-yaml
        version: ">=4.1.0"
        required: true
        purpose: .spec file parse
      - name: cortex
        version: ">=2.0.0"
        required: false
        purpose: source of truth — query before generate

    constraints:
      - id: CC-001
        description: Query Cortex before emitting anything. If Cortex has it, skip.
        type: hard
        enforced_by: [GATE-COMPILER-001]
      - id: CC-002
        description: T0 and T1 emit zero LLM tokens. Fully deterministic.
        type: hard
        enforced_by: [GATE-COMPILER-002]
      - id: CC-003
        description: Chunk token budget is enforced. T2 max 800 tokens. T3 max 2000.
        type: hard
        enforced_by: [GATE-COMPILER-003]
      - id: CC-004
        description: A chunk contains only what is needed for one node. No flooding.
        type: hard
        enforced_by: [GATE-COMPILER-004]
      - id: CC-005
        description: Every emitted file is registered with Cortex via versionium after write.
        type: hard
        enforced_by: [GATE-COMPILER-005]

  modules:

    - id:    MOD-CORTEX-QUERY
      name:  cortex-query
      uuid:  spec-compiler-cortex-query-v1-0000-0001
      description: >
        Implements CORTEX_QUERY_SEAM. Queries Cortex at :3748 before any generation.
        Returns: project existence, existing files, open gaps, seam records, memory.
        Non-fatal if Cortex unreachable — falls back to assume_empty.
      exports:
        - "ping() → CortexHealth"
        - "queryProject(name: string) → ProjectResult"
        - "queryFiles(project: string) → FilesResult"
        - "queryGaps(path: string, severity?: string) → GapsResult"
        - "querySeams(name: string) → SeamsResult"
        - "queryMemory(q: string) → MemoryResult"
        - "preflight(opts: PreflightOpts) → PreflightResult"
      gate_pipeline:
        - "GATE-CQ-001: moduleName → GET /api/projects → ProjectResult"
        - "GATE-CQ-002: moduleName → GET /api/files → FilesResult"
        - "GATE-CQ-003: moduleName → GET /api/gaps → GapsResult"
        - "GATE-CQ-004: moduleName → GET /api/memory?table=seam_records → SeamsResult"
        - "GATE-CQ-005: moduleName → POST /api/memory/search → MemoryResult"
        - "GATE-CQ-006: all above in parallel → preflight decision → PreflightResult"
      behavioral_contracts:
        - All queries run in parallel in preflight(). No serial waterfall.
        - Cortex unreachability is non-fatal. Returns assume_empty + logs cortex_unreachable gap.
        - Never writes to Cortex. Read-only through this seam.
        - skipGeneration true only if existingFiles.length > 0 AND no high-severity open gaps.
      error_paths:
        - "timeout → {ok:false, code:CORTEX_UNREACHABLE} → fallback assume_empty"
        - ECONNREFUSED → same as timeout
        - "invalid JSON from Cortex → {ok:false, code:PARSE_ERROR} → fallback"

    - id:    MOD-COMPILER-T0
      name:  compiler-t0
      uuid:  spec-compiler-t0-v1-0000-0001
      description: >
        Tier 0: structure emission. Fully deterministic. Zero LLM tokens.
        Input: ParsedSpec + PreflightResult.
        Output: directory tree, empty files, barrel exports, tsconfig, package.json.
        Skips any file already in cortexResult.existingFiles.
        Gate: always runs. specDepth 0.0 is enough.
      exports:
        - "emitT0(parsedSpec: ParsedSpec, outputDir: string, cortexResult?: PreflightResult) → T0Result"
      gate_pipeline:
        - "GATE-T0-001: ParsedSpec → emit package.json (from meta.name, meta.version, deps)"
        - "GATE-T0-002: ParsedSpec → emit tsconfig.json"
        - "GATE-T0-003: ParsedSpec.events → emit src/types/events.ts (const enum)"
        - "GATE-T0-004: ParsedSpec.schemas → emit src/types/schemas.ts (interfaces)"
        - "GATE-T0-005: ParsedSpec → emit src/index.ts (root barrel)"
        - "GATE-T0-006: per module → emit src/modules/{name}/index.ts (module barrel)"
        - "GATE-T0-007: per module → emit src/modules/{name}/{name}.ts (empty impl)"
        - "GATE-T0-008: per module → emit src/modules/{name}/{name}.test.ts (empty test)"
        - "GATE-T0-009: cortexResult.existingFiles → skip any file already present"
      behavioral_contracts:
        - Output is deterministic. Same spec always produces same tree.
        - Existing files (from Cortex) are never overwritten. Skip and log.
        - Empty impl files contain only header comment, specDepth, TODO placeholder.
        - No implementation logic emitted. T0 is structure only.
      error_paths:
        - fs write failure → logged to failures[], not thrown → continue to next file
        - missing meta block → use defaults (name=unknown, version=0.0.1)
        - no modules → emit root files only, no src/modules/

    - id:    MOD-COMPILER-T1
      name:  compiler-t1
      uuid:  spec-compiler-t1-v1-0000-0001
      description: >
        Tier 1: scaffold emission. Fully deterministic. Zero LLM tokens.
        Input: ParsedSpec + KnowledgeGraph (minimal) + PreflightResult.
        Output: typed interfaces, gate stubs with SISO wiring, test describe blocks.
        Gate: generationReadiness > 0.3 per module.
        Injects open gaps from Cortex as TODO comments in stubs.
      exports:
        - "emitT1(parsedSpec: ParsedSpec, graph: KnowledgeGraph, outputDir: string, cortexResult?: PreflightResult) → T1Result"
        - "emitInterface(mod: ParsedModule, spec: ParsedSpec) → string"
        - "emitImpl(mod: ParsedModule, spec: ParsedSpec, gaps: GapRecord[]) → string"
        - "emitTests(mod: ParsedModule, spec: ParsedSpec, gaps: GapRecord[]) → string"
      gate_pipeline:
        - "GATE-T1-001: per module → computeGenReadiness() → skip if below 0.3"
        - "GATE-T1-002: per module → emitInterface() → src/modules/{name}/{name}.interface.ts"
        - "GATE-T1-003: per module → emitImpl() → src/modules/{name}/{name}.ts (with gate stubs)"
        - "GATE-T1-004: per module → emitTests() → src/modules/{name}/{name}.test.ts (describe blocks)"
        - "GATE-T1-005: cortexResult.openGaps → inject as TODO comments in relevant stubs"
      behavioral_contracts:
        - Every exported function produces a typed stub that throws NotImplementedError.
        - Every gate in gate_pipeline produces a commented stream.on() stub.
        - Every behavioral contract produces a commented it() block in test scaffold.
        - Every error path produces a commented it('should handle X') in test scaffold.
        - Open Cortex gaps for this module are injected as GAP comments at top of impl file.
      error_paths:
        - genReadiness below 0.3 → skip with log, not error
        - export signature unparseable → emit stub with raw string as comment
        - fs write failure → logged to failures[], not thrown

    - id:    MOD-CHUNK
      name:  chunk
      uuid:  spec-compiler-chunk-v1-0000-0001
      description: >
        Builds the minimal token payload for T2/T3 LLM generation.
        One chunk = one KGNode. Contains only what that node needs.
        Emits to prompt string. Token budget enforced.
        T2 budget: 800 tokens. T3 budget: 2000 tokens.
      exports:
        - "buildChunk(node: KGNode, graph: KnowledgeGraph, cortexPreflight: PreflightResult, tier: number) → Chunk"
        - "emitToPrompt(chunk: Chunk, options?: EmitOptions) → string"
        - "buildSeamContract(node: KGNode) → SeamContract"
        - "estimateTokens(chunk: Chunk) → number"
      gate_pipeline:
        - "GATE-CHK-001: node → resolve deps (depth 1 only) → minimalContext"
        - "GATE-CHK-002: node → find same-kind GREEN analogues → analogues[]"
        - "GATE-CHK-003: node → extract gates, events, constraints, errorPaths"
        - "GATE-CHK-004: cortexPreflight.openGaps → filter for this node → gaps[]"
        - "GATE-CHK-005: cortexPreflight.crystals → inject as cortexContext"
        - "GATE-CHK-006: auto-generate SeamContract from exports + gates + contracts"
        - "GATE-CHK-007: assemble Chunk"
        - "GATE-CHK-008: emitToPrompt → estimate tokens → warn if over budget"
      behavioral_contracts:
        - Chunk.minimalContext is depth 1 only. No transitive flood.
        - Same KGNode + same graph + same cortex always produces same Chunk. Deterministic.
        - description capped at 300 chars in prompt. No overflow.
        - analogues are examples only — compiler emits note to study, not copy.
        - Token budget warning is advisory only — never blocks generation.
      error_paths:
        - node not found in graph → throw NodeNotFoundError (not silent)
        - missing description → use empty string (not error)
        - over budget → log warning, return full prompt anyway

    # §2026-10-20 — written because kg-builder.js cites "spec-parser.spec §MOD-KG-BUILDER" and that file is not in the tree
    # (lost). James, 2026-10-20: "everything needs  to be speccced before built,so it can be rebuilt if lost." This is the
    # module's contract as the code implements it, plus one correction (build order), specced here before the code changed.
    - id:    MOD-KG-BUILDER
      name:  kg-builder
      uuid:  spec-compiler-kg-builder-v1-0000-0001
      description: >
        Transforms a ParsedSpec into a KnowledgeGraph as a SISO stream: kg.build → BuildNodesGate → BuildEdgesGate → ScoreGate →
        BlastRadiusGate → kg.complete. Nodes: modules, events, schemas, interfaces; a dep naming nothing declared becomes a BLACK
        node. Edges: depends_on (module deps), produces / consumes (module event lists). Score: specDepth per node (NAME 0.1,
        DESCRIPTION 0.2, EXPORTS 0.3, GATES 0.5, CONTRACTS 0.7, ERROR_PATHS 0.85, FULL 1.0 when error paths are present and every
        explicit schema_ref resolves; schemas by field count ≥8 FULL, ≥4 CONTRACTS); effectiveSpecDepth = min with referenced schemas.
      exports:
        - "build(parsedSpec, { logLevel }) → { ok, graph, log }"
        - "graph.getNode(id) · getNodeByName(name) · getNodesByKind(kind) · getBlackNodes() · getBlastRadius(id) · getGaps() · getChunk(id) · getChain(id)"
        - "graph.getBuildOrder() → KGNode[] (non-BLACK) — foundations first"
      gate_pipeline:
        - "GATE-KG-001: parsedSpec → BuildNodesGate → nodes (modules, events, schemas, interfaces, BLACK refs)"
        - "GATE-KG-002: nodes → BuildEdgesGate → depends_on / produces / consumes edges"
        - "GATE-KG-003: nodes + edges → ScoreGate → specDepth, effectiveSpecDepth, generationReadiness, confidence"
        - "GATE-KG-004: graph → BlastRadiusGate → blastRadius and gaps per node"
      behavioral_contracts:
        - "same parsedSpec → same graph (deterministic)"
        - "getBuildOrder() is a TOPOLOGICAL order of the depends_on edges (Kahn): a node comes after every node it depends on;
          among nodes ready at the same time, lower generationReadiness first, then fewer deps, then id. A cycle's members follow
          the acyclic part in the same tiebreak order (the invariants engine reports the cycle). Before 2026-10-20 it sorted by
          readiness then dep count only, which put a dependent before its foundation whenever the foundation was more ready
          (a chain longer than two, or an interface with full depth) — INV-007 then reported false build-order violations."
      error_paths:
        - "a module with no id or name → skipped, counted in the log"
        - "a dep naming nothing declared → BLACK node (specDepth 0), never a throw"
        - "cyclic depends_on → build order still total; cycle reported by the invariants engine"

  events:
    compiler:
      - "compiler.t0.emitted { outputDir, emittedCount, skippedCount, moduleCount }"
      - "compiler.t1.emitted { outputDir, emittedCount, skippedCount, moduleCount }"
      - "compiler.cortex.queried { moduleName, reachable, skipGeneration, openGapCount }"
      - "compiler.cortex.skipped { moduleName, reason }"
      - "compiler.chunk.built { chunkId, nodeId, tier, estimatedTokens }"
      - "compiler.chunk.over_budget { chunkId, nodeId, estimatedTokens, budget }"
      - "compiler.file.emitted { filePath, tier }"
      - "compiler.file.skipped { filePath, reason }"
      - "compiler.failure { step, error, moduleName }"

  enforcement:
    gates:
      - id: GATE-COMPILER-001
        name: cortex-first
        description: Compiler always calls cortex-query.preflight() before emitting. No exceptions.
        severity: fatal
        check: preflight() called and result checked before any fs.writeFileSync()
        on_failure: build failure

      - id: GATE-COMPILER-002
        name: t0-t1-zero-llm
        description: T0 and T1 emit functions never call any LLM API.
        severity: fatal
        check: no fetch or http.request to anthropic or ollama in emitT0() or emitT1()
        on_failure: build failure

      - id: GATE-COMPILER-003
        name: chunk-budget
        description: emitToPrompt() warns when token estimate exceeds tier budget.
        severity: warning
        check: estimateTokens(chunk) < chunk.budget (advisory)
        on_failure: log warning, continue

      - id: GATE-COMPILER-004
        name: chunk-depth-1
        description: Chunk.minimalContext contains only depth-1 deps. No transitive flood.
        severity: fatal
        check: minimalContext every node is in node.dependsOn
        on_failure: build failure

      - id: GATE-COMPILER-005
        name: versionium-register
        description: Every emitted file is registered to Cortex versionium after write.
        severity: warning
        check: POST /api/versionium/commit called after successful T0/T1 run
        on_failure: log warning — file exists on disk but Cortex does not know
