spec:

  # ════════════════════════════════════════════════════════════════════════════
  # cie-eg.spec
  # CIE-EG Specification v0.3.1 as machine-readable YAML, read by the spec compiler (emerge/compiler).
  # Source of truth for the text: CIE-EG_Specification_v0_3_1.md (repo root). This file carries the same content:
  #   sections:        one block per section of the .md, in its order (0–13, then 12 open decisions)
  #   modules / events / schemas / enforcement:  the compiler-facing view, derived from those sections
  # Every rule has a status from meta.status_tags and, where the .md says so, a built note.
  # Section 14 (data types and stores) is NEW in this file and is PROPOSED only; it is not in the .md.
  # ════════════════════════════════════════════════════════════════════════════

  meta:
    name:        cie-eg
    version:     0.3.1
    date:        2026-10-28
    author:      james-brooks
    uuid:        nexus-cie-eg-v0-3-1-2026-1028-jamesbrooks-001
    source_document: CIE-EG_Specification_v0_3_1.md
    title: "CIE-EG Specification v0.3.1"
    purpose: >
      Emerge's core architecture: a Component registry, an Interaction contract, and an Event gate with an event ledger
      that records gaps. Written for a from-scratch, self-hosted emerge.exe.
    revision: >
      v0.3.1 added section 0 (Purpose). The self-hosted executable is now named emerge.exe (it was eg.exe);
      the command-line tool is still called eg.
    executable: emerge.exe
    cli: eg
    target_runtime: [emerge.exe]
    build_root: ../..                 # build plan paths are relative to the repo root (this file is emerge/spec/)
    language_stack: [emerge]          # the spec compiler emits .eg and asks T2 for Emerge (compiler/target.js)
    build_plan: >
      Each module carries build: {state, file, blocked_by, existing, next}. The spec compiler reads it: built → DONE (never
      re-emitted), blocked_by an open decision (section 12) → DEFERRED, otherwise decided by readiness. Remove a decision id
      from blocked_by once it is decided. PROPOSED items not tied to an open decision are buildable.
    scaffold_runtime: [node]          # stage 0 only (10.1), then retired (0.4)
    built_tag:
      BUILT: "implemented in emerge/lang/ledger.js and the runtime, with tests. A note after a heading records what was done and where it departs from the text."
    status_tags:
      DECIDED:  "James said so."
      ADOPTED:  "proposed in discussion, accepted by moving on."
      PROPOSED: "a recommendation, needs James's yes."
      OPEN:     "a question only James can answer."
    constraints:
      - id: CIE-001
        description: "Components never reference each other; reached only through the registry and the gate."
        type: hard
        status: DECIDED
        spec_ref: s01_principles.P1
      - id: CIE-002
        description: "Nothing fails silently; every refusal, mismatch or failure is a typed gap entry."
        type: hard
        status: DECIDED
        spec_ref: s01_principles.P2
      - id: CIE-003
        description: "The finished system has no Node, no npm and no JavaScript in it."
        type: hard
        status: DECIDED
        spec_ref: s00_purpose.end_state
      - id: CIE-004
        description: "No invented cryptography: SHA-256 and AES-256-GCM from the OS or CPU."
        type: hard
        status: DECIDED
        spec_ref: s01_principles.P5
      - id: CIE-005
        description: "Emerge depends on nothing above it; no project (Nexus included) is required by emerge/. Integrations are adapters outside it."
        type: hard
        status: DECIDED
        spec_ref: s00_purpose.foundation

  # ══════════════════════════════════════════════════════════════════════════
  # SECTIONS — one block per section of the .md
  # ══════════════════════════════════════════════════════════════════════════
  sections:

    s00_purpose:
      number: "0"
      title: Purpose
      status: DECIDED
      summary: >
        Emerge is the author's own: the language, the compiler, the runtime and the toolchain, owned end to end.
        CIE-EG exists to make emerge.exe replace node.exe. The component registry, the interaction contract and the
        event gate become the runtime that hosts every system, in place of Node.
      goal: { replace: node.exe, with: emerge.exe }
      rules:
        - id: end_state
          text: "emerge.exe is one self-hosted executable. It compiles itself (section 10). The finished system has no Node, no npm and no JavaScript in it."
          refs: [s10_build_and_bootstrap]
        - id: outside_dependencies
          text: "The operating system only: file I/O, memory and exit from kernel32, and the OS crypto library (10.2). Nothing else is borrowed."
          allowed: [kernel32.file_io, kernel32.memory, kernel32.exit, os.crypto]
          refs: [s10_build_and_bootstrap.backend]
        - id: systems_built_from_emerge
          text: "A system is written as components, registered in the component registry, connected by roads in the contract, run by the gate, and recorded on the ledger. Systems never reach each other by importing code or by calling over a network. They are reached only through the registry and the gate (principle 1)."
          forbidden: [import_across_systems, network_call_between_systems]
          refs: [s01_principles.P1]
        - id: node_is_scaffolding
          text: "The existing Node interpreter may run once to produce the first emerge.exe (10.1, stage 0) and is then retired. It is not part of the finished system."
          refs: [s10_build_and_bootstrap.stages]
        # ADDENDUM 2026-10-31 — who Emerge is for, and the place of AI. DECIDED: James, 2026-10-31, after "What can energe do?" was
        # answered: "Also it's meant for me. To make coding easy for me using my own language. Ai is additive. Also it's working
        # towards removing the dependency of ai."
        - id: for_its_author
          status: DECIDED
          text: "Emerge is meant for its author: to make coding easy for him, in his own language. A feature earns its place by making his own coding easier."
        - id: ai_is_additive
          status: DECIDED
          text: "AI is additive. Emerge works without a model; a model may add to what he writes, never stand in for it."
          refs: [s10_build_and_bootstrap]
        - id: toward_no_ai_dependency
          status: DECIDED
          text: "Emerge is working towards removing the dependency on AI."
        - id: how_dependency_falls
          status: PROPOSED
          text: "The coder's reading, to confirm. What a model does once becomes Emerge's own: a template, a generator, a checker rule or a prelude function, so the same thing never needs a model again. Every path a model can take has a deterministic path beside it (eg gen, the spec compiler's scaffold, the checker), and a model's answer is accepted only through the checker (already so: build-spec's T2 gate)."
        - id: foundation
          status: DECIDED
          decided: 2026-10-28
          james: '"don''t couple to nexus. like its what i want all my projects to be built from. everything from the ground up"'
          text: "Emerge is the foundation every project is built from, from the ground up. It depends on nothing above it: no project, Nexus included, is imported, called or required by anything in emerge/. Projects depend on Emerge. A project's own integration (where a build reports, which model writes code) lives outside emerge/, as an adapter that uses Emerge's public interfaces: the build host (emerge/compiler/host.js) and the model (emerge/compiler/model.js)."
          checks:
            - "No require, import or file path in emerge/ reaches above emerge/."
            - "emerge/ copied alone into an empty folder: every module loads and every self-contained test passes."
            - "Emerge ships a local host (a build record in the output folder) and local model backends (Ollama, OpenAI-compatible), so a build needs nothing else."
          refs: [s01_principles.P7]
      consequences:
        status: PROPOSED
        items:
          - "A feature that only makes sense inside Node is out of scope."
          - "Anything added to the Node runtime in the meantime is temporary. It is worth adding only if it can be written again in .eg and run by emerge.exe unchanged."
          - "The ledger format is fixed before the native runtime is written, so it is ported once, not twice. This covers the causal-parent field (13.8)."

    s01_principles:
      number: "1"
      title: Principles
      principles:
        - { id: P1, name: components_isolated,      status: DECIDED, text: "Components are isolated. They never reference each other. They are known by id in the registry and reached only through the gate." }
        - { id: P2, name: nothing_fails_silently,   status: DECIDED, text: "Every refusal, mismatch, or failure becomes a typed gap entry in the ledger." }
        - { id: P3, name: interpretation_by_context, status: DECIDED, text: "A symbol keeps its identity, code point, and numeric value as properties. Which one applies is declared by the contract at each hook, never guessed." }
        - { id: P4, name: own_the_model,            status: ADOPTED, text: "Own the model, not the byte encoding. UTF-8 at every boundary. Emerge defines the symbol model, normalization, and error rules on top." }
        - { id: P5, name: no_invented_crypto,       status: DECIDED, text: "SHA-256 for chaining, AES-256-GCM for sealing, both from the OS or CPU. Emerge designs the structure around them, not the primitives." }
        - { id: P6, name: uuids_name_hashes_prove,  status: ADOPTED, text: "Identity is a derived name. Integrity is the full 256-bit hash." }
        - { id: P7, name: foundation,               status: DECIDED, text: "Emerge depends on nothing above it. Projects depend on Emerge, never the reverse; their integrations are adapters outside emerge/ (0, foundation)." }

    s02_text_model:
      number: "2"
      title: Text model
      subsections:
        encoding:
          number: "2.1"
          status: ADOPTED
          rules:
            - "Source files, ledger bytes, hashes, keys, and external exports are UTF-8. No byte-order mark."
            - "Strings are sequences of Unicode code points. len(s) counts code points. byte_len(s) is a separate function."
            - "UTF-16 appears nowhere. Lone surrogates are not valid text."
          encoding: utf-8
          bom: false
          string_unit: code_point
          builtins: ["len(s) → code points", "byte_len(s) → bytes"]
        strict_decoding:
          number: "2.2"
          status: ADOPTED
          text: "Invalid UTF-8 never becomes a replacement character. The text component refuses it and the gate records a gap."
          on_invalid: { gap_type: structural, pressure: 0.95, carries: byte_offset_of_first_bad_byte }
          replacement_character: forbidden
        normalization:
          number: "2.3"
          status: PROPOSED
          rules:
            - "Any text that is hashed, used as an id, or placed in a ledger body must be NFC."
            - "The gate does not normalize silently, since that would be a hidden change. Non-NFC input is refused with a gap. The text component offers an explicit normalize hook for callers who want it."
          form: NFC
          applies_to: [hashed_text, ids, ledger_bodies]
          on_non_nfc: { gap_type: structural, pressure: 0.5 }
          explicit_hook: text.normalize
          open:
            status: OPEN
            question: "Build the Unicode composition tables in .eg, or limit hashed text to a stated subset at first (ASCII identifiers are trivially NFC)?"
            decision_ref: D5
        identifiers:
          number: "2.4"
          status: PROPOSED
          text: "Component ids, hook names, namespaces, and contract ids use only [A-Za-z0-9_] segments joined by '.', each segment starting with a letter or '_'. This blocks lookalike and zero-width characters from ever entering the registry. Ordinary string values remain full Unicode."
          applies_to: [component_id, hook_name, namespace, contract_id]
          segment_regex: "^[A-Za-z_][A-Za-z0-9_]*$"
          separator: "."
          full_regex: "^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$"
        symbol_properties:
          number: "2.5"
          status: DECIDED
          text: "Every character exposes properties through builtins, taken from Unicode data."
          builtins: ["code(ch)", "category(ch)", "digit_value(ch)"]
          example: { char: "1", code: 49, category: decimal-digit, digit_value: 1 }
          interpretation_rules:
            - "The type declared at a hook decides interpretation: string is text, num or int is a number."
            - "Conversion is always explicit: num(\"1\"), str(1). The gate never converts."
            - "A value of the wrong interpretation at a hook is refused with a gap."
            - "+ never turns text into a number. \"1\" + 1 is a runtime error, as it is today."
          on_wrong_interpretation: { gap_type: contextual, pressure: 0.7 }

    s03_numbers_and_bytes:
      number: "3"
      title: Numbers and bytes
      status: DECIDED
      motivation: "Emerge had one numeric type, a 64-bit float. SHA-256, AES-GCM framing, and the PE writer need exact integers and bit operations."
      types:
        int:
          built: "v0.2"
          width: 64
          signed: true
          literal: "42i"
          overflow: error
          wrapping_functions: [wrap_add, wrap_sub, wrap_mul]
          division: "int / int is refused; use idiv"
        bytes:
          built: true
          immutable: true
          operations: [len, slice, concat, "index → int"]
        num:
          representation: ieee754_double
          purpose: fractions
          alias: float
          note: "The spec says float; the language keeps its existing name num, and float is an alias in annotations."
      bitwise:
        built: true
        operators: ["&", "|", "^", "~", "<<", ">>"]
        functions: [shr_u, rotl, rotr]
        on_int: 64-bit
        on_num: 32-bit words
      mixing: "No implicit int/num mixing: int(x) and num(x) are explicit, and a mix is a runtime error."
      canonical_form: "Canonical form (4.3) rejects NaN and infinity, and writes -0 as 0."
      sha256: "Stays a runtime builtin for now (principle 5); a pure-.eg SHA-256 is now possible but not required."
      decision_ref: D2

    s04_ledger:
      number: "4"
      title: Ledger
      subsections:
        entry:
          number: "4.1"
          status: [BUILT, DECIDED]
          fields: [seq, kind, body, prev, hash]
          seq_starts_at: 1
          append_only: true
          schema_ref: LedgerEntry
        hash_input:
          number: "4.2"
          status: BUILT
          text: "SHA-256 over length-prefixed fields, so no two different entries can produce the same input bytes by shifting a boundary."
          layout:
            - { field: tag,  encoding: "\"eg.ledger.entry.v1\" 0x00", note: domain separation }
            - { field: prev, encoding: "32 bytes" }
            - { field: seq,  encoding: "u64 big-endian" }
            - { field: kind, encoding: "u32 length || kind" }
            - { field: body, encoding: "u32 length || canonical(body)" }
          hash: "SHA-256(input)"
          genesis_prev: "32 zero bytes"
          display: "64 lowercase hex digits in the file and in ledger(); the bytes are what is hashed"
          built: "Verified against a separate Python implementation (known-answer vectors in lang/test/ledger.test.js). Different record families (entry, checkpoint, registry, contract) use different tags."
        canonical_form:
          number: "4.3"
          name: ECF
          status: BUILT
          rules:
            - "One byte sequence per value."
            - "UTF-8, strings NFC, no whitespace."
            - "Map keys sorted by raw byte order."
            - "Integers in plain decimal; non-integers as the shortest decimal that round-trips."
            - "null/true/false lowercase."
            - "NaN, infinity, and non-data values (fns, compartments) are rejected and recorded as a gap."
          built: >
            Rejection is a runtime error today; recording it as a structural gap comes with the gate. Strings use minimal
            JSON escapes (\" \\ \b \f \n \r \t, other C0 controls as \u00xx). A number that is not an integer below 2^53 is
            written in ECMAScript's shortest round-trip form; a self-hosted emerge.exe must reproduce that form (Ryu or
            Grisu). An int and a num of the same value write the same bytes, so the ledger does not record which type a value had.
          string_escapes: ["\\\"", "\\\\", "\\b", "\\f", "\\n", "\\r", "\\t", "\\u00xx for other C0"]
          native_requirement: "shortest round-trip float formatting (Ryu or Grisu)"
        verify:
          number: "4.4"
          status: BUILT
          text: "Verify() recomputes every hash and checks every prev link and seq. Any edit, deletion, or reordering fails it."
          built: >
            Also checks each checkpoint against the chain it sits in (head, entry count, gap count, Merkle root).
            ledger_verify(seq) verifies from a checkpoint. A truncated tail still verifies, since a chain cannot prove that
            nothing follows; the latest checkpoint's head and count notice a truncation once the ledger is on disk.
            Gaps() lists every entry of kind gap.
          functions: ["Verify()", "ledger_verify(seq)", "Gaps()"]
        entry_kinds:
          number: "4.5"
          kinds:
            - { kind: genesis,    written_when: "A chain begins. Commits to the boot record (section 7).", built: "with seed, version, chain id and text settings; manifest root, builder, contract hash and registry hash wait for the boot chain (7)" }
            - { kind: boot,       written_when: "Every later start. Links to the previous run's head." }
            - { kind: register,   written_when: "A component registers.", built: "the runtime's former component entry" }
            - { kind: deliver,    written_when: "The gate delivers an event along a road." }
            - { kind: gap,        written_when: "Any check fails (section 6.3)." }
            - { kind: gap.ack,    written_when: "A gap is acknowledged (section 6.4)." }
            - { kind: gap.close,  written_when: "A gap is closed (section 6.4)." }
            - { kind: transition, written_when: "A compartment commits a state change." }
            - { kind: rejected,   written_when: "A transition is refused by a hard constraint." }
            - { kind: checkpoint, written_when: "Micro-snapshot (4.6).", built: true }
            - { kind: rekey,      written_when: "A sealing key is rotated (section 8.5)." }
            - { kind: record,     written_when: "A program writes a record explicitly." }
        checkpoints:
          number: "4.6"
          status: BUILT
          built_extent: partly
          written: ["every N entries (default 256, set in core/primitives.eg)", at boot, at rekey, at clean shutdown]
          interval_default: 256
          interval_source: core/primitives.eg
          schema_ref: CheckpointBody
          merkle:
            leaf: "SHA-256(0x00 || entry hash)"
            node: "SHA-256(0x01 || left || right)"
            odd_node: "carried up unchanged, not duplicated"
            empty_range: "SHA-256(\"eg.merkle.empty.v1\")"
          built: >
            Checkpoints at the interval and at clean shutdown; registry_hash (5.3) is not in the body yet, and boot and
            rekey checkpoints wait for their entries. ledger_proof(seq) and ledger_check_proof prove an entry belongs under
            its checkpoint.
          functions: ["ledger_proof(seq)", "ledger_check_proof"]
          uses:
            - verify from the last checkpoint instead of from the start
            - prove one entry belongs to the ledger
            - show which component's state changed
            - anchor whatif and replay
          optional: "A checkpoint can carry the full sealed state, making it a restorable snapshot."
        dedup:
          number: "4.7"
          status: OPEN
          text: "Cobalt counts repeated events instead of storing copies. That conflicts with an exact, replayable history."
          proposal: "Chain every event; keep the repeat count as a separate index, or write periodic count entries."
          question: "Do you want dedup at all?"
          related: "13.6 proposes: exact history stays chained, the count is an index."
          decision_ref: D4
        persistence:
          number: "4.8"
          status: PROPOSED
          file_format: "a sequence of records, each u32 length || entry bytes"
          write_policy: "An entry is flushed to disk before the gate reports its event as delivered."
          torn_tail: { action: "truncate the incomplete last record and write a gap", gap_type: structural, pressure: 0.6, message: "torn tail recovered", silent: false }
          unwritable: "If the ledger cannot be written (disk full, key missing), the gate halts and says so. It never continues unrecorded."
        time:
          number: "4.9"
          status: PROPOSED
          text: "The ledger has no hidden clock. Time enters only as data from a registered clock component whose events pass the gate like any other. Hashes therefore never depend on an unrecorded outside value."
          clock_component: clock

    s05_component_registry:
      number: "5"
      title: Component registry (C)
      subsections:
        record:
          number: "5.1"
          status: ADOPTED
          schema_ref: ComponentRecord
          fields:
            - { field: id,         rule: "Unique, identifier charset (2.4)." }
            - { field: namespace,  rule: "Identifier charset." }
            - { field: name,       rule: "Display name." }
            - { field: version,    rule: "Semver major.minor.patch, optional pre-release and build." }
            - { field: uuid,       rule: "Derived (section 9)." }
            - { field: hooks,      rule: "Map of hook name to {dir: in or out, shape}." }
            - { field: shape_hash, rule: "SHA-256 of the canonical form of all hooks and shapes." }
          on_register: "writes a register entry"
          on_duplicate_id: gap
          on_malformed: gap
        isolation:
          number: "5.2"
          status: DECIDED
          text: "A component's state is private. Another component cannot read it, call it, or hold a reference to it. The only entry point is its in hook, invoked by the gate. The registry holds components; it does not give them to each other."
        registry_hash:
          number: "5.3"
          text: "SHA-256 over the sorted list of (id, version, uuid, shape_hash). Recorded in the genesis and in every checkpoint."
          input: "sorted list of (id, version, uuid, shape_hash)"
          recorded_in: [genesis, checkpoint]

    s06_contract_and_gate:
      number: "6"
      title: Interaction contract (I) and event gate (E)
      subsections:
        contract_format:
          number: "6.1"
          status: PROPOSED
          text: "A contract is declared in Emerge's own syntax, as data."
          example: |
            contract emerge_main {
              version = "1.0.0"
              text   { encoding = "utf-8"  normalization = "nfc" }
              gate   { block_at = 0.9  max_steps = 100000  checkpoint_every = 256 }
              road Counter.changed -> Display.show
            }
          defaults: { block_at: 0.9, max_steps: 100000, checkpoint_every: 256 }
          rules:
            - "A road is the only way an event can travel, from one out hook to one in hook. The existing wire statement is the same thing and compiles to a road."
            - "Hook shapes live on the components: out changed: { count: int, label: string }."
            - "The contract_hash is SHA-256 over the canonical contract. It goes into the genesis and every checkpoint."
            - "Changing a contract changes its version and hash. An old ledger stays verifiable against the contract it recorded."
          schema_ref: Contract
          decision_ref: D7
        gate_pipeline:
          number: "6.2"
          status: ADOPTED
          text: "Every event goes through the same steps, in order. The first failure stops the event and writes a gap."
          steps:
            - { step: 1, check: "The source is a registered out hook.",                                   on_fail: unregistered_source }
            - { step: 2, check: "The payload is valid text (2.2) and NFC where required (2.3).",          on_fail: [malformed_utf8, non_nfc] }
            - { step: 3, check: "The payload fits the source hook's shape, with the declared interpretation of each field.", on_fail: [shape_broken, wrong_interpretation] }
            - { step: 4, check: "The contract has at least one road from this hook.",                     on_fail: no_road }
            - { step: 5, check: "For each road: the destination is a registered in hook, and the payload fits its shape.", on_fail: [road_to_nothing, shape_broken] }
            - { step: 6, action: "Write a deliver entry, then call the destination." }
            - { step: 7, check: "If delivery fails, write a gap. Other roads still run.",                 on_fail: delivery_failed }
          queue: fifo
          queue_rule: "Events raised during delivery wait in a first-in-first-out queue."
          storm_rule: "Past max_steps deliveries in one drain, the gate stops and records a storm gap."
        gap_types:
          number: "6.3"
          status: PROPOSED
          types: [logical, evidential, temporal, assumption, contradiction, structural, contextual, causal]
          types_source: core/primitives.eg
          pressure_range: [0, 1]
          failures:
            - { id: unregistered_source,  failure: "Unregistered source hook",                        type: structural,    pressure: 0.9 }
            - { id: no_road,              failure: "No road leaves the hook",                         type: structural,    pressure: 0.6 }
            - { id: road_to_nothing,      failure: "Road ends at no registered in hook",              type: structural,    pressure: 0.9 }
            - { id: shape_broken,         failure: "Payload breaks a shape",                          type: contradiction, pressure: 0.8 }
            - { id: wrong_interpretation, failure: "Wrong interpretation (text where num is declared)", type: contextual,  pressure: 0.7 }
            - { id: delivery_failed,      failure: "Delivery failed",                                 type: causal,        pressure: 0.7 }
            - { id: malformed_utf8,       failure: "Malformed UTF-8",                                 type: structural,    pressure: 0.95 }
            - { id: non_nfc,              failure: "Non-NFC text",                                    type: structural,    pressure: 0.5 }
            - { id: signal_storm,         failure: "Signal storm",                                    type: structural,    pressure: 1.0 }
            - { id: key_missing,          failure: "Key missing or unreadable",                       type: evidential,    pressure: 0.9 }
            - { id: boot_verify_failed,   failure: "Boot verification failed",                        type: contradiction, pressure: 1.0 }
            - { id: torn_tail,            failure: "Torn tail recovered (4.8)",                       type: structural,    pressure: 0.6 }
          body_schema_ref: GapBody
          body_text: "A gap body holds type, message, pressure, the from and to endpoints, and the hash of the refused event, so the refusal itself is provable and cannot be swapped for another event later."
        gap_lifecycle:
          number: "6.4"
          status: PROPOSED
          states: [open, acknowledged, closed]
          entries: { open: gap, acknowledged: gap.ack, closed: gap.close }
          rules:
            - "Each step is a ledger entry referencing the gap's hash with a reason."
            - "Gaps are never deleted."
            - "A gap at or above block_at closes its road: the gate refuses further events on it until the gap is closed."

    s07_boot_hash_chain:
      number: "7"
      title: Boot hash chain
      status: ADOPTED
      genesis_commits_to:
        - { field: manifest_root, meaning: "Merkle root of the SHA-256 of every core file (Cobalt's sealed manifest, made into one hash)" }
        - { field: builder,       meaning: "hash of the compiler that produced this emerge.exe" }
        - { field: contract_hash, meaning: "6.1" }
        - { field: registry_hash, meaning: "5.3" }
        - { field: chain_id,      meaning: "the chain's UUID" }
        - { field: text,          meaning: "text settings: encoding and normalization" }
      schema_ref: GenesisBody
      rules:
        - "Each later start writes a boot entry with prev equal to the previous run's head. One ledger therefore spans runs, and 'this history came from exactly this code under exactly this contract' can be checked."
        - "At boot the system recomputes the manifest root. On mismatch it writes a gap (contradiction, 1.0) and refuses to continue. It never starts quietly."
      cobalt_gaps_fixed:
        - "its ledger hashes are not chained"
        - "the payload is cut at 200 characters"
        - "the digest is truncated to 64 bits"
        - "the manifest has no root"

    s08_sealing:
      number: "8"
      title: "Sealing: AES-256-GCM"
      status: DECIDED
      details_status: PROPOSED
      subsections:
        coverage:
          number: "8.1"
          text: "GCM protects each entry's contents and detects tampering with that entry. The hash chain protects order and completeness. Both are required, since GCM alone cannot see a deleted or swapped entry."
        layout:
          number: "8.2"
          aad: [seq, kind, prev, "gap.type", "gap.pressure", "gap.endpoints"]
          aad_note: "Authenticated and readable. Binds an entry to its position and lets anyone list and sort gaps without the key."
          ciphertext: canonical body
          chain_hash_over: ciphertext
          chain_hash_note: "so the chain verifies without any key"
        nonce:
          number: "8.3"
          bits: 96
          layout: ["4 bytes from the chain id hash", "seq as 64-bit big-endian"]
          rule: "Unique by construction. A nonce must never repeat under one key, since repetition breaks GCM."
        keys:
          number: "8.4"
          status: OPEN
          derivation: "A root key derives one key per component with HKDF-SHA-256, using the component uuid as context. A component can decrypt only its own entries."
          release: "The root key is released only if the genesis verifies, so altered code cannot open the ledger."
          question: "Where does the root key live, and what happens if it is lost? (OS credential store, a file, a passphrase, hardware token.)"
          options: [os_credential_store, file, passphrase, hardware_token]
          decision_ref: D3
        rotation:
          number: "8.5"
          text: "Rotating a key writes a rekey entry into the chain. Old entries stay readable under their old key id, and the change is on the record."
        implementation_rule:
          number: "8.6"
          text: "No hand-written AES. Use the CPU's AES-NI and carry-less multiply instructions, or the Windows crypto library. Software table AES leaks through timing."
          allowed: [aes_ni_with_clmul, windows_crypto_library]
          forbidden: [software_table_aes]

    s09_identity:
      number: "9"
      title: Identity
      component_uuid:
        rule: "first 128 bits of SHA-256(\"eg.component.v1\" 0x00 namespace \"/\" id \"@\" version)"
        stable: "The same component always gets the same uuid. Shape changes are caught by shape_hash, so the uuid stays stable."
      chain_id: "a UUID written in the genesis, used in nonces"
      entry_identity: "its hash; no separate entry id"
      layout:
        status: OPEN
        options: ["standard 8-4-4-4-12 with version and variant bits set", "emerge-component- prefix form"]
        built: "for the chain id only: the standard form, version 8 and variant 10, derived from SHA-256(\"eg.chain.v1\" 0x00 seed \" \" version) so two runs from one seed and build agree."
        decision_ref: D6

    s10_build_and_bootstrap:
      number: "10"
      title: Build and bootstrap
      subsections:
        stages:
          number: "10.1"
          status: OPEN
          stages:
            - { stage: 0, name: scaffold,  text: "The existing Node interpreter, used once and then retired. It runs the .eg compiler to emit the first emerge.exe." }
            - { stage: 1, name: compiler,  text: "The compiler, written in Emerge: lexer, parser, checker, code generator." }
            - { stage: 2, name: self_host, text: "emerge.exe compiles the compiler's own source. The stage-1 and stage-2 outputs must be byte-identical." }
          question: "Is Node acceptable as the throwaway stage 0?"
          decision_ref: D1
        backend:
          number: "10.2"
          text: "An x86-64 encoder and a Windows PE writer, both in .eg. The only outside dependencies are the OS: kernel32 (file I/O, memory, exit) and the OS crypto library."
          files: [emerge/lang/native/x64.eg, emerge/lang/native/pe.eg, emerge/lang/native/elf.eg, emerge/lang/native/codegen.eg]
        first_milestone:
          number: "10.3"
          text: "A tiny .eg program that emits a valid PE file which runs and prints a line. This proves the path before anything else rests on it."
          file: emerge/lang/native/milestone.eg
        self_host:
          built: "2026-10-28, Linux x86-64: stage 0 (Node, once) → stage 1 → stage 2, byte-identical (MOD-NATIVE)"
          node_after_stage_0: "not needed to build the compiler: native/bin/emerge rebuilds itself"

    s11_acceptance_tests:
      number: "11"
      title: Acceptance tests
      tests:
        - { id: AT-01, do: "Edit one ledger byte.",                                  expect: "Verify() fails." }
        - { id: AT-02, do: "Delete or reorder an entry.",                            expect: "Verify() fails." }
        - { id: AT-03, do: "Emit from an unregistered hook.",                        expect: "A gap appears. Nothing is delivered." }
        - { id: AT-04, do: "Emit with no road.",                                     expect: "A gap appears." }
        - { id: AT-05, do: "Send \"1\" where the contract says int.",                expect: "A contextual gap appears. Nothing converts." }
        - { id: AT-06, do: "Feed invalid UTF-8.",                                    expect: "A gap appears with the byte offset. No U+FFFD is produced." }
        - { id: AT-07, do: "Truncate the ledger mid-record.",                        expect: "Reopening writes a torn-tail gap and continues." }
        - { id: AT-08, do: "Alter a core file.",                                     expect: "Boot refuses and records a gap." }
        - { id: AT-09, do: "Move a sealed entry to another position.",               expect: "GCM authentication fails." }
        - { id: AT-10, do: "Register two components with the same id.",              expect: "The second is refused with a gap." }
        - { id: AT-11, do: "Rebuild the compiler with itself.",                      expect: "The output is byte-identical." }

    s13_observation:
      number: "13"
      title: Observation
      status: PROPOSED
      built: emerge/observe/
      summary: >
        The ledger read as a field. observe(entries) is a pure function of a verified chain and of primitives.observe;
        a report is a reading and is never written back. Time is the seq (4.9); no wall clock is read.
      parts:
        - id: entry_reading
          number: "13.1"
          text: "An entry is 'about' a key (kind|compartment-or-name|signal, constraint, message, path or wire ends). Entries the observer itself caused (a gap with source: observe, an unrouted for a runtime notification signal) are left out of every measurement and stay in the gap inventory, so no reading can feed on itself."
        - id: deltas
          number: "13.2"
          name: RFR2
          measures:
            S: "z-score of the tick gap since the previous entry of the same key (spread floored at one tick; signed z kept)"
            K: "change in the share of stress entries between two consecutive windows"
            C: "causal depth; null until entries carry a causal parent"
          rule: "Not measured is null / measured: false, never 0."
        - id: sigma_regime
          number: "13.3"
          precedence: [insufficient_data, collapsing, oscillatory, degraded, stable]
          drivers: { collapsing: K, oscillatory: O, degraded: S }
          rule: "Thresholds in primitives. A stable window has no dominant cause."
        - id: cfr_field
          number: "13.4"
          dimensions: [coherence, friction, resonance, entropy]
          range: [0, 1]
          rules:
            - "per-kind nudges, damping toward neutral"
            - "gap nudges scaled by pressure"
            - "deviation adds entropy and friction"
            - "resonance rises only when a stress entry repeats a recent key"
          regimes: [stable, resonant, turbulent, chaotic]
        - id: liminal
          number: "13.5"
          signals:
            constitutional_threshold: [bounced, absorbed, dissolved]
            velocity_field: "runaway is an early warning before the max_deliveries storm"
            coherence_surface: "one signal both accepted and refused"
            root_terminus: [aborted, unrouted]
          crystals: "need min_count and min_confidence; suggestions only"
        - id: gap_hunter
          number: "13.6"
          rules:
            - "A proposal needs an evidence object."
            - "Batch confidence is the minimum, not the mean."
            - "One condition has one dedup key; repeats raise occurrences (the answer proposed for 4.7: exact history stays chained, the count is an index)."
            - "A gap closes on a gap.close entry naming it, or when its predicate is false and an artifact entry proves it."
            - "Tension (pressure, age, repeats) only raises severity and is compared with block_at; closing a road is the gate's act (6.4)."
        - id: builtins
          number: "13.7a"
          functions:
            - { name: "observe()",      does: "reads; refuses an unverifiable ledger" }
            - { name: "observe_gaps()", does: "passes proposals through the gate as gap entries carrying source, dedup_key, evidence; refused in a lens; a second call opens none" }
      tunables_note: "All numbers are tunables carried over from the intelligence system's CFR, RFR2, liminal and gap work by analogy, not measurements."
      debugging:
        number: "13.7"
        status: PROPOSED
        built: [emerge/observe/debug.js, eg debug, ledger_why]
        summary: >
          Entries carry no causal parent, so every causal edge here is inferred from structure and labelled (via): state lineage,
          the previous entry with the same signal, the reading an observe gap was opened from, the gap a gap.close names.
          Nothing is written to the ledger.
        inferred_edges: [state_lineage, same_signal_previous, observe_gap_reading, gap_close_target]
        functions:
          - { name: "why(seq)",      does: "the chain back from an entry to what explains it" }
          - { name: "at(seq)",       does: "state of every compartment, open gaps, field and sigma after that entry (a verified prefix is itself a valid chain)" }
          - { name: "follow",        does: "entries about one compartment, signal or kind" }
          - { name: "diff(a, b)",    does: "the first entry whose hash differs (equal hashes prove an equal past) with state either side" }
          - { name: "blame",         does: "the first struggle and the first turbulent or chaotic field, each with its why" }
          - { name: "clip(from, to)", does: "a slice anchored by the hash before it and its own head, re-verifiable alone and against a whole ledger" }
        cli: "eg debug <ledger.json> blame | why N | at N | follow | diff F | clip A B | verify-clip | report"
        cli_rules:
          - "Ledger files are read so that integers beyond 2^53 stay exact."
          - "A ledger that does not verify is refused."
        program_builtin: "ledger_why(n) is the same why, from inside the program."
        future: "Once entries carry a real causal parent, edges() is replaced by it and structuralDeviation (13.2) can be measured; the commands do not change."
      causal_parent:
        number: "13.8"
        note: "Referenced by 0 (consequences): the causal-parent field is fixed in the ledger format before the native runtime is written."

    s14_data_types_and_stores:
      number: "14"
      title: Data types and stores
      status: PROPOSED
      new_in: cie-eg.spec (not in the .md yet)
      summary: >
        Named data types defined by schemas, grouped into stores, the way SQL has a database and table definitions.
        A schema is a reusable record type. A store is a component that holds tables of rows of those types. Every write
        goes through the gate and onto the ledger, so a table is a fold over the ledger: replayable, provable, never edited
        in place. Existing kind (a schema for components) and template (a parameterized component) are unchanged; schema is
        the missing schema for data.
      analogy:
        - { sql: database,      emerge: store,      note: "a registered component; isolated (5.2); reached only through the gate" }
        - { sql: "CREATE TABLE", emerge: schema,     note: "a named, versioned record type; reusable as a hook shape" }
        - { sql: table,         emerge: table,      note: "a named collection of rows of one schema inside a store" }
        - { sql: row,           emerge: row,        note: "an ECF value (4.3) that fits the schema" }
        - { sql: "PRIMARY KEY", emerge: key,        note: "one field, or a list of fields; unique within the table" }
        - { sql: "FOREIGN KEY", emerge: ref,        note: "a field naming a row in another table of the same store" }
        - { sql: "CHECK",       emerge: check,      note: "an Emerge boolean expression over the row; a hard constraint" }
        - { sql: SELECT,        emerge: query,      note: "filter, order, limit over one table; joins are an open question" }
        - { sql: "ALTER TABLE", emerge: migrate,    note: "an explicit fn from schema vN to vN+1, written to the ledger" }
      example: |
        schema Supplier v1 {
          key id: string
          name: string
        }

        schema Item v1 {
          key id: string
          name: string
          qty: int = 0i          check qty >= 0i
          price: num?
          supplier: ref Supplier
        }

        store inventory v1 {
          table suppliers: Supplier
          table items: Item
        }

        component Shop {
          out restock: Item            // a schema used as a hook shape
        }

        road Shop.restock -> inventory.insert
      rules:
        - id: DT-01
          text: "A schema is declared once, by name and version, and has a schema_hash = SHA-256(\"eg.schema.v1\" 0x00 || canonical(schema))."
        - id: DT-02
          text: "Field names follow the identifier charset (2.4). Field types are the language types (int, num, string, bool, bytes, list, map), another schema by name, or ref <Schema>. A trailing ? makes a field optional."
        - id: DT-03
          text: "A schema may be used anywhere a shape is used (hooks, 6.1). The hook's shape_hash then covers the schema_hash, so changing the schema changes the component's shape_hash."
        - id: DT-04
          text: "A store is a component. Declaring it registers it (register entry) with generated hooks: in insert, in update, in delete, in query, out changed, out result. No other code can read its tables (5.2)."
        - id: DT-05
          text: "Every accepted write is one ledger entry of kind row (new kind) with body {store, table, op, key, row}. The table's state is the fold of those entries; checkpoints carry the store's digest (4.6)."
        - id: DT-06
          text: "Defaults are applied by the store only when declared in the schema, and the stored row (with the default filled in) is what is written to the ledger. The gate itself still never converts (2.5)."
        - id: DT-07
          text: "Changing a schema means a new version. Rows move to it only through an explicit migrate fn; running it writes a migrate entry naming both schema hashes. Old ledgers stay verifiable against the schema they recorded."
        - id: DT-08
          text: "A query is a read: it returns rows on out result and writes a deliver entry like any event, but it never changes the table."
      gaps:
        - { failure: "Row misses a required field or has an unknown field", type: contradiction, pressure: 0.8 }
        - { failure: "Field has the wrong interpretation (\"1\" where int is declared)", type: contextual, pressure: 0.7 }
        - { failure: "Duplicate key on insert", type: contradiction, pressure: 0.7 }
        - { failure: "update or delete of a key that does not exist", type: evidential, pressure: 0.6 }
        - { failure: "ref names a row that does not exist", type: causal, pressure: 0.7 }
        - { failure: "check expression is false", type: contradiction, pressure: 0.8 }
        - { failure: "delete of a row another row refs", type: causal, pressure: 0.7 }
      schema_refs: [SchemaDecl, StoreDecl, RowEntryBody]
      open:
        - { id: DT-Q1, question: "Keyword: schema (as here), type, or record? record is already a statement and type is a contextual word in gap." }
        - { id: DT-Q2, question: "Is the ledger the only storage (tables rebuilt by replaying from the last checkpoint), or does a store keep a sealed snapshot file with the ledger as its log?" }
        - { id: DT-Q3, question: "Queries: one table only at first, or joins along ref fields from the start?" }
        - { id: DT-Q4, question: "Indexes beyond the key: declared in the schema, in the store, or not at all at first?" }
        - { id: DT-Q5, question: "Deleting a referenced row: refuse with a gap (as proposed), or allow a declared cascade?" }

    s15_chunks_as_layers:
      number: "15"
      title: Chunks as layers
      status: PROPOSED
      new_in: cie-eg.spec (not in the .md yet)
      principle: "Boundaries clearly defined at every edge; the chunk is the minimal reducible unit that still executes."
      summary: >
        A chunk is the smallest unit that still runs and can be tested alone. It is not a position in a file or a row in a
        table: it is one identity (its hash) with one record in each layer of CIE-EG. Each layer defines one thing about it
        and nothing else, so structure comes from declared meaning (edges), never from what sits on the next line.
      layers:
        - { layer: C,  part: registry, defines: "what the chunk is: identity, boundary (shape, 1 to 5 invariants), hash" }
        - { layer: I,  part: contract, defines: "how it connects: typed, declared edges (road, ref, depends_on, part_of)" }
        - { layer: E,  part: gate,     defines: "how it crosses: every crossing of a boundary or an edge is checked; failure is a gap" }
        - { layer: EG, part: ledger,   defines: "what happened: every crossing in linear, provable order, each naming its causal parent (13.8)" }
      rules:
        - id: CH-01
          text: "Every chunk declares its boundary in layer C: input shape, output shape, state shape if any, and its invariants. Nothing about a chunk is implied by where it is written."
        - id: CH-02
          text: "A chunk reaches another only along an edge declared in layer I. An edge has a type and a shape on each end."
        - id: CH-03
          text: "Minimal reducible: a chunk is cut until it does one thing that can be tested alone. A chunk that cannot be tested alone is not yet a chunk."
        - id: CH-04
          text: "Chunk code is stateless: (state rebuilt from the ledger, incoming event) → (state change, emitted events). State lives only in the ledger, so the same inputs always give the same output."
        - id: CH-05
          text: "A chunk's whole context is its own boundary plus the signatures of the chunks its edges reach. It never sees their code (principle 1)."
        - id: CH-06
          text: "The ledger's seq order stays linear. The meaning layer (edges, causal parents) sits on top of the chain and never replaces it, because the single order is what proves completeness."
        - id: CH-07
          text: "Components, schema rows (14) and code units are kinds of chunk: one base concept (boundary, hash, edges), not four."
      synthesis:
        text: >
          The spec is the compressed form. A chunk's prompt, its tests and its gate checks are decompressed from its boundary
          deterministically. Careful handwork is reduced by cutting a hard piece until every unit fits a small model's
          context; the hard part that remains is drawing the boundaries, which is spec work.
        context_budget: "a few hundred tokens per chunk (measured: largest utf8_decode unit is ~620 tokens with the syntax card)"
      deterministic_first:
        status: PROPOSED
        principle: "Start from deterministic code and expand from there. Pay tokens only for what cannot be stated as data or as a known pattern, and pay them once."
        same_as: "the spec compiler's tiers: T0/T1 emit with zero model tokens, T2/T3 use a model (SPEC_COMPILER.spec)"
        ladder:
          - rung: 1
            name: derive
            tokens: 0
            when: "the boundary is fully stated as data"
            how: "the synthesizer emits the code directly from the boundary"
            boundary_forms:
              - form: cases
                meaning: "input ranges or values → outputs; first match wins; an else is required"
                example: "seq_len: cases [{when: 0x00..0x7F, then: 1}, {when: 0xC2..0xDF, then: 2}, {when: 0xE0..0xEF, then: 3}, {when: 0xF0..0xF4, then: 4}], else: 0"
              - form: formula
                meaning: "one expression over the inputs"
                example: "add_cont: (acc << 6) | (b & 0x3F)"
              - form: predicate
                meaning: "a boolean expression or a range test"
                example: "is_cont: b in 0x80..0xBF"
              - form: reject_if
                meaning: "a list of conditions, any true → false (or a gap); otherwise true"
                example: "valid_scalar: reject_if [n == 2 and cp < 0x80, n == 3 and cp < 0x800, n == 4 and cp < 0x10000, cp in 0xD800..0xDFFF, cp > 0x10FFFF]"
          - rung: 2
            name: template
            tokens: "a few expressions"
            when: "the unit follows a known pattern"
            how: "the synthesizer emits the template's fixed skeleton; a model fills only the named holes, each one expression"
            templates:
              - { name: fail_fast_scan, shape: "walk a list by a step the body chooses; stop at the first failure with its position; else return the accumulated result", example: "decode: holes step = seq_len(bs[i]), item = …, ok = valid_scalar(cp, n)" }
              - { name: fold,           shape: "state + each item → new state" }
              - { name: validate,       shape: "a value against a boundary → value or a gap" }
              - { name: route,          shape: "an event → one of several out edges by a declared key" }
            note: "templates are chunks themselves, so the set grows as patterns repeat"
          - rung: 3
            name: model
            tokens: "a chunk prompt (a few hundred)"
            when: "the logic cannot be stated as data or as a template"
            how: "a model writes the unit from its boundary alone (CH-05), with retries on test failure"
        rules:
          - id: DF-01
            text: "Every new chunk is tried at the lowest rung first. It moves up only when its boundary cannot be stated at that rung."
          - id: DF-02
            text: "Every chunk records the rung it was made at and the hash of the boundary it was made from, so model-written code is always known and can be found."
          - id: DF-03
            text: "Pay tokens once: an accepted rung-2 or rung-3 result is kept by boundary hash. The same boundary is never sent to a model again; a changed boundary is."
          - id: DF-04
            text: "When a model result repeats a pattern, the pattern becomes a template (rung 2), and the units using it move down a rung. Expansion means the deterministic core grows."
          - id: DF-05
            text: "Code at every rung must pass the chunk's tests. Rung 1 is not exempt."
          - id: DF-06
            text: "Independent check: code derived from a boundary agrees with tests derived from the same boundary, so a mistake in the boundary passes both. Every rung-1 or rung-2 chunk also needs known-answer vectors from a source outside the spec (a standard's test vectors or a separate implementation), as the ledger hash did with Python (4.2)."
        expected_effect: "In utf8_decode, five of six units are rung 1 (zero tokens) and decode is rung 2 (three holes). Not measured yet; bench/chunks.js gains a third condition for it."
      evidence:
        bench: bench/chunks.js
        suite: bench/chunks/utf8_decode/chunks.spec
        status: "plumbing proven against a fake model server; no real model has run it yet (model hosts are blocked in the build workspace)"
        observed: "In mutation testing, three of ten deliberate mistakes in one unit were absorbed by another unit's boundary: the assembled decoder's output did not change."
      relation_to_existing:
        - "emerge/chunk/ builds a prompt payload per knowledge-graph node; this section makes every unit fit that payload by construction."
        - "component boundary (1 to 5 invariants) becomes the boundary of every chunk."
        - "roads become one edge type among several."
      open:
        - { id: CH-Q1, question: "Does layer I (the contract) hold every edge, including links between data rows, or only structural ones (roads, dependencies) while data edges stay inside their store? Holding all makes every new row link change the contract hash." }
        - { id: CH-Q2, question: "Edge types: a fixed set (road, ref, depends_on, part_of), or declarable like kinds?" }
        - { id: CH-Q3, question: "Code as chunks: store .eg source content-addressed (fns and components by hash), or keep files and derive chunks from them?" }
        - { id: CH-Q4, question: "Where do known-answer vectors come from for each chunk (DF-06), and who signs off that a source is independent?" }
        - { id: CH-Q5, question: "Is the synthesizer written in .eg from the start (so emerge.exe runs it, section 0), or prototyped in the spec compiler first?" }

    s16_the_loop:
      number: "16"
      title: The loop — one atom at every zoom
      status: PROPOSED
      new_in: cie-eg.spec (2026-10-31; not in the .md yet)
      his_words:
        - "James, 2026-10-31: \"what about specs being blueprints?\""
        - "James, 2026-10-31: \"Replable code generation, without ai.\""
        - "James, 2026-10-31: \"Replay engine. A gate inbetween each function? That defines boundaries.\""
        - "James, 2026-10-31: \"Zoom out. I'm a systems thinker. Non linear.\""
        - "James, 2026-10-31: \"Yes, and agnostic. Learns from each failed test. This is basically becoming a llm\""
      reading: >
        The coder's reading of those words, to confirm. Sections 4, 6, 13 and 15 are one loop, and the loop has one atom.
      atom:
        name: crossing
        text: >
          gate + boundary + record. Every boundary (system, component, UI layer, macro step, function, chunk) is a gate.
          The gate's declaration IS the boundary (input shape, output shape, 1 to 5 invariants). Every crossing is
          checked; a failed check is a gap at that exact edge; every crossing is recorded naming the crossing that caused
          it. Replay, rewind, fork, clips, failure reports, macros, test vectors and the UI timeline are views of the
          recorded crossings, not separate systems.
        zoom: "his increments of zoom (2026-10-02): system → component → function → expression; the same atom at each."
      loop:
        - "SPEC = BLUEPRINT. The spec is intent and the only thing called a blueprint. Nothing observed rewrites it."
        - "SYNTHESIZE (15): derive → template → gap. No model inside the loop."
        - "COMPILE: .eg → exe (10)."
        - "RUN: every boundary a gate (6, extended to functions)."
        - "TIMELINE: crossings into the ring; failures and checkpoint digests into the ledger (4)."
        - "VIEWS: replay, clips, macros, the UI timeline."
        - "OBSERVE (13): repeats and drift become gaps and proposals."
        - "LEARN: back into the vocabulary and templates (eg say / teach), never into the spec's intent."
      agnostic:
        text: >
          The gate does not care what is behind it: an .eg fn, a JS function, a shell command, a model call, a macro step,
          a person. Anything behind a gate is replayable once its result is recorded. A model is one impure function
          behind a gate: recorded, replayable with the model stopped (as Nexus's ollama tape already does), and each
          accepted answer becomes a template or a word, so the next run needs no model.
      learning:
        text: >
          Learns from each failed test. A failed crossing is a gap carrying caller, callee, inputs and the recorded
          neighbourhood (a clip). The fix is learned as a named, dated, inspectable entry: a case, a template, or a word,
          each holding the failing crossing as its proof. The system learns HOW (vocabulary, templates, cases); only he
          changes WHAT (the spec).
        rules:
          - id: LP-01
            text: "A learned entry is accepted only if every recorded crossing still replays with the same output (no regression). Otherwise it is a proposal."
          - id: LP-02
            text: "A learned entry is never anonymous: it names the failure it came from, its date, and its proof crossings."
          - id: LP-03
            text: "Nothing is guessed. What no word, template or case covers is a gap, closed once."
          - id: LP-04
            text: "Model use is measured: the count of gaps closed by a model per run. The loop's direction is that count falling to zero."
          - id: LP-05
            text: "Negative space: what never crossed is measured, not assumed covered — boundaries and edges never crossed, cases and else branches never taken, error paths never produced, input ranges a boundary admits but no crossing has shown, and an expected successor missing (A is followed by B in the grammar; here it was not). Each is a gap (evidential) and a test target before it fails."
          - id: LP-06
            text: "Shadow: what happened but went unnoticed is probed, not trusted — a deliberate break of one unit that no gate catches is a boundary too loose (as in 15's evidence: three of ten mistakes absorbed by another unit's boundary); a gap that fires downstream of its cause is attributed to its root by causal parent, not to where it surfaced; a soft constraint absorbing the same cost again and again is friction carried, not resolved. Each is a gap (assumption) that tightens a boundary."
          - id: LP-07
            text: "Innovation outside its own scope: negative space and shadow are relative to what it already knows (its box). To leave the box it recombines: two known entries (templates, cases, words, boundaries, components) combined, or one mutated, gives a candidate it was never taught. The gate selects: a candidate survives only if it holds its boundary, fills a negative-space region or a gap, and every recorded crossing still replays (LP-01). Survivors are learned with their lineage (parent A + parent B, the mutation, the proof). Rolls are seeded and recorded, so an innovation replays like anything else. Candidates may propose a spec change; they never make one (intent is his)."
            his_words:
              - "James, 2026-10-31: \"it can only reason inside of its own relative scope of learning … if we use variable-based innovation, taking two things and innovating and creating, then we can innovate outside the relative scope of understanding … Mutating, integrating something new from what's known already.\""
              - "His innovation toolkit (Nexus docs/innovation-toolkit-main.md, 4. Variable-Driven Innovation): \"Take two existing variables and combine them … Add variables one at a time. Observe how the meaning shifts. Combine until something clicks.\" · 22. \"Box Identification: Any assumption or accepted way is a box.\" · 25. \"Force recombination across domains … Accept contradictions as scaffolding.\""
        sources_of_learning: >
          Three, one per tense of evidence: failed tests (what happened and failed), shadow (what happened and was not
          noticed), negative space (what never happened). A model learns only from what it sees; this knows the shape of
          what it has not seen, because every boundary is declared and every crossing is recorded.
        human_text_detectors: >
          Not ported. Nexus rfr2/liminal shadow.js and negative-space.js read human language (pronouns, minimisation,
          grief, avoidance); the ledger has none, and people-modelling sits behind his consent boundary. The same decision
          observe/liminal.js already records ("left behind on purpose"). Only the reasoning shape is carried over.
        versus_a_model: >
          Like a language model: it learns from examples (crossings), turns a description into code, and improves with
          failures. Unlike one: every learned thing is a named entry with its source, not a weight; the same input gives
          the same bytes; it can say why; and it does not generalise past what it was taught — it names the gap instead.
          It trades generalisation for proof.
      levels:
        text: "per gate, his StreamLog levels: OFF (check only) · EVENTS (which crossed) · DEEP (+ shapes) · DATA (+ values; replay needs this)."
      defaults_to_override:
        - "every fn gets a gate, not only exports (his: \"a gate inbetween each function\")"
        - "default level DATA in eg test and eg replay, EVENTS in eg run"
        - "ring = the replay window; ledger = failures, ingress results and a digest of the ring at each checkpoint (answers the RFR2 ring vs ledger question)"
        - "a list or map crossing a gate may not be mutated by the callee (checker refuses), so CH-04 holds"
        - "impure builtins (read_file, read_bytes, args, time, a model) are ingress gates: their result is recorded and replay feeds it back"
      sources_merged:
        - "Nexus intelligence/rfr2: kernel, causality, clip, compress, context, query, enforcement, version-gate (to port to .eg; field/relational.js excluded: his consent boundary)"
        - "Nexus clear-glass .macro: gated steps, already his node envelope"
        - "Nexus ollama/lib/tape.js: model calls as recorded frames"
        - "Nexus lib/blueprint.js: divergence from the blueprint opens a gap"
      first_milestone:
        text: "record bench/chunks/utf8_decode at DATA, replay it byte for byte, then replay seq_len alone from its recorded crossings."
        exit_test: "replay output identical to the recorded run; a deliberately broken seq_len is caught at its gate as a gap naming the crossing."

    s12_open_decisions:
      number: "12"
      title: Open decisions, in priority order
      decisions:
        - { id: D1, priority: 1, question: "Node as stage 0?",                                          ref: "10.1", status: OPEN }
        - { id: D2, priority: 2, question: "Add int, bytes, and bitwise operators",                     ref: "3",    status: DECIDED, resolution: "Real 64-bit int added." }
        - { id: D3, priority: 3, question: "Root key storage and loss policy.",                         ref: "8.4",  status: OPEN }
        - { id: D4, priority: 4, question: "Keep Cobalt-style dedup?",                                  ref: "4.7",  status: OPEN, note: "13.6 proposes the count as an index" }
        - { id: D5, priority: 5, question: "NFC tables in .eg, or a restricted subset first?",          ref: "2.3",  status: OPEN }
        - { id: D6, priority: 6, question: "UUID layout: standard form or prefix form?",                ref: "9",    status: OPEN }
        - { id: D7, priority: 7, question: "Contract syntax: new contract block as proposed, or reuse wire only?", ref: "6.1", status: OPEN }
        - { id: D8, priority: 8, question: "Data types and stores (14): adopt, and answer DT-Q1..Q5?",  ref: "14",   status: OPEN, note: "new in cie-eg.spec" }
        - { id: D9, priority: 9, question: "Chunks as layers (15): adopt, and answer CH-Q1..Q3?",       ref: "15",   status: OPEN, note: "new in cie-eg.spec; bench/chunks.js measures it" }
        - { id: D10, priority: 10, question: "The loop (16): adopt, and keep or override its defaults_to_override?", ref: "16", status: OPEN, note: "new 2026-10-31; MOD-REPLAY builds on it" }

  # ══════════════════════════════════════════════════════════════════════════
  # COMPILER VIEW — modules, events, schemas, enforcement, derived from the sections above
  # ══════════════════════════════════════════════════════════════════════════

  modules:

    - id:    MOD-TEXT
      name:  text
      uuid:  cie-eg-text-v0-3-1-0001
      build:
        state: partial
        file: emerge/lang/cie/text.eg
        blocked_by: []
        existing:
          - "emerge/lang/runtime.js: strict UTF-8, byte_len, NFC check"
        next: "code(ch), category(ch), digit_value(ch) (2.5) and is_identifier (2.4) in .eg; decode refuses with a structural 0.95 gap carrying the byte offset. normalize waits on D5 (NFC tables)."
      spec_ref: s02_text_model
      description: >
        The text component. Strict UTF-8 decoding, NFC check and explicit normalize, identifier charset, symbol properties.
        Refuses; never repairs. Every refusal is a gap through the gate.
      exports:
        - "decode(b: bytes) → string | gap(structural, 0.95, byte_offset)"
        - "is_nfc(s: string) → bool"
        - "normalize(s: string) → string   (explicit hook only)"
        - "is_identifier(s: string) → bool"
        - "len(s) → int · byte_len(s) → int"
        - "code(ch) → int · category(ch) → string · digit_value(ch) → int?"
      gate_pipeline:
        - "GATE-TXT-001: bytes → strict UTF-8 decode → string, else gap malformed_utf8"
        - "GATE-TXT-002: string (hashed, id or ledger body) → NFC check → string, else gap non_nfc"
        - "GATE-TXT-003: id, hook, namespace or contract id → identifier charset check → else gap"
      behavioral_contracts:
        - "Never produces U+FFFD."
        - "Never normalizes implicitly; normalize is a hook a caller asks for."
        - "UTF-16 and lone surrogates appear nowhere."
      error_paths:
        - "invalid UTF-8 → gap structural 0.95 with byte offset of the first bad byte"
        - "non-NFC where NFC is required → gap structural 0.5"
        - "identifier outside [A-Za-z0-9_] segments → refused with a gap"

    - id:    MOD-LEDGER
      name:  ledger
      uuid:  cie-eg-ledger-v0-3-1-0001
      build:
        state: built
        blocked_by: []
        existing:
          - "emerge/lang/ledger.js"
          - "emerge/lang/test/ledger.test.js"
      file_ref: emerge/lang/ledger.js
      spec_ref: s04_ledger
      status: BUILT
      description: >
        Append-only, hash-chained ledger. Length-prefixed SHA-256 entry hashing with domain tags, ECF canonical bodies,
        checkpoints with Merkle roots, proofs, verify. Persistence with torn-tail recovery is PROPOSED.
      deps:
        - { name: text }
      schema_refs: [LedgerEntry, CheckpointBody, GapBody, GenesisBody]
      produces: [genesis, boot, checkpoint, gap]
      exports:
        - "append(kind: string, body: any) → LedgerEntry"
        - "Verify() → bool"
        - "ledger_verify(seq: int) → bool"
        - "Gaps() → LedgerEntry[]"
        - "ledger_proof(seq: int) → Proof"
        - "ledger_check_proof(proof: Proof) → bool"
        - "canonical(v: any) → bytes   (ECF)"
      gate_pipeline:
        - "GATE-LED-001: body → canonical(body) (ECF; NaN, infinity, fns and compartments refused)"
        - "GATE-LED-002: tag || prev || seq || len(kind) || kind || len(body) || body → SHA-256 → hash"
        - "GATE-LED-003: every checkpoint_every entries → checkpoint {head, entries, gaps, digests, root}"
        - "GATE-LED-004: entry bytes → u32 length || bytes → flush before delivered is reported (4.8)"
      behavioral_contracts:
        - "Genesis prev is 32 zero bytes; seq starts at 1."
        - "Any edit, deletion or reordering fails Verify()."
        - "A checkpoint is checked against the chain it sits in (head, count, gap count, Merkle root)."
        - "An int and a num of the same value write the same bytes."
        - "No hidden clock: time enters only as data from a clock component (4.9)."
      error_paths:
        - "non-data value in a body → gap structural (today a runtime error)"
        - "torn tail on open → truncate, gap structural 0.6 'torn tail recovered'"
        - "ledger unwritable → the gate halts and says so"

    - id:    MOD-LEDGER-FILE
      name:  ledger_file
      uuid:  cie-eg-ledger-file-v0-3-1-0001
      build:
        state: not_built
        file: emerge/lang/cie/ledger_file.eg
        blocked_by: []
        next: "the on-disk format of 4.8 in .eg: write, open with torn-tail recovery, and the causal-parent field (13.8) fixed before the native runtime is written (section 0)."
      spec_ref: s04_ledger.persistence
      description: >
        The ledger on disk (4.8). A file is a sequence of records, each u32 length || entry bytes. An entry is flushed before
        the gate reports its event delivered. On open, an incomplete last record is truncated and recorded as a gap; if the
        ledger cannot be written, the gate halts. Split from MOD-LEDGER, which is built, so that work is not reopened.
      deps:
        - { name: ledger }
      schema_refs: [LedgerEntry]
      produces: [gap]
      exports:
        - "encode_record(entry: map) → bytes   (u32 big-endian length || canonical entry bytes)"
        - "decode_records(b: bytes) → map   ({ entries: list, torn_at: int? }: whole records, and the offset of an incomplete tail)"
        - "write_entry(path: string, entry: map) → bool   (appends one record and flushes)"
        - "open_ledger(path: string) → map   ({ entries: list, recovered: bool }; a torn tail is truncated and recorded as a gap)"
      gate_pipeline:
        - "GATE-LF-001: entry → canonical bytes (ECF, 4.3) → u32 BE length prefix → record"
        - "GATE-LF-002: record → append to file → flush → only then is the event reported delivered"
        - "GATE-LF-003: open → read whole records → an incomplete last record → truncate → gap structural 0.6 'torn tail recovered'"
        - "GATE-LF-004: records → Verify() (4.4) → refuse to continue on failure"
      behavioral_contracts:
        - "encode_record then decode_records returns the same entries, byte for byte."
        - "A file cut anywhere inside its last record reopens with every whole record and one torn-tail gap (AT-07)."
        - "Recovery is never silent: a truncation always writes a gap."
        - "The causal-parent field (13.8) is part of the record format before the native runtime is written."
      error_paths:
        - "incomplete last record → truncate, gap structural 0.6 'torn tail recovered', continue"
        - "write fails (disk full, key missing) → the gate halts and says so; it never continues unrecorded"
        - "a record whose length runs past the end of the file → treated as a torn tail"

    - id:    MOD-REGISTRY
      name:  registry
      uuid:  cie-eg-registry-v0-3-1-0001
      build:
        state: partial
        file: emerge/lang/cie/registry.eg
        blocked_by: []
        existing:
          - "emerge/lang/components.js: register entries, derived uuids"
        next: "shape_hash (5.1) and registry_hash (5.3); a duplicate or malformed record is refused with a gap, not an error (AT-10)."
      file_ref: emerge/lang/components.js
      spec_ref: s05_component_registry
      description: "Component registry. Validates records, derives uuids and shape hashes, writes register entries, computes the registry hash."
      deps:
        - { name: ledger }
        - { name: identity }
        - { name: text }
      schema_refs: [ComponentRecord]
      produces: [register, gap]
      exports:
        - "register(rec: map) → string | gap   (rec is a ComponentRecord)"
        - "registry_hash() → hash"
        - "lookup(id: string) → hook table   (gate only; never handed to components)"
      gate_pipeline:
        - "GATE-REG-001: record → identifier charset and semver check → else gap"
        - "GATE-REG-002: record → duplicate id check → else gap"
        - "GATE-REG-003: record → derive uuid (9) and shape_hash → register entry"
      behavioral_contracts:
        - "The registry holds components; it does not give them to each other."
        - "registry_hash = SHA-256 over sorted (id, version, uuid, shape_hash); recorded in genesis and every checkpoint."
      error_paths:
        - "duplicate id → second refused with a gap (AT-10)"
        - "malformed record → refused with a gap"

    - id:    MOD-CONTRACT
      name:  contract
      uuid:  cie-eg-contract-v0-3-1-0001
      build:
        state: not_built
        file: emerge/lang/cie/contract.eg
        blocked_by: [D7]
        next: "parse the contract block, contract_hash; wire compiles to a road."
      spec_ref: s06_contract_and_gate.contract_format
      description: "The interaction contract: version, text settings, gate settings, roads. wire compiles to a road. contract_hash goes into genesis and every checkpoint."
      deps:
        - { name: text }
        - { name: ledger }
      schema_refs: [Contract]
      exports:
        - "parse_contract(src) → Contract"
        - "contract_hash(c: Contract) → hash"
        - "roads_from(hook: string) → Road[]"
      gate_pipeline:
        - "GATE-CON-001: contract source → parse (version, text, gate, roads); wire statements → roads"
        - "GATE-CON-002: every road end → identifier charset (2.4) → else refused"
        - "GATE-CON-003: contract → canonical (ECF) → SHA-256 → contract_hash → genesis and every checkpoint"
      behavioral_contracts:
        - "A road is the only way an event travels: one out hook to one in hook."
        - "Changing a contract changes its version and hash; an old ledger stays verifiable against the contract it recorded."
      error_paths:
        - "road endpoint not an identifier → refused at parse"

    - id:    MOD-GATE
      name:  gate
      uuid:  cie-eg-gate-v0-3-1-0001
      build:
        state: partial
        file: emerge/lang/cie/gate.eg
        blocked_by: []
        existing:
          - "emerge/lang/runtime.js: wire dispatch, FIFO queue, max_deliveries storm"
        next: "the seven steps of 6.2 in .eg (the runtime emerge.exe will run): a deliver entry per delivery, every failure a gap from the 6.3 table with from, to and event hash, block_at closes a road (AT-03, AT-04, AT-05). Until contract (D7) lands, roads come from wire."
      spec_ref: s06_contract_and_gate.gate_pipeline
      description: "The event gate. Runs every event through the seven steps of 6.2; first failure stops it and writes a gap. FIFO queue, storm limit, road blocking at block_at."
      deps:
        - { name: registry }
        - { name: contract }
        - { name: ledger }
        - { name: text }
      schema_refs: [GapBody]
      produces: [deliver, gap, gap.ack, gap.close]
      exports:
        - "gate_emit(from: string, payload: any) → bool   (named gate_emit: emit is an Emerge keyword)"
        - "drain() → { delivered: int, gaps: int }"
        - "ack(gap_hash, reason) · close(gap_hash, reason)"
      gate_pipeline:
        - "GATE-EG-001: source is a registered out hook → else unregistered_source (structural 0.9)"
        - "GATE-EG-002: payload valid UTF-8 and NFC where required → else malformed_utf8 / non_nfc"
        - "GATE-EG-003: payload fits source shape with declared interpretation → else shape_broken / wrong_interpretation"
        - "GATE-EG-004: at least one road from this hook → else no_road (structural 0.6)"
        - "GATE-EG-005: per road, destination is a registered in hook and payload fits its shape → else road_to_nothing / shape_broken"
        - "GATE-EG-006: write deliver entry, then call the destination"
        - "GATE-EG-007: delivery failed → gap causal 0.7; other roads still run"
      behavioral_contracts:
        - "The gate never converts a value."
        - "Events raised during delivery wait in a FIFO queue."
        - "Past max_steps deliveries in one drain → stop and record a storm gap (structural 1.0)."
        - "A gap at or above block_at closes its road until the gap is closed."
        - "Gaps are never deleted."
      error_paths:
        - "every failure in the gap table (6.3) → a gap entry carrying type, message, pressure, from, to, event hash"

    - id:    MOD-BOOT
      name:  boot
      uuid:  cie-eg-boot-v0-3-1-0001
      build:
        state: not_built
        file: emerge/lang/cie/boot.eg
        blocked_by: []
        next: "manifest_root over the core files, genesis fields manifest_root/builder/contract_hash/registry_hash, a boot entry linking to the previous head, mismatch refuses with a contradiction 1.0 gap (AT-08)."
      spec_ref: s07_boot_hash_chain
      description: "Boot hash chain. Genesis commits to manifest root, builder, contract and registry hashes, chain id and text settings. Each later start writes a boot entry linking to the previous head."
      deps:
        - { name: ledger }
        - { name: registry }
        - { name: contract }
        - { name: identity }
      schema_refs: [GenesisBody]
      produces: [genesis, boot, gap]
      exports:
        - "boot(manifest: file[]) → ok | halt"
        - "manifest_root(files) → hash"
      gate_pipeline:
        - "GATE-BOOT-001: core files → SHA-256 each → Merkle root → manifest_root"
        - "GATE-BOOT-002: manifest_root vs genesis → mismatch → gap contradiction 1.0 → halt"
        - "GATE-BOOT-003: first start → genesis {manifest_root, builder, contract_hash, registry_hash, chain_id, text}"
        - "GATE-BOOT-004: later start → boot entry with prev = previous run's head → boot checkpoint"
      behavioral_contracts:
        - "Manifest mismatch → gap contradiction 1.0 and refuse to continue; never start quietly."
      error_paths:
        - "core file altered → boot refused with a gap (AT-08)"

    - id:    MOD-SEAL
      name:  seal
      uuid:  cie-eg-seal-v0-3-1-0001
      build:
        state: not_built
        file: emerge/lang/cie/seal.eg
        blocked_by: [D3]
        next: "AES-256-GCM sealing once root key storage is decided."
      spec_ref: s08_sealing
      description: "AES-256-GCM sealing of entry bodies with readable AAD, per-component HKDF keys, nonce from chain id and seq, rekey entries."
      deps:
        - { name: ledger }
        - { name: identity }
      produces: [rekey, gap]
      exports:
        - "seal(entry, key) → ciphertext"
        - "open(entry, key) → body | gap"
        - "rekey(component) → rekey entry"
      gate_pipeline:
        - "GATE-SEAL-001: genesis verifies → release root key → else gap evidential 0.9"
        - "GATE-SEAL-002: root key + component uuid → HKDF-SHA-256 → component key"
        - "GATE-SEAL-003: nonce = 4 bytes of chain id hash || seq (u64 BE)"
        - "GATE-SEAL-004: AAD (seq, kind, prev, gap type/pressure/endpoints) + canonical body → AES-256-GCM → ciphertext"
        - "GATE-SEAL-005: ciphertext → chain hash (verifies without the key)"
      behavioral_contracts:
        - "The chain hash is over the ciphertext, so the chain verifies without any key."
        - "A nonce never repeats under one key."
        - "No hand-written AES: AES-NI with carry-less multiply, or the OS crypto library."
      error_paths:
        - "key missing or unreadable → gap evidential 0.9"
        - "sealed entry moved → GCM authentication fails (AT-09)"

    - id:    MOD-IDENTITY
      name:  identity
      uuid:  cie-eg-identity-v0-3-1-0001
      build:
        state: partial
        file: emerge/lang/cie/identity.eg
        blocked_by: [D6]
        existing:
          - "emerge/lang/runtime.js: chain id (UUID v8)"
          - "emerge/lang/components.js: component uuid in the emerge-component- prefix form"
        next: "component uuid in the layout D6 picks."
      spec_ref: s09_identity
      description: "Derived names: component uuid from namespace/id@version, chain id from seed and version. Entries are identified by their hash."
      exports:
        - "component_uuid(namespace, id, version) → uuid"
        - "chain_id(seed, version) → uuid"
      gate_pipeline:
        - "GATE-ID-001: namespace, id, version → identifier and semver check"
        - "GATE-ID-002: \"eg.component.v1\" 0x00 namespace \"/\" id \"@\" version → SHA-256 → first 128 bits → uuid"
        - "GATE-ID-003: \"eg.chain.v1\" 0x00 seed \" \" version → SHA-256 → UUID v8, variant 10 → chain_id"
      behavioral_contracts:
        - "Same component → same uuid; shape changes are caught by shape_hash."
      error_paths:
        - "id, namespace or version malformed → no uuid; the registry refuses the record with a gap"

    - id:    MOD-OBSERVE
      name:  observe
      uuid:  cie-eg-observe-v0-3-1-0001
      build:
        state: built
        blocked_by: []
        existing:
          - "emerge/observe/"
          - "emerge/test/observe.test.js"
          - "emerge/test/debug.test.js"
      file_ref: emerge/observe/index.js
      spec_ref: s13_observation
      description: "Pure readings of a verified ledger: deltas, sigma regime, CFR field, liminal signals, gap hunter; debugging with why, at, follow, diff, blame, clip."
      deps:
        - { name: ledger }
      exports:
        - "observe(entries) → Report"
        - "observe_gaps() → gap entries through the gate"
        - "why(seq) · at(seq) · follow · diff(a, b) · blame · clip(from, to)"
      gate_pipeline:
        - "GATE-OBS-001: ledger → Verify() → else refused"
        - "GATE-OBS-002: entries → about-key; drop observer-caused entries from measurement"
        - "GATE-OBS-003: entries → deltas (S, K, C) → sigma regime"
        - "GATE-OBS-004: entries → CFR field → liminal signals → gap hunter proposals"
        - "GATE-OBS-005: observe_gaps() → proposals through the gate as gap entries (deduped)"
      behavioral_contracts:
        - "A report is never written back to the ledger."
        - "Entries the observer caused are excluded from every measurement."
        - "Not measured is null, never 0."
      error_paths:
        - "unverifiable ledger → refused"

    - id:    MOD-NATIVE
      name:  native
      uuid:  cie-eg-native-v0-3-1-0001
      build:
        state: built
        blocked_by: []
        existing:
          - "emerge/lang/native/emerge.eg, front.eg, codegen.eg, rt.eg, rt_text.eg, x64.eg, elf.eg, pe.eg, json.eg, embed.eg"
          - "emerge/lang/native/bin/emerge (Linux x86-64, self-built)"
          - "emerge/lang/test/native.test.js (72 programs, native == interpreter)"
          - "emerge/lang/test/selfhost.test.js (stage 0 == stage 1 == stage 2, AT-11)"
      file_ref: emerge/lang/native/emerge.eg
      spec_ref: s10_build_and_bootstrap
      built_note: >
        2026-10-28. The native compiler is written in Emerge and compiles itself on Linux x86-64: Node ran it once (stage 0,
        about 9 s); the binary it made compiles the compiler's own source to the same bytes (stage 1 and stage 2, about
        0.3 s each). Values are tagged 64-bit words; the runtime (rt.eg) is Emerge in raw mode, carried inside the compiler.
      description: "The native compiler, in Emerge: front end, code generator, runtime, x86-64 encoder, ELF and PE writers; stage 0 → 1 → 2 byte-identical."
      exports:
        - "emerge <main.eg> [-o out]   (native/bin/emerge)"
        - "eg native <file.eg> [-o out] [--stage0]"
      gate_pipeline:
        - "GATE-NAT-001: main file and every used module → front.eg → syntax trees (dependencies first)"
        - "GATE-NAT-002: trees + the embedded runtime → codegen.eg → x64.eg → ELF executable"
        - "GATE-NAT-003: the compiler compiles itself → byte-compare with the committed binary (selfhost.test.js)"
      behavioral_contracts:
        - "Only outside dependency: the Linux kernel (syscalls). No libc, no Node at run time or at build time after stage 0."
        - "Stage-0, stage-1 and stage-2 outputs are byte-identical (AT-11)."
        - "Every native program gives the interpreter's stdout and exit status (native.test.js)."
      error_paths:
        - "construct outside the native subset → refused by name, never skipped"
        - "runtime error → message on stderr, exit status 1, as in the interpreter"

    # ── retiring Node: everything below runs on Node today. Built in this order; each step keeps the interpreter as the
    #    reference until its native replacement passes the same tests. (2026-10-28, James: "i want node out of here")
    - id:    MOD-NATIVE-LANG
      name:  native_lang
      uuid:  cie-eg-native-lang-v0-3-1-0001
      build:
        state: not_built
        file: emerge/lang/native/codegen.eg
        blocked_by: []
        next: "F5: ** with a fractional operand (a port of fdlibm's pow, as V8's Math.pow). Built: closures, fn values, try/else, ** and the prelude (2026-10-29); fractional nums (2026-10-31, emerge 1.9.0)."
      spec_ref: s10_build_and_bootstrap
      description: "The rest of the expression language, natively: closures, functions as values, try, **, the prelude, fractional nums."
      deps:
        - { name: native }
      exports:
        - "lambdas and fn values in native programs; try … else e { }; a ** b; prelude functions"
      gate_pipeline:
        - "GATE-NL-001: Lambda → closure object (code address + captured cells); calls through it"
        - "GATE-NL-002: try → a handler frame; raise unwinds to it; the error text reaches the else variable"
        - "GATE-NL-003: core/prelude.eg compiled into every program that uses it"
        - "GATE-NL-004: num → IEEE double when not integral; printing matches the interpreter (shortest round-trip)"
      behavioral_contracts:
        - "Every case in native.test.js and differential.test.js gives the interpreter's output."
      error_paths:
        - "anything still outside the subset → refused by name"
      # ADDENDUM 2026-10-31 (emerge 1.8.0). James: "Fix the primitives. Use all of my quotes from nexus to consolidate emerge functions."
      # GATE-NL-003 widened: 22 builtins moved from lang/runtime.js into core/prelude.eg (ceil round abs sort clone trim replace hex
      # from_hex u8 u16le u32le u64le i32le i64le u16be u32be u64be read_u64be wrap32 rotl rotr), so every native program has them,
      # proven case by case in native.test.js ("moved to the prelude"). s02 enforced in the interpreter too: strings are code points.
      # Still outside native: fractional nums (GATE-NL-004), upper / lower (case tables, with D5), sort_by and the other variadic
      # builtins (no optional parameters yet), json / parse_json, the `..` value, matches. Full record: lang/emerge-lang.spec addendum.
      # ADDENDUM 2026-10-31 (b): fractional nums natively, GATE-NL-004. Mapped before code.
      # James, 2026-10-31, quoting the open list back: "native compiler doesn't handle fractional numbers, and can't do upper, lower
      # or matches (regex). Compartments, the ledger and components run only in the interpreter, not natively yet."
      # Order (this plan's): F1–F4 fractional nums; then upper/lower (waits on D5, his), matches, and native_system (ledger,
      # compartments, components).
      # The representation: a num whose value is a whole number within 2^53 stays the tagged small form (every fast path unchanged);
      # any other double (a fraction, larger, ±Infinity, NaN) is boxed [K_FLT][64-bit pattern]. Every result is normalised back to
      # the small form when it can be, so 0.5 + 0.5 is the same value as 1. -0 is 0 (nothing in Emerge can observe the sign).
      # The reference is the interpreter (JavaScript doubles), to the last bit and the last printed digit.
      #   F1 rt.eg: native/float_draft.eg wired in. + - * / % (JavaScript's ((a % b) + b) % b), unary -, < <= > >= ==, floor, idiv,
      #      min / max, type_of; overflow past 2^53 becomes a double (rounded as JavaScript rounds), never a refusal.
      #      depends_on: [native] · files: lang/native/rt.eg (native/float_draft.eg merged into it and removed as a duplicate; in git)
      #   F2 text: printing is JavaScript's shortest round-trip (str, print, repr, json: Infinity / NaN print as in the interpreter,
      #      null in json); num(string) is Number(string), trimmed, decimal with exponent, 0x / 0o / 0b, Infinity; int(num) truncates
      #      toward zero; int / num of a string trimmed as the interpreter does. depends_on: [F1] · files: lang/native/rt.eg
      #   F3 literals: front.eg reads 1.5, 1e-7, 2.5e3; codegen emits a fractional literal as a boxed constant whose 64-bit pattern is
      #      computed in Emerge (exactly, by scaling: the same bits in the interpreter and natively). sqrt via SSE2 (IEEE, correctly
      #      rounded, as Math.sqrt). depends_on: [F1, F2] · files: lang/native/front.eg, lang/native/codegen.eg, lang/native/rt.eg
      #   F4 proof: native.test cases for every path above, the prelude battery's fractional cases, the self-host fixed point (AT-11)
      #      re-reached, CI on Linux and Windows. depends_on: [F3] · files: lang/test/native.test.js, lang/native/bin/emerge
      #   F5 ** with a fractional operand: JavaScript's Math.pow is V8's fdlibm port; matching it bit for bit means porting fdlibm's
      #      pow. Until then a fractional ** is refused natively by name. depends_on: [F4]
      # BUILT 2026-10-31 (emerge 1.9.0): F1–F4. native.test.js 91/91 — three new cases (literals and printing; division, conversions,
      # overflow to doubles and every refusal; the 57-case prelude battery with its fractional cases), each the interpreter's output
      # byte for byte. The compiler reaches its fixed point again (selfhost.test.js: stages 0, 1, 2 identical, AT-11). Open: F5.

    - id:    MOD-NATIVE-SYSTEM
      name:  native_system
      uuid:  cie-eg-native-system-v0-3-1-0001
      build:
        state: not_built
        file: emerge/lang/native/rt.eg
        blocked_by: []
        next: "the ledger natively (SHA-256 via the CPU or OS, ECF, checkpoints — same bytes as lang/ledger.js), then compartments, constraints and signals, then components, hooks, wires and the gate; test blocks and expect, so `emerge test` replaces `eg test`."
      spec_ref: s04_ledger
      description: "The system half of the language, natively: ledger, compartments, constraints, signals, components, the gate, test blocks."
      deps:
        - { name: native_lang }
        - { name: ledger }
      exports:
        - "emerge run <file.eg> · emerge test <file.eg>"
      gate_pipeline:
        - "GATE-NS-001: ledger entries hashed natively → equal to lang/ledger.js's known-answer vectors"
        - "GATE-NS-002: compartments and constraints → transitions, rejections and gaps on the ledger"
        - "GATE-NS-003: components, hooks, wires → the gate's seven steps (6.2)"
        - "GATE-NS-004: test blocks and expect → emerge test"
      behavioral_contracts:
        - "A program's ledger is byte-identical whether it runs in the interpreter or natively."
      error_paths:
        - "hash mismatch against the JS ledger → the build fails, never ships"

    - id:    MOD-NATIVE-TOOLS
      name:  native_tools
      uuid:  cie-eg-native-tools-v0-3-1-0001
      build:
        state: not_built
        file: emerge/lang/native/emerge.eg
        blocked_by: []
        next: "emerge check (the checker in .eg), emerge run, emerge test, emerge build-spec (the spec compiler ported from emerge/compiler/*.js, 6k lines), observe and debug (emerge/observe/*.js); the test harnesses rewritten in Emerge. Then the JavaScript interpreter is retired."
      spec_ref: s00_purpose
      description: "The tools, in Emerge, inside emerge: check, run, test, build-spec, observe, debug. The end of Node in this repository."
      deps:
        - { name: native_system }
      exports:
        - "emerge check | run | test | build-spec | observe | debug"
      gate_pipeline:
        - "GATE-NT-001: each tool ported → its JS tests pass against the native tool"
        - "GATE-NT-002: test harnesses in Emerge → npm test replaced by emerge test"
        - "GATE-NT-003: no .js file left in emerge/ (section 0, end state)"
      behavioral_contracts:
        - "Each JS tool is deleted only after its native replacement passes the same tests."
      error_paths:
        - "a ported tool disagrees with the JS original → the JS stays until it agrees"

    - id:    MOD-NATIVE-WINDOWS
      name:  native_windows
      uuid:  cie-eg-native-windows-v0-3-1-0001
      build:
        state: not_built
        file: emerge/lang/native/pe.eg
        blocked_by: []
        next: "a Windows target: the runtime's syscalls become kernel32 imports (WriteFile, ReadFile, CreateFileW, VirtualAlloc, ExitProcess, GetCommandLineW), the PE writer gets an import table; the compiler builds emerge.exe and emerge.exe rebuilds itself byte for byte."
      spec_ref: s10_build_and_bootstrap.backend
      description: "emerge.exe: the same compiler and runtime on Windows x64 through kernel32."
      deps:
        - { name: native }
      exports:
        - "emerge <main.eg> --target windows -o out.exe"
      gate_pipeline:
        - "GATE-NW-001: runtime I/O behind one OS layer: Linux syscalls or kernel32 imports"
        - "GATE-NW-002: pe.eg writes the import table; the code calls through it"
        - "GATE-NW-003: emerge.exe compiles itself → byte-identical (AT-11 on Windows)"
      behavioral_contracts:
        - "Only kernel32 and the OS crypto library are imported (section 0)."
      error_paths:
        - "an import missing at load → Windows refuses to start the program; the build test catches it"

    - id:    MOD-STORE
      name:  store
      uuid:  cie-eg-store-v0-3-1-0001
      build:
        state: not_built
        file: emerge/lang/cie/store.eg
        blocked_by: [D8]
        next: "schemas and stores (section 14) once adopted."
      spec_ref: s14_data_types_and_stores
      status: PROPOSED
      description: "Schemas (named data types) and stores (components holding tables of rows). Writes are row entries on the ledger; tables are folds over them."
      deps:
        - { name: registry }
        - { name: gate }
        - { name: ledger }
      schema_refs: [SchemaDecl, StoreDecl, RowEntryBody]
      produces: [row, migrate, gap]
      exports:
        - "in insert { table, row } · in update { table, key, row } · in delete { table, key } · in query { table, where?, order?, limit? }"
        - "out changed { table, op, key } · out result { rows }"
        - "schema_hash(s) → hash"
      gate_pipeline:
        - "GATE-STO-001: write event → table exists in the store → else gap"
        - "GATE-STO-002: row → fits the schema (fields, interpretation, checks); declared defaults filled → else gap"
        - "GATE-STO-003: key unique on insert, present on update/delete → else gap"
        - "GATE-STO-004: every ref resolves; no delete of a referenced row → else gap causal 0.7"
        - "GATE-STO-005: row entry on the ledger → fold into the table → out changed"
      behavioral_contracts:
        - "A table is never edited in place; its state is the fold of row entries."
        - "A query never changes a table."
        - "A schema change is a new version; rows move only by an explicit migrate fn, which is recorded."
      error_paths:
        - "missing or unknown field → gap contradiction 0.8"
        - "duplicate key → gap contradiction 0.7"
        - "dangling ref → gap causal 0.7"

    - id:    MOD-SYNTH
      name:  synth
      uuid:  cie-eg-synth-v0-3-1-0001
      build:
        state: not_built
        file: emerge/lang/cie/synth.eg
        blocked_by: [D9]
        next: "the deterministic-first synthesizer (section 15) once adopted; CH-Q5 decides .eg or spec compiler first."
      spec_ref: s15_chunks_as_layers.deterministic_first
      status: PROPOSED
      description: >
        The chunk synthesizer. Turns a chunk's boundary into code by the lowest rung that can: derive (cases, formula,
        predicate, reject_if; zero tokens), template (fixed skeleton, a model fills named holes), or model (the unit from
        its boundary alone). Keeps accepted results by boundary hash so tokens are paid once.
      deps:
        - { name: registry }
        - { name: ledger }
      exports:
        - "synthesize(boundary) → { code, rung, boundary_hash }"
        - "derive(boundary) → code | not_derivable"
        - "fill(template, holes, chat) → code"
        - "promote_template(units) → template   (DF-04)"
      gate_pipeline:
        - "GATE-SYN-001: boundary → hash → cached result? → reuse, zero tokens (DF-03)"
        - "GATE-SYN-002: boundary in a rung-1 form → derive code (DF-01)"
        - "GATE-SYN-003: else boundary names a template → emit skeleton → model fills holes"
        - "GATE-SYN-004: else → model writes the unit from its boundary, retries on test failure"
        - "GATE-SYN-005: code → chunk tests and known-answer vectors → accept (DF-05, DF-06)"
        - "GATE-SYN-006: record rung and boundary_hash with the accepted code (DF-02)"
      behavioral_contracts:
        - "Rung 1 output is byte-identical for the same boundary."
        - "No result is accepted without passing its tests, at any rung."
        - "A rung-1 or rung-2 chunk without independent known-answer vectors is flagged, never silently accepted."
      error_paths:
        - "cases without an else → refused at derive (not derivable)"
        - "template hole fails its tests after retries → the unit moves to rung 3, recorded"
        - "rung 3 fails after retries → a gap (structural) naming the chunk and its boundary hash"

    - id:    MOD-REPLAY
      name:  replay
      uuid:  cie-eg-replay-v0-3-1-0001
      build:
        state: not_built
        file: emerge/lang/cie/replay.eg
        blocked_by: []
        next: "fn boundary syntax in the parser and checker; a gate around every fn call in lang/runtime.js (interpreter and compiled JS byte-identical); a cross ledger kind; eg replay <run> [--fn name]; first milestone of section 16."
      spec_ref: s16_the_loop
      status: PROPOSED
      description: >
        The gate between functions. Each fn's boundary (shapes and 1 to 5 invariants) is checked at every call, the
        crossing is recorded at the gate's level, and a recorded run can be replayed whole or one fn at a time. Failed
        crossings are gaps carrying their clip; they are what the loop learns from.
      deps:
        - { name: ledger }
        - { name: gate }
      exports:
        - "cross(fn, args) → result | gap    (the gate)"
        - "replay(run) → { identical, diffs }"
        - "replay_fn(run, name) → { identical, diffs }"
        - "clip(gap) → the failed crossing with its recorded neighbourhood"
      gate_pipeline:
        - "GATE-RPL-001: call → check input against the fn boundary → gap on failure (caller, callee, inputs)"
        - "GATE-RPL-002: run the fn; impure builtin → record its result as ingress"
        - "GATE-RPL-003: check output against the boundary → gap on failure"
        - "GATE-RPL-004: record the crossing at its level, causal parent = the calling crossing"
        - "GATE-RPL-005: replay → feed recorded inputs and ingress → compare outputs byte for byte"
      behavioral_contracts:
        - "Replay of a DATA-level run is byte-identical, or names the first differing crossing."
        - "Every recorded crossing has a causal parent, except the run's root."
        - "Interpreter and compiled JS record the same crossings."
      error_paths:
        - "boundary check fails → gap (contradiction) at that crossing, never a silent pass"
        - "replay meets an impure call with no recorded result → gap (evidential), never a live call"
        - "callee mutates a list or map that crossed its gate → refused by the checker"

  events:
    ledger:
      - "genesis { seed, version, chain_id, text, manifest_root, builder, contract_hash, registry_hash }"
      - "boot { prev_head }"
      - "register { id, namespace, name, version, uuid, hooks, shape_hash }"
      - "deliver { from, to, event_hash }"
      - "gap { type, message, pressure, from, to, event_hash }"
      - "gap.ack { gap, reason }"
      - "gap.close { gap, reason }"
      - "transition { compartment, changes }"
      - "rejected { compartment, constraint }"
      - "checkpoint { head, entries, gaps, digests, root }"
      - "rekey { component, key_id }"
      - "record { body }"
    proposed:
      - "row { store, table, op, key, row }"
      - "migrate { store, table, from_schema, to_schema }"

  schemas:
    - id: LedgerEntry
      name: LedgerEntry
      complete: true
      description: "One ledger entry (4.1)."
      fields:
        seq:  { type: int,    required: true, description: "from 1, consecutive" }
        kind: { type: string, required: true, description: "an entry kind (4.5)" }
        body: { type: any,    required: true, description: "ECF-canonical data (4.3)" }
        prev: { type: hash,   required: true, description: "hash of the previous entry; 32 zero bytes for genesis" }
        hash: { type: hash,   required: true, description: "SHA-256 over the length-prefixed input (4.2)" }

    - id: CheckpointBody
      name: CheckpointBody
      complete: true
      description: "Body of a checkpoint entry (4.6)."
      fields:
        head:          { type: hash,                 required: true }
        entries:       { type: int,                  required: true, description: "running count" }
        gaps:          { type: int,                  required: true, description: "running count" }
        digests:       { type: "map<string, hash>",  required: true, description: "component id → SHA-256 of canonical state" }
        root:          { type: hash,                 required: true, description: "Merkle root since the previous checkpoint" }
        registry_hash: { type: hash,                 required: false, description: "5.3; not in the built body yet" }
        contract_hash: { type: hash,                 required: false, description: "6.1" }

    - id: GapBody
      name: GapBody
      complete: true
      description: "Body of a gap entry (6.3)."
      fields:
        type:       { type: string, required: true, enum: [logical, evidential, temporal, assumption, contradiction, structural, contextual, causal] }
        message:    { type: string, required: true }
        pressure:   { type: num,    required: true, range: [0, 1] }
        from:       { type: string, required: false }
        to:         { type: string, required: false }
        event_hash: { type: hash,   required: false, description: "hash of the refused event" }
        source:     { type: string, required: false, description: "observe for gaps the observer opened (13)" }
        dedup_key:  { type: string, required: false }
        evidence:   { type: map,    required: false }

    - id: GenesisBody
      name: GenesisBody
      complete: true
      description: "Body of the genesis entry (4.5, 7)."
      fields:
        seed:          { type: string, required: true }
        version:       { type: string, required: true }
        chain_id:      { type: uuid,   required: true }
        text:          { type: map,    required: true, description: "{encoding, normalization}" }
        manifest_root: { type: hash,   required: false, description: "waits for the boot chain" }
        builder:       { type: hash,   required: false, description: "waits for the boot chain" }
        contract_hash: { type: hash,   required: false, description: "waits for the boot chain" }
        registry_hash: { type: hash,   required: false, description: "waits for the boot chain" }

    - id: ComponentRecord
      name: ComponentRecord
      complete: true
      description: "A registry record (5.1)."
      fields:
        id:         { type: identifier, required: true, unique: true }
        namespace:  { type: identifier, required: true }
        name:       { type: string,     required: true }
        version:    { type: semver,     required: true }
        uuid:       { type: uuid,       required: true, derived: "section 9" }
        hooks:      { type: "map<identifier, {dir: in|out, shape}>", required: true }
        shape_hash: { type: hash,       required: true }

    - id: Contract
      name: Contract
      complete: true
      description: "An interaction contract (6.1)."
      fields:
        id:      { type: identifier, required: true }
        version: { type: semver,     required: true }
        text:    { type: map,        required: true, description: "{encoding: utf-8, normalization: nfc}" }
        gate:    { type: map,        required: true, description: "{block_at: 0.9, max_steps: 100000, checkpoint_every: 256}" }
        roads:   { type: "list<{from: hook, to: hook}>", required: true }

    - id: SchemaDecl
      name: SchemaDecl
      complete: true
      description: "PROPOSED (14). A named, versioned data type."
      fields:
        name:        { type: identifier, required: true }
        version:     { type: int,        required: true }
        key:         { type: "list<identifier>", required: true }
        fields:      { type: "map<identifier, {type, optional, default?, check?, ref?}>", required: true }
        schema_hash: { type: hash,       required: true, derived: "SHA-256(\"eg.schema.v1\" 0x00 || canonical(schema))" }

    - id: StoreDecl
      name: StoreDecl
      complete: true
      description: "PROPOSED (14). A store: a component holding tables."
      fields:
        id:      { type: identifier, required: true }
        version: { type: semver,     required: true }
        tables:  { type: "map<identifier, schema name>", required: true }

    - id: RowEntryBody
      name: RowEntryBody
      complete: true
      description: "PROPOSED (14). Body of a row entry."
      fields:
        store: { type: identifier, required: true }
        table: { type: identifier, required: true }
        op:    { type: string,     required: true, enum: [insert, update, delete] }
        key:   { type: any,        required: true }
        row:   { type: map,        required: false, description: "absent on delete" }

  enforcement:
    gates:
      - { id: AT-01, name: ledger-byte-edit,     description: "Edit one ledger byte → Verify() fails.",                              severity: fatal, spec_ref: s11_acceptance_tests }
      - { id: AT-02, name: ledger-delete-reorder, description: "Delete or reorder an entry → Verify() fails.",                      severity: fatal, spec_ref: s11_acceptance_tests }
      - { id: AT-03, name: unregistered-source,  description: "Emit from an unregistered hook → gap, nothing delivered.",           severity: fatal, spec_ref: s11_acceptance_tests }
      - { id: AT-04, name: no-road,              description: "Emit with no road → gap.",                                           severity: fatal, spec_ref: s11_acceptance_tests }
      - { id: AT-05, name: no-conversion,        description: "Send \"1\" where int is declared → contextual gap, nothing converts.", severity: fatal, spec_ref: s11_acceptance_tests }
      - { id: AT-06, name: strict-utf8,          description: "Invalid UTF-8 → gap with byte offset, no U+FFFD.",                   severity: fatal, spec_ref: s11_acceptance_tests }
      - { id: AT-07, name: torn-tail,            description: "Truncate mid-record → reopen writes torn-tail gap and continues.",   severity: fatal, spec_ref: s11_acceptance_tests }
      - { id: AT-08, name: manifest,             description: "Alter a core file → boot refuses and records a gap.",                severity: fatal, spec_ref: s11_acceptance_tests }
      - { id: AT-09, name: gcm-position,         description: "Move a sealed entry → GCM authentication fails.",                    severity: fatal, spec_ref: s11_acceptance_tests }
      - { id: AT-10, name: duplicate-id,         description: "Register two components with one id → second refused with a gap.",  severity: fatal, spec_ref: s11_acceptance_tests }
      - { id: AT-11, name: self-host,            description: "Rebuild the compiler with itself → byte-identical output.",         severity: fatal, spec_ref: s11_acceptance_tests }
