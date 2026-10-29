# CIE-EG Specification v0.3.1

Emerge’s core architecture: a **C**omponent registry, an **I**nteraction contract, and an **E**vent gate with an event ledger that records gaps. Written for a from-scratch, self-hosted `emerge.exe`.

**Built tag:** **BUILT** = implemented in `emerge/lang/ledger.js` and the runtime, with tests. A tag in parentheses after a heading records what was done and where it departs from the text.

**Status tags:** **DECIDED** = you said so. **ADOPTED** = proposed in discussion, accepted by moving on. **PROPOSED** = my recommendation, needs your yes. **OPEN** = a question only you can answer.

**Revision v0.3.1:** added section 0 (Purpose). The self-hosted executable is now named `emerge.exe` (it was `eg.exe`); the command-line tool is still called `eg`.

---

## 0. Purpose **DECIDED**

Emerge is the author's own: the language, the compiler, the runtime and the toolchain, owned end to end. CIE-EG exists to make **`emerge.exe` replace `node.exe`**. The component registry, the interaction contract and the event gate become the runtime that hosts every system, in place of Node.

1. **End state.** `emerge.exe` is one self-hosted executable. It compiles itself (section 10). The finished system has no Node, no npm and no JavaScript in it.
2. **Outside dependencies.** The operating system only: file I/O, memory and exit from `kernel32`, and the OS crypto library (10.2). Nothing else is borrowed.
3. **Systems are built from Emerge.** A system is written as components, registered in the component registry, connected by roads in the contract, run by the gate, and recorded on the ledger. Systems never reach each other by importing code or by calling over a network. They are reached only through the registry and the gate (principle 1).
4. **Node is scaffolding at most.** The existing Node interpreter may run once to produce the first `emerge.exe` (10.1, stage 0) and is then retired. It is not part of the finished system.

**Consequences for the rest of this spec** **PROPOSED**

- A feature that only makes sense inside Node is out of scope.
- Anything added to the Node runtime in the meantime is temporary. It is worth adding only if it can be written again in `.eg` and run by `emerge.exe` unchanged.
- The ledger format is fixed before the native runtime is written, so it is ported once, not twice. This covers the causal-parent field (13.8).

---

## 1. Principles

1. **Components are isolated.** They never reference each other. They are known by id in the registry and reached only through the gate. **DECIDED**
2. **Nothing fails silently.** Every refusal, mismatch, or failure becomes a typed `gap` entry in the ledger. **DECIDED**
3. **Interpretation is by context.** A symbol keeps its identity, code point, and numeric value as properties. Which one applies is declared by the contract at each hook, never guessed. **DECIDED**
4. **Own the model, not the byte encoding.** UTF-8 at every boundary. Emerge defines the symbol model, normalization, and error rules on top. **ADOPTED**
5. **No invented cryptography.** SHA-256 for chaining, AES-256-GCM for sealing, both from the OS or CPU. Emerge designs the structure around them, not the primitives. **DECIDED**
6. **UUIDs name, hashes prove.** Identity is a derived name. Integrity is the full 256-bit hash. **ADOPTED**

---

## 2. Text model

### 2.1 Encoding **ADOPTED**

- Source files, ledger bytes, hashes, keys, and external exports are UTF-8. No byte-order mark.
- Strings are sequences of Unicode code points. `len(s)` counts code points. `byte_len(s)` is a separate function.
- UTF-16 appears nowhere. Lone surrogates are not valid text.

### 2.2 Strict decoding **ADOPTED**

Invalid UTF-8 never becomes a replacement character. The `text` component refuses it and the gate records a gap: type `structural`, pressure 0.95, with the byte offset of the first bad byte.

### 2.3 Normalization **PROPOSED**

- Any text that is hashed, used as an id, or placed in a ledger body must be NFC.
- The gate does **not** normalize silently, since that would be a hidden change. Non-NFC input is refused with a gap (`structural`, 0.5). The `text` component offers an explicit `normalize` hook for callers who want it.
- Implementing NFC needs Unicode composition tables. **OPEN:** build the tables in `.eg`, or limit hashed text to a stated subset at first (ASCII identifiers are trivially NFC).

