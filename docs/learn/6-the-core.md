# 6 · The core

**For:** experts. You know [levels 1 to 5](5-systems.md), or you want the architecture first.

## The idea in one line

The same sentence, in bytes: **C**omponent registry, **I**nteraction contract, **E**vent **G**ate, and a ledger that
records gaps (CIE-EG). [`CIE-EG_Specification_v0_3_1.md`](../../CIE-EG_Specification_v0_3_1.md) is the contract; each
section carries its status (BUILT, DECIDED, ADOPTED, PROPOSED, OPEN).

## The architecture

| Part | What it is | Spec |
|---|---|---|
| **C** · component registry | `{id, namespace, name, version, uuid, hooks, shape_hash}`. A duplicate or malformed record is refused with a gap. A component's state is private: the registry holds components, it never hands them to each other. | §5 |
| **I** · interaction contract | `road` from one out hook to one in hook is the only way an event travels (`wire` compiles to a road). The contract has a version and a hash. | §6.1 |
| **E** · event gate | Every event, in order: source is a registered out hook → valid text → fits the source shape → a road exists → each destination is registered and the payload fits → write `deliver`, then call. The first failure stops the event and writes a typed gap. | §6.2 |
| **G** · gaps | Eight types, each with a pressure in [0, 1]. open → acknowledged → closed, each a ledger entry. A gap at or above `block_at` closes its road until it is closed. | §6.3–6.4 |
| Ledger | Append-only, hash-chained, checkpointed, Merkle-provable. | §4 |

## The ledger, byte by byte (§4.2, built)

```
tag   = "eg.ledger.entry.v1" 0x00
input = tag || prev (32 bytes) || seq (u64 big-endian)
        || len(kind) (u32) || kind || len(body) (u32) || canonical(body)
hash  = SHA-256(input)
```

- Length prefixes mean no two different entries can produce the same bytes by moving a boundary. The tag separates entry
  hashes from checkpoint, registry and contract hashes.
- `canonical(body)` (ECF, §4.3): UTF-8, no whitespace, map keys in raw byte order, integers in plain decimal, `-0` as
  `0`; NaN, infinity, non-NFC text and lone surrogates are refused, never silently fixed.
- Built against known-answer vectors from a separate Python implementation (`lang/test/ledger.test.js`).
- `ledger_verify()` checks every hash, link and seq, and each checkpoint's head, counts and Merkle root;
  `ledger_verify(seq)` verifies from a checkpoint; `ledger_proof(seq)` gives an entry's Merkle path.

## What is Emerge's own, and what is borrowed

Emerge designs the **structure**. It borrows **primitives** where building your own would be unsafe or pointless:

| Borrowed, on purpose | Why |
|---|---|
| SHA-256, AES-256-GCM, HKDF-SHA-256, the OS random source | Hand-made cryptography fails in ways tests don't catch (§1, principle 5: "no invented cryptography"). AES must use AES-NI or the OS library, never software tables, which leak timing (§8.6). |
| UTF-8, Unicode data (NFC, categories) | Text has to mean the same thing everywhere. |
| IEEE-754 doubles, 64-bit two's-complement ints | The hardware's arithmetic. |
| x86-64, ELF, Windows PE | Set by the CPU and the OS. The encoder and the writers (`x64.eg`, `elf.eg`, `pe.eg`) are written in Emerge. |

Everything else is Emerge's: the architecture (C, I, E, G), gaps with types and pressure, the ledger's layout, ECF, the
boot chain (§7: the genesis commits to the manifest root, the compiler, the contract and the registry), derived
identity (§9), the language, the observation layer (§13: deltas, sigma, the CFR field, liminal space, the gap hunter),
and the toolchain.

**An open question in that design (§8.3):** the AES-GCM nonce is 4 bytes of the chain id's hash plus the 64-bit `seq`.
A nonce must never repeat under one key. With only 4 bytes (32 bits) from the chain id, two chains under one key share a
prefix by the birthday bound: the odds reach one in two at about 77,000 chains, and are already about one in a hundred
at 9,300. Deriving one key per chain with HKDF (as §8.4 already does per component) removes the risk.

## The compiler compiles itself (§10)

`lang/native/` is the native compiler, written in Emerge: lexer and parser (`front.eg`), code generator (`codegen.eg`),
runtime (`rt.eg`), x86-64 encoder, ELF and PE writers. Node ran it once (stage 0). On Linux x86-64 it rebuilds itself:

```
cd emerge/lang/native
./bin/emerge emerge.eg -o bin/emerge        # stage 2 must equal stage 1, byte for byte
```

`lang/test/selfhost.test.js` checks the three stages; `lang/test/native.test.js` runs 72 programs both ways. The end
state (§0): `emerge.exe` replaces `node.exe`, with no Node, npm or JavaScript in the finished system.

## Change the language itself

The rules and the standard library are Emerge source in `lang/core/`: `primitives.eg` (constraint and gap types,
pressures, the checkpoint interval, strict conditions …), `prelude.eg` (map, filter, reduce …), `selftest.eg`.

```
edit lang/core/primitives.eg
node lang/eg.js bootstrap           # quarantine → prove → integrate
node lang/eg.js bootstrap --rollback
```

Quarantine evaluates the primitives as data only and compiles the prelude without itself. Prove requires the selftest and
every example to give identical output and ledger in both backends. Only then does the new build become current; a
failed candidate stays in `build/next` for you to inspect.

## Verify everything yourself

```
cd emerge
npm run test:lang                    # language, differential, bootstrap, IDE, ledger, native, self-host
node ../docs/learn/verify.js         # every lesson program, interpreted and compiled
```

## Where to go next

- [`emerge/lang/README.md`](../../emerge/lang/README.md): the whole language, with every statement and builtin.
- [`emerge/lang/MAP.md`](../../emerge/lang/MAP.md): every keyword, type and builtin, generated from the source.
- [`BUILDING.md`](../../BUILDING.md): build any project from its `.spec`.
- CIE-EG §12: the open decisions, in priority order.
