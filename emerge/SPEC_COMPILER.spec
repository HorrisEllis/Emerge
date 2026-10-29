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
      The build host is queried before any emission — nothing is re-built if it already exists.
      §2026-10-28 — James: "don't couple to nexus … everything from the ground up." The host was Cortex; it is now an
      interface (compiler/host.js) with a local default. Cortex is one host, in Nexus's own repo, passed in.
    tagline: "Compress intent. Decompress deterministically. Pay tokens once."
    target_runtime: [node]
    language_stack: [javascript]
    paradigm: [SISO, functional, deterministic, host-first]
    deps:
      - name: js-yaml
        version: ">=4.1.0"
        required: true
        purpose: .spec file parse
      # cortex is no longer a dependency of emerge (2026-10-28); a project may pass it in as a host from its own repo

    constraints:
      - id: CC-001
        description: Query the build host before emitting anything. If the host has it, skip. (Was Cortex; amended 2026-10-28.)
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
        description: Every emitted file is recorded by the build host after write (local host - a build record with each file's SHA-256; was Cortex versionium; amended 2026-10-28).
        type: hard
        enforced_by: [GATE-COMPILER-005]

  modules:

    - id:    MOD-CORTEX-QUERY
      name:  cortex-query
      uuid:  spec-compiler-cortex-query-v1-0000-0001
      moved: "out of Emerge (2026-10-28) into Nexus's adapter, in Nexus's repo — the Nexus host's preflight; Emerge no longer contains or requires it"
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
        - Existing files (from the host's preflight) are never overwritten. Skip and log.
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
        Injects open gaps from the host's preflight as TODO comments in stubs.
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
        - Open host gaps for this module are injected as GAP comments at top of impl file.
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

    # §2026-10-28 — building cie-eg.spec (and any project) from Emerge alone. Specced here before shipping, per James 2026-10-20: "everything needs
    # to be speccced before built, so it can be rebuilt if lost." Also amends MOD-KG-BUILDER: schemas are scored before the
    # nodes that reference them (a module with schema_refs read depth 0.0 and was reported BLOCKED as a false cycle), and a
    # schema with complete: true whose fields all have a type scores FULL (the gap-field engine's "confirm schema is
    # intentionally small").
    - id:    MOD-TARGET
      name:  target
      uuid:  spec-compiler-target-v1-0000-2026-1028-jamesbrooks-001
      description: >
        compiler/target.js. Reads two things from a spec: its target language (meta.language_stack or meta.target_runtime
        naming emerge, eg or emerge.exe → Emerge; otherwise TypeScript, as before) and each module's build plan
        (build: {state: built | partial | not_built, blocked_by, file, test, existing, next}).
      exports:
        - "isEmergeTarget(meta) → bool"
        - "buildDecision(mod) → null | { tier: DONE | DEFERRED, reason, blocked_by }"
        - "modulePaths(mod, meta) → { lang, impl, test }   (relative to outputDir)"
        - "EMERGE_CARD → string   (the Emerge syntax a T2 prompt carries)"
      gate_pipeline:
        - "GATE-TGT-001: meta → language (emerge | typescript)"
        - "GATE-TGT-002: module.build → DONE when built, DEFERRED when blocked_by is not empty, else null (readiness decides)"
      behavioral_contracts:
        - "A spec with neither field compiles exactly as before."
        - "tier-contract.decideTier checks buildDecision after BLACK and before readiness; DONE goes to the skip bucket, DEFERRED to the defer bucket, both with a reason."
      error_paths:
        - "unknown build.state → treated as not_built"

    - id:    MOD-EMIT-EMERGE
      name:  emit-emerge
      uuid:  spec-compiler-emit-emerge-v1-0000-2026-1028-jamesbrooks-001
      description: >
        compiler/emit-emerge.js. T0 and T1 for Emerge targets: one .eg and one .test.eg per module at the build plan's paths.
        T1 stubs raise "not implemented"; gates, contracts and error paths are comments; the test file holds one commented
        test per contract and error path. No package.json, tsconfig.json or .ts.
      deps:
        - { name: target }
      exports:
        - "emitT0Emerge(parsedSpec, outputDir) → T0Result"
        - "emitT1Emerge(parsedSpec, outputDir, { readinessOf, minReadiness }) → T1Result"
      gate_pipeline:
        - "GATE-EE-001: module → buildDecision → DONE or DEFERRED → skip with reason"
        - "GATE-EE-002: export → a plain fn signature? else kept as a comment"
        - "GATE-EE-003: name already a builtin (probe: let x = name compiles) → comment, not redefined"
        - "GATE-EE-004: stub → Emerge checker → error → comment with the checker's message"
        - "GATE-EE-005: write only if the file is absent or starts with GENERATED_MARK"
      behavioral_contracts:
        - "Same spec → same bytes."
        - "Every emitted file passes the Emerge checker."
        - "A file without GENERATED_MARK (written by a person or by T2) is never overwritten."
      error_paths:
        - "Emerge checker unavailable → stubs emitted unchecked, and the file header says so"
        - "fs failure → failures[], never thrown"

    - id:    MOD-T2-GATE
      name:  t2-gate
      uuid:  nexus-emerge-t2-gate-v1-0000-2026-0625-jamesbrooks-001
      description: >
        compiler/t2-gate.js (amended 2026-10-28, 2.0.0). T2 calls a model through compiler/model.js (was Guardian at :7820,
        which is now a model backend in Nexus's repo). Reads parsedSpec from the compile result (compile() returns it),
        takes spec entries given as strings, and for Emerge targets asks for Emerge, uses the build plan's paths, checks
        every answer with the Emerge checker before writing, and never overwrites a file without GENERATED_MARK.
      deps:
        - { name: target }
        - { name: emit-emerge }
        - { name: model }
      exports:
        - "buildNodePrompt(node, parsedSpec, stubSrc, outputDir) → string"
        - "dispatch(compileResult, opts) → { ok, completed, failed, results }"
      gate_pipeline:
        - "GATE-T2-001: run bucket T2 nodes → prompt (language from the spec, EMERGE_CARD for Emerge)"
        - "GATE-T2-002: prompt → model.generate (local Ollama by default; any backend passed in)"
        - "GATE-T2-003: Emerge answer → Emerge checker → fails → <file>.t2-rejected.eg, counted failed"
        - "GATE-T2-004: target file without GENERATED_MARK (Emerge) → <file>.t2-proposal.eg beside it"
      behavioral_contracts:
        - "TypeScript specs: prompt language, paths and overwrite behaviour unchanged."
        - "A rejected or proposed answer never replaces the file it was meant for."
      error_paths:
        - "model call fails → result failed with the error, next node continues"

    - id:    MOD-HOST
      name:  host
      uuid:  spec-compiler-host-v1-0000-2026-1028-jamesbrooks-001
      description: >
        compiler/host.js. Where a build reports to. The pipeline, the legacy compiler and verify.js call host.preflight,
        host.writeback and host.sync instead of Cortex and Idearium. Emerge ships the local host: no network, a build record
        at <outputDir>/.emerge/build/<spec name>.json with the spec hash, every emitted file and its SHA-256, the plan, the
        gaps and what T2 did. Any other host is a module a project passes in from its own repo.
      exports:
        - "local → host"
        - "loadHost(h) → host   (h: object, module path, 'local', or EMERGE_HOST)"
      gate_pipeline:
        - "GATE-HOST-001: options.host → loadHost → missing methods fall back to the local host's"
        - "GATE-HOST-002: writeback → record with no wall-clock field (CIE-EG 4.9) → same inputs, same bytes"
      behavioral_contracts:
        - "Nothing in emerge/ requires a host module from outside it; a host is always passed in."
        - "The local host never touches the network."
      error_paths:
        - "host without a name → refused with a message"
        - "record cannot be written → report ok false with the error, never thrown"

    - id:    MOD-MODEL
      name:  model
      uuid:  spec-compiler-model-v1-0000-2026-1028-jamesbrooks-001
      description: >
        compiler/model.js. The model T2 asks: generate(prompt, meta) → { ok, text, error }. Emerge ships two backends that talk
        straight to a local server: ollama (/api/chat) and openai-compatible (/v1/chat/completions: llama.cpp, LM Studio,
        vLLM). Any other backend is a module a project passes in from its own repo.
      exports:
        - "createModel({ api, url, model, temperature, ctx }) → model"
        - "loadModel(m) → model   (m: object with generate, module path, or settings)"
      gate_pipeline:
        - "GATE-MDL-001: settings or env (EMERGE_MODEL_API, EMERGE_MODEL_URL, EMERGE_MODEL) → backend"
        - "GATE-MDL-002: prompt → one user message → text, or ok false with the server's error"
      behavioral_contracts:
        - "A failed call is a result with its error, never a throw."
      error_paths:
        - "server unreachable or timed out → { ok: false, error }"
        - "unknown api → refused with a message"

    - id:    MOD-BUILD-SPEC
      name:  build-spec
      uuid:  emerge-build-spec-v1-0000-2026-1028-jamesbrooks-001
      description: >
        emerge/build-spec.js. Builds any project from its .spec with nothing but Emerge: plan (--dry-run), scaffolds and a
        build record, or --build with T2 through a model. The build root is --out, else the spec's meta.build_root, else the
        current folder. Lists open decisions with the modules waiting on them. buildSpec() is exported so a project can pass
        its own host and model from its own repo.
      deps:
        - { name: host }
        - { name: model }
        - { name: t2-gate }
      exports:
        - "node build-spec.js <file.spec> [--dry-run] [--build] [--out dir] [--host module] [--model name] [--api ollama|openai] [--url server] [--model-module module]"
        - "buildSpec({ spec, out, dryRun, build, host, model, log }) → { ok, compileResult, decisions, t2, root }"
        - "openDecisions(spec) → [{ id, question, waiting }]"
      gate_pipeline:
        - "GATE-BS-001: spec → meta.build_root → build root (a temp folder in a dry run)"
        - "GATE-BS-002: compile(spec, root, { host, tier 1 }) → plan, scaffolds, host record"
        - "GATE-BS-003: decisions from spec.decisions or any section's decisions, plus every build.blocked_by id"
        - "GATE-BS-004: --build → t2-gate.dispatch with the model → host.writeback again with the T2 results"
      behavioral_contracts:
        - "A dry run writes nothing outside its temp folder."
        - "Without --build no model is called; with it, only the model server is contacted."
      error_paths:
        - "spec not found or compile fails → exit 1 with the error"


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
        name: host-first
        description: Compiler always calls host.preflight() before emitting. No exceptions. (Was cortex-query.preflight(); amended 2026-10-28.)
        severity: fatal
        check: host.preflight() called and result checked before any fs.writeFileSync()
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
        name: host-record
        description: Every emitted file is recorded by the build host after write. (Was Cortex versionium; amended 2026-10-28.)
        severity: warning
        check: host.writeback() called after a successful T0/T1 run (local host - <outputDir>/.emerge/build/<spec>.json)
        on_failure: log warning — file exists on disk but the host has no record of it