### 2.4 Identifiers **PROPOSED**

Component ids, hook names, namespaces, and contract ids use only `[A-Za-z0-9_]` segments joined by `.`, each segment starting with a letter or `_`. This blocks lookalike characters (Cyrillic `а` versus Latin `a`) and zero-width characters from ever entering the registry. Ordinary string values remain full Unicode.

### 2.5 Symbol properties and interpretation **DECIDED**

Every character exposes properties through builtins, taken from Unicode data: `code(ch)`, `category(ch)`, `digit_value(ch)`. Example: `1` has code 49, category decimal-digit, digit value 1.

Interpretation rules:

- The **type declared at a hook** decides interpretation: `string` is text, `num` or `int` is a number.
- Conversion is always explicit: `num("1")`, `str(1)`. The gate never converts.
- A value of the wrong interpretation at a hook is refused with a gap: type `contextual`, pressure 0.7.
- `+` never turns text into a number. `"1" + 1` is a runtime error, as it is today.

---

## 3. Numbers and bytes **DECIDED**

Emerge has one numeric type today, a 64-bit float. SHA-256, AES-GCM framing, and the PE writer need exact integers and bit operations.

**Proposal:**

- `int`: 64-bit signed, literal `42i`. **Built (v0.2).** Overflow is an error, not a wrap. The explicit wrapping family is `wrap_add`, `wrap_sub`, `wrap_mul` (functions, not operators). `int / int` is refused: use `idiv`.
- `bytes` (built): an immutable byte sequence with `len`, `slice`, `concat`, and indexing returning `int`.
- Bitwise `&  |  ^  ~  <<  >>`, `shr_u` (logical shift) and `rotl`/`rotr` work on 64-bit `int` (built); on `num` they remain 32-bit words.
- `num` (IEEE double) remains for fractions. No implicit int/num mixing: `int(x)` and `num(x)` are explicit, and a mix is a runtime error. (The spec says `float`; the language keeps its existing name `num`, and `float` is an alias in annotations.)
- Canonical form (4.3) rejects NaN and infinity, and writes -0 as 0.

SHA-256 stays a runtime builtin for now (no invented crypto, principle 5); a pure-`.eg` SHA-256 is now possible but not required.

---

## 4. Ledger

### 4.1 Entry **BUILT**

Fields: `seq` (from 1), `kind`, `body`, `prev` (hash of the previous entry), `hash`. Append-only. **DECIDED**

### 4.2 Hash input **BUILT**

SHA-256 over length-prefixed fields, so no two different entries can produce the same input bytes by shifting a boundary:

```
tag     = "eg.ledger.entry.v1" 0x00        (domain separation)
input   = tag || prev (32 bytes) || seq (u64, big-endian)
          || len(kind) (u32) || kind || len(body) (u32) || canonical(body)
hash    = SHA-256(input)
```

The genesis entry has `prev` = 32 zero bytes. In the file and in `ledger()` hashes are 64 lowercase hex digits; the bytes are what is hashed.

*Built:* verified against a separate Python implementation (known-answer vectors in `lang/test/ledger.test.js`). Different record families (entry, checkpoint, registry, contract) use different tags.

### 4.3 Canonical form (ECF) **BUILT**

One byte sequence per value: UTF-8, strings NFC, no whitespace, map keys sorted by raw byte order, integers in plain decimal, non-integers as the shortest decimal that round-trips, `null`/`true`/`false` lowercase. NaN, infinity, and non-data values (fns, compartments) are rejected and recorded as a gap.

*Built:* rejection is a runtime error today; recording it as a `structural` gap comes with the gate. Two choices the text left open: strings use minimal JSON escapes (`\"` `\\` `\b \f \n \r \t`, other C0 controls as `\u00xx`), and a number that is not an integer below 2^53 is written in ECMAScript's shortest round-trip form. A self-hosted `emerge.exe` must reproduce that form (Ryu or Grisu). An `int` and a `num` of the same value write the same bytes, so the ledger does not record which type a value had.

