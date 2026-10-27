spec:
  meta:
    name:        emerge
    version:     1.1.0
    foundation:  nexus-system-foundation@1.0.0
    port:        :4242
    uuid:        nexus-emerge-v1-0000-2026-0615-jamesbrooks-001
    purpose: >
      DSL runtime. Reads .eg / .emerge files — a purpose-built declarative
      language. Tokenizer, parser, SNR gate, emitter. 569 keywords, 7
      axioms. Ollama for codegen. IDE serves at :4242.

  core:
    schemas: {}
    axioms: [AX-001, AX-002, AX-003]
    constants:
      KEYWORD_COUNT: 569

  events:
    emits:
      - "emerge.compiler.complete"
      - "emerge.hot-load.receive"
    handles:
      - "emerge.compiler.receive"

  modules:
    - id: tokenizer
      description: "Lexer for .eg files. 569 keyword vocabulary."
    - id: parser
      description: "AST builder. SNR-gated — rejects low-fidelity input."
    - id: kernel
      description: "Validates compartment definitions against schema."
    - id: emitter
      description: "Generates JavaScript from validated AST."
    - id: codegen
      description: "Ollama-backed code generation for T2 gaps in .eg files."
    - id: ide-server
      description: "HTTP server for Emerge IDE. Proxied through orchestrator."
    - id: lang
      description: "The Emerge language (1.5.0 — components, kinds, templates; buildable from lang/core via eg bootstrap): grammar, checker, runtime, interpreter, CommonJS emitter, eg CLI. Contract: emerge/lang/emerge-lang.spec. Proof: npm run test:lang."

  # 🔴 Previous version listed emerge.run / emerge.validate at
  # /api/emerge/run and /api/emerge/validate — neither exists in
  # emerge/registry-components.js. Replaced with the real 9 components.
  handshake:
    components:
      - { id: "emerge.health",   route: { method: GET,  path: "/status" } }
      - { id: "emerge.compile",  route: { method: POST, path: "/compile" },
          hooks: { out: ["cortex.raid.feedback", "guardian.job.dispatch.receive"] } }
      - { id: "emerge.codegen",  route: { method: POST, path: "/api/codegen" } }
      - { id: "emerge.hot.load", route: { method: POST, path: "/api/hot-load" },
          description: "QUARANTINE→PROVE→INTEGRATE→MONITOR — same lib/hot-loader.js as Phase 14" }
      - { id: "emerge.snapshot", route: { method: POST, path: "/api/snapshot" } }
      - { id: "emerge.check",    route: { method: POST, path: "/api/check" } }
      - { id: "emerge.models",   route: { method: GET,  path: "/api/models" } }
      - { id: "emerge.files",    route: { method: GET,  path: "/api/files" } }
      - { id: "emerge.seams",    route: { method: GET,  path: "/api/seams" } }

  # ── AX-008 (foundation addendum v1.1.0) ────────────────────────────────────
  # 🔴 NEEDS VERIFICATION — emerge.compile wires to cortex.raid.feedback,
  # which (per cortex/registry-components.js) does itself wire onward to
  # copilot.prompt.receive_result. If that chain holds at runtime, emerge
  # satisfies AX-008 transitively. Flagging as needing a live check rather
  # than asserting it — transitive reachability through someone else's wire
  # is exactly the kind of thing that looks fine on paper and breaks quietly.

  ui:
    type: panel in nexus-shell
    hotswap: true

  tests:
    - "compile() on a known-good .eg file produces deterministic output (§CC-002)"
    - "hot.load follows QUARANTINE→PROVE→INTEGRATE→MONITOR, rolls back on sigma > 0.70"
    - "SNR gate rejects a low-fidelity .eg file before parser runs"