### 4.4 Verify **BUILT**

`Verify()` recomputes every hash and checks every `prev` link and `seq`. Any edit, deletion, or reordering fails it.

*Built:* it also checks each checkpoint against the chain it sits in (head, entry count, gap count, Merkle root). `ledger_verify(seq)` verifies from a checkpoint. A truncated tail still verifies, since a chain cannot prove that nothing follows. The latest checkpoint's head and count are what notice a truncation, once the ledger is on disk. `Gaps()` lists every entry of kind `gap`.

### 4.5 Entry kinds

| Kind | Written when |
| --- | --- |
| `genesis` | A chain begins. Commits to the boot record (section 7). *Built with seed, version, chain id and text settings; manifest root, builder, contract hash and registry hash wait for the boot chain (7).* |
| `boot` | Every later start. Links to the previous run’s head. |
| `register` | A component registers. *Built (the runtime's former `component` entry).* |
| `deliver` | The gate delivers an event along a road. |
| `gap` | Any check fails (section 6.3). |
| `gap.ack`, `gap.close` | A gap is acknowledged or closed (section 6.4). |
| `transition` | A compartment commits a state change. |
| `rejected` | A transition is refused by a hard constraint. |
| `checkpoint` | Micro-snapshot (4.6). *Built.* |
| `rekey` | A sealing key is rotated (section 8.5). |
| `record` | A program writes a record explicitly. |

### 4.6 Checkpoints and micro-snapshots **BUILT** (partly)

A `checkpoint` entry is written every N entries (default 256, set in `core/primitives.eg`), at boot, at rekey, and at clean shutdown. Body:

- `head`: the chain head hash
- `entries` and `gaps`: running counts
- `digests`: a map of component id to the SHA-256 of that component’s canonical state
- `root`: a Merkle root over the entries since the previous checkpoint. A leaf is SHA-256(`0x00` ‖ entry hash), a node is SHA-256(`0x01` ‖ left ‖ right), an odd node is carried up unchanged rather than duplicated, and an empty range has the root SHA-256(`"eg.merkle.empty.v1"`).

*Built:* checkpoints at the interval and at clean shutdown; `registry_hash` (5.3) is not in the body yet, and boot and rekey checkpoints wait for their entries. `ledger_proof(seq)` and `ledger_check_proof` prove an entry belongs under its checkpoint.

Uses: verify from the last checkpoint instead of from the start, prove one entry belongs to the ledger, show which component’s state changed, and anchor `whatif` and replay. A checkpoint can optionally carry the full sealed state, making it a restorable snapshot.

### 4.7 Dedup **OPEN**

Cobalt counts repeated events instead of storing copies. That conflicts with an exact, replayable history. **Proposal:** chain every event; keep the repeat count as a separate index, or write periodic `count` entries. Do you want dedup at all?

### 4.8 Persistence and crash recovery **PROPOSED**

- File format: a sequence of records, each `u32 length || entry bytes`.
- Write policy: an entry is flushed to disk before the gate reports its event as delivered.
- On open, if the last record is incomplete, truncate it and write a `gap` (`structural`, 0.6, “torn tail recovered”). Recovery is never silent.
- If the ledger cannot be written (disk full, key missing), the gate **halts** and says so. It never continues unrecorded.

### 4.9 Time **PROPOSED**

The ledger has no hidden clock. Time enters only as data from a registered `clock` component whose events pass the gate like any other. Hashes therefore never depend on an unrecorded outside value.

---

## 5. Component registry (C)

### 5.1 Record **ADOPTED**

| Field | Rule |
| --- | --- |
| `id` | Unique, identifier charset (2.4). |
| `namespace` | Identifier charset. |
| `name` | Display name. |
| `version` | Semver `major.minor.patch`, optional pre-release and build. |
| `uuid` | Derived (section 9). |
| `hooks` | Map of hook name to `{dir: in or out, shape}`. |
| `shape_hash` | SHA-256 of the canonical form of all hooks and shapes. |

Registering writes a `register` entry. A duplicate id is refused with a gap. A malformed record is refused with a gap.

### 5.2 Isolation **DECIDED**

A component’s state is private. Another component cannot read it, call it, or hold a reference to it. The only entry point is its `in` hook, invoked by the gate. The registry holds components; it does not give them to each other.

### 5.3 Registry hash

The registry hash is SHA-256 over the sorted list of `(id, version, uuid, shape_hash)`. It is recorded in the genesis and in every checkpoint.

---

## 6. Interaction contract (I) and event gate (E)

### 6.1 Contract format **PROPOSED**

A contract is declared in Emerge’s own syntax, as data:

```
contract emerge_main {
  version = "1.0.0"
  text   { encoding = "utf-8"  normalization = "nfc" }
  gate   { block_at = 0.9  max_steps = 100000  checkpoint_every = 256 }
  road Counter.changed -> Display.show
}
```

- A `road` is the only way an event can travel, from one out hook to one in hook. The existing `wire` statement is the same thing and compiles to a road.
- Hook shapes live on the components: `out changed: { count: int, label: string }`.
- The `contract_hash` is SHA-256 over the canonical contract. It goes into the genesis and every checkpoint.
- Changing a contract changes its version and hash. An old ledger stays verifiable against the contract it recorded.

### 6.2 Gate pipeline **ADOPTED**

Every event goes through the same steps, in order. The first failure stops the event and writes a gap.

1. The source is a registered out hook.
2. The payload is valid text (2.2) and NFC where required (2.3).
3. The payload fits the source hook’s shape, with the declared interpretation of each field.
4. The contract has at least one road from this hook.
5. For each road: the destination is a registered in hook, and the payload fits its shape.
6. Write a `deliver` entry, then call the destination.
7. If delivery fails, write a gap. Other roads still run.

Events raised during delivery wait in a first-in-first-out queue. Past `max_steps` deliveries in one drain, the gate stops and records a storm gap.

### 6.3 Gap types and pressures **PROPOSED**

Gap types are the eight in `primitives.eg`: logical, evidential, temporal, assumption, contradiction, structural, contextual, causal. Pressure is in \[0, 1\].

| Failure | Type | Pressure |
| --- | --- | --- |
| Unregistered source hook | structural | 0.9 |
| No road leaves the hook | structural | 0.6 |
| Road ends at no registered in hook | structural | 0.9 |
| Payload breaks a shape | contradiction | 0.8 |
| Wrong interpretation (text where num is declared) | contextual | 0.7 |
| Delivery failed | causal | 0.7 |
| Malformed UTF-8 | structural | 0.95 |
| Non-NFC text | structural | 0.5 |
| Signal storm | structural | 1.0 |
| Key missing or unreadable | evidential | 0.9 |
| Boot verification failed | contradiction | 1.0 |

A gap body holds: `type`, `message`, `pressure`, the `from` and `to` endpoints, and the hash of the refused event, so the refusal itself is provable and cannot be swapped for another event later.

### 6.4 Gap lifecycle **PROPOSED**

`open` → `acknowledged` → `closed`, each step a ledger entry (`gap`, `gap.ack`, `gap.close`) referencing the gap’s hash with a reason. Gaps are never deleted. A gap at or above `block_at` closes its road: the gate refuses further events on it until the gap is closed.

---

## 7. Boot hash chain **ADOPTED**

The genesis entry commits to everything the run depends on:

- `manifest_root`: Merkle root of the SHA-256 of every core file (Cobalt’s sealed manifest, made into one hash)
- `builder`: hash of the compiler that produced this `emerge.exe`
- `contract_hash` and `registry_hash`
- `chain_id`: the chain’s UUID
- `text` settings: encoding and normalization

Each later start writes a `boot` entry with `prev` equal to the previous run’s head. One ledger therefore spans runs, and “this history came from exactly this code under exactly this contract” can be checked.

At boot the system recomputes the manifest root. On mismatch it writes a gap (`contradiction`, 1.0) and refuses to continue. It never starts quietly.

Cobalt’s own gaps that this fixes: its ledger hashes are not chained, the payload is cut at 200 characters, the digest is truncated to 64 bits, and the manifest has no root.

---

## 8. Sealing: AES-256-GCM **DECIDED** (details PROPOSED)

### 8.1 What it covers

GCM protects each entry’s contents and detects tampering with that entry. The hash chain protects order and completeness. Both are required, since GCM alone cannot see a deleted or swapped entry.

### 8.2 Layout

- **AAD (authenticated, readable):** `seq`, `kind`, `prev`, and for gaps the `type`, `pressure`, and endpoints. This binds an entry to its position and lets anyone list and sort gaps without the key.
- **Ciphertext:** the canonical body.
- **Chain hash:** computed over the ciphertext, so the chain verifies without any key.

### 8.3 Nonce

96 bits: 4 bytes from the chain id hash, then `seq` as 64-bit big-endian. Unique by construction. A nonce must never repeat under one key, since repetition breaks GCM.

### 8.4 Keys **OPEN**

- A root key derives one key per component with HKDF-SHA-256, using the component uuid as context. A component can decrypt only its own entries.
- The root key is released only if the genesis verifies, so altered code cannot open the ledger.
- **Question for you:** where does the root key live, and what happens if it is lost? (OS credential store, a file, a passphrase, hardware token.)

### 8.5 Rotation

Rotating a key writes a `rekey` entry into the chain. Old entries stay readable under their old key id, and the change is on the record.

### 8.6 Implementation rule

No hand-written AES. Use the CPU’s AES-NI and carry-less multiply instructions, or the Windows crypto library. Software table AES leaks through timing.

---

## 9. Identity

- **Component uuid** = first 128 bits of SHA-256(`"eg.component.v1" 0x00 namespace "/" id "@" version`). The same component always gets the same uuid. Shape changes are caught by `shape_hash`, so the uuid stays stable.
- **Chain id** = a UUID written in the genesis, used in nonces.
- **Entry identity** = its hash. No separate entry id.
- **Layout OPEN:** standard 8-4-4-4-12 form with version and variant bits set, or the current `emerge-component-` prefix form. *Built for the chain id only:* the standard form, version 8 and variant 10, derived from SHA-256(`"eg.chain.v1"` 0x00 seed " " version) so two runs from one seed and build agree.

---

## 10. Build and bootstrap

### 10.1 Stages **OPEN**

1. **Stage 0:** your existing Node interpreter, used once and then retired. It runs the `.eg` compiler to emit the first `emerge.exe`.
2. **Stage 1:** the compiler, written in Emerge: lexer, parser, checker, code generator.
3. **Stage 2 (self-host):** `emerge.exe` compiles the compiler’s own source. The check is reproducibility: the stage-1 and stage-2 outputs must be byte-identical.

**Question for you:** is Node acceptable as the throwaway stage 0?

### 10.2 Backend

An x86-64 encoder and a Windows PE writer, both in `.eg`. The only outside dependencies are the OS: `kernel32` (file I/O, memory, exit) and the OS crypto library.

### 10.3 First milestone

A tiny `.eg` program that emits a valid PE file which runs and prints a line. This proves the path before anything else rests on it.

---

## 11. Acceptance tests

1. Edit one ledger byte. `Verify()` fails.
2. Delete or reorder an entry. `Verify()` fails.
3. Emit from an unregistered hook. A gap appears. Nothing is delivered.
4. Emit with no road. A gap appears.
5. Send `"1"` where the contract says `int`. A `contextual` gap appears. Nothing converts.
6. Feed invalid UTF-8. A gap appears with the byte offset. No � character is produced.
7. Truncate the ledger mid-record. Reopening writes a torn-tail gap and continues.
8. Alter a core file. Boot refuses and records a gap.
9. Move a sealed entry to another position. GCM authentication fails.
10. Register two components with the same id. The second is refused with a gap.
11. Rebuild the compiler with itself. The output is byte-identical.

---

## 13. Observation **PROPOSED** (built: `emerge/observe/`)

The ledger read as a field. `observe(entries)` is a pure function of a verified chain and of `primitives.observe`; a report is a reading and is never written back. Time is the `seq` (4.9); no wall clock is read.

1. **Entry reading.** An entry is "about" a key (`kind|compartment-or-name|signal, constraint, message, path or wire ends`). Entries the observer itself caused (a gap with `source: "observe"`, an `unrouted` for a runtime notification signal) are left out of every measurement and stay in the gap inventory, so no reading can feed on itself.
2. **Deltas (RFR2).** S: z-score of the tick gap since the previous entry of the same key (spread floored at one tick; signed z kept). K: change in the share of stress entries between two consecutive windows. C (causal depth) is `null` until entries carry a causal parent. Not measured is `null`/`measured: false`, never 0.
3. **Sigma regime.** `insufficient_data > collapsing (K) > oscillatory (O) > degraded (S) > stable`. Thresholds in primitives. A stable window has no dominant cause.
4. **CFR field.** coherence, friction, resonance, entropy in 0..1; per-kind nudges, damping toward neutral, gap nudges scaled by pressure, deviation adds entropy and friction. Resonance rises only when a stress entry repeats a recent key. Regimes: stable, resonant, turbulent, chaotic.
5. **Liminal.** Constitutional threshold (bounced, absorbed, dissolved), velocity field (runaway is an early warning before the `max_deliveries` storm), coherence surface (one signal both accepted and refused), root terminus (aborted, unrouted). Crystals need `min_count` and `min_confidence`; they are suggestions only.
6. **Gap hunter.** A proposal needs an evidence object. Batch confidence is the minimum, not the mean. One condition has one dedup key; repeats raise `occurrences` (this is the answer proposed for 4.7: exact history stays chained, the count is an index). A gap closes on a `gap.close` entry naming it, or when its predicate is false and an artifact entry proves it. Tension (pressure, age, repeats) only raises severity and is compared with `block_at`; closing a road is the gate's act (6.4).
7. **Builtins.** `observe()` reads; refuses an unverifiable ledger. `observe_gaps()` passes proposals through the gate as `gap` entries carrying `source`, `dedup_key`, `evidence`; refused in a lens; a second call opens none.

All numbers are tunables carried over from the intelligence system's CFR, RFR2, liminal and gap work by analogy, not measurements.


### 13.7 Debugging a run **PROPOSED** (built: `emerge/observe/debug.js`, `eg debug`, `ledger_why`)

CFR debugged with a causal graph and a replay stream; RFR2 with bounded, verifiable clips. Entries carry no causal parent, so every causal edge here is **inferred** from structure and labelled (`via`): state lineage (a null field → the entry that last set it, or the declaration), the previous entry with the same signal, the reading an observe gap was opened from, the gap a `gap.close` names. Nothing is written to the ledger.

- `why(seq)`: the chain back from an entry to what explains it; `at(seq)`: state of every compartment, open gaps, field and sigma as they stood after that entry (a verified prefix is itself a valid chain); `follow`: entries about one compartment, signal or kind; `diff(a, b)`: the first entry whose hash differs (equal hashes prove an equal past) with state either side; `blame`: the first struggle and the first turbulent or chaotic field, each with its `why`; `clip(from, to)`: a slice anchored by the hash before it and its own head, re-verifiable alone and against a whole ledger.
- `eg debug <ledger.json> blame | why N | at N | follow | diff F | clip A B | verify-clip | report`. Ledger files are read so that integers beyond 2^53 stay exact; a ledger that does not verify is refused.
- `ledger_why(n)` is the same `why`, from inside the program.
- Once entries carry a real causal parent, `edges()` is replaced by it and `structuralDeviation` (13.2) can be measured; the commands do not change.

---

## 12. Open decisions, in priority order

1. Node as stage 0? (10.1)
2. ~~Add `int`, `bytes`, and bitwise operators~~ **Decided: real 64-bit `int` added.** (3)
3. Root key storage and loss policy. (8.4)
4. Keep Cobalt-style dedup? (4.7)
5. NFC tables in `.eg`, or a restricted subset first? (2.3)
6. UUID layout: standard form or prefix form? (9)
7. Contract syntax: new `contract` block as proposed, or reuse `wire` only? (6.1)
