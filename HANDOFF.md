# Handoff — 2026-10-31 (later): Emerge is a system

His words: "emerge needs either to be a module for idearium, or a system with a server.js, etc. look at the genesis and architecture spec
in idearium. needs to be one" · "okay. do it as long as it gets up closer to building large projects, like i want to be buyilding an
operating systems"

Branch `claude/emerge-as-a-system` (this repo) and Nexus `claude/emerge-as-a-system` (0.60.336). Spec: Nexus `docs/emerge-system.spec`;
map: Nexus `docs/2026-10-31-emerge-as-a-system-phasemap.spec`.

| Phase | State | Where |
|---|---|---|
| EAS_D0 a system, not an Idearium module | decided by his axioms (§5.15 r2, r3; §3.1; §5.9) | the map |
| EAS1 genesis skeleton in `emerge/` | built `19200ff` | `server.js` :4900, `cli.js`, `lib/system.js`; shared paths renamed: `ide-registry.js`, `ide-contract.json`, `events-compiler.js`, `schemas/records/` |
| EAS1a boundary reads code, not text | built (Nexus archetype) | Nexus `cos/archetype/nexus-system/lib/boundary.js` |
| EAS2 the language through the door | built `8ca9aa3`, 1.13.0 | `lib/lang.js`; POST `/lang/check`, `/run`, `/test`, `/build`, `/say`, `/synth`; `node cli.js lang-<verb>` |
| EAS5 a system of systems | built `58a12d8` | `tests/nesting.test.js`: emerge → os → kernel → scheduler (code in Emerge); shell → kernel → scheduler by handoff |
| EAS3 one Emerge at Nexus's top level, locked | open | EAS_D1 **to confirm with him** (his MG28: "copy every file you need to a cos/dependancies folder") |
| EAS4 lib/emerge's 25 callers through the door; lib/emerge archived | open | guardian t2-gate, idearium compiler-bridge, copilot module-builder, cortex contract-intake, lib/hooks/emerge.hooks.js, build-time scripts |

Tests: `cd emerge && npm run test:system` (skeleton, lang-door 8/8, nesting 5/5), in CI.

Next, for building large projects in Emerge (his goal):
1. **An install command** (`emerge.lang.install`): build Emerge through the door into a module of the tree, with its component,
   capability, command, route and event nodes. Today the nesting test does it by hand (the built files plus a three-line adapter).
2. **EAS3, then EAS4** in Nexus, after his answer on EAS_D1.
3. The list below (the Nexus bridge, his vocabulary, split-on-struggle, the Guardian lifeline) still stands; the bridge now goes through
   Emerge's door instead of `eg build --standalone` by hand.

Found on Windows, not from this work: Nexus `tests/modules/test-system-skeleton.test.js` crashes on `import()` of an absolute `D:` path;
SS-02 fails on a CRLF checkout (its patterns expect LF).

---

# Handoff — 2026-10-31

For the next session. Read this, then `emerge/spec/cie-eg.spec` section 0 (his purpose), then the spec of whatever you touch.

## His direction (in his words)

- "Also it's meant for me. To make coding easy for me using my own language. Ai is additive. Also it's working towards
  removing the dependency of ai."
- "im trying to remove as much friction from me and the code as possibel"
- "only using hardcoded when neccarry, using external node files for data, options, etc."
- "i just want to speed this up, so i can start coding with it, and use it for neuxs"

## Where things are

| What | Where | State |
|---|---|---|
| Emerge, default branch | `HorrisEllis/Emerge` `claude/determined-meitner-93l5ue` | 1.12.0, CI green (Linux + Windows, Node 18/22) |
| `eg say` (his words → code, no AI) | `emerge/lang/say/`, spec `emerge/spec/say.spec` | 28 words, node files, `say.test.js` 16/16 |
| `eg learn` (lessons that break down) | `emerge/lang/learn/`, spec `emerge/spec/learn.spec` | `learn.test.js` 6/6; levers in `learn.node` |
| Node files in the language | `use "./x.node" as node` (`lang/runtime.js` rt.use) | run, check, build; native refuses by name |
| Tutorial | `docs/learn/` (levels 0–6, 2½ "Say it in your words") | `node docs/learn/verify.js` 7/7, in CI |
| Fractional nums, native | `emerge/lang/native/rt.eg` | F1–F4 built; F5 (`**` with a fraction, fdlibm pow) open |
| Chunk benchmark | `bench/chunks.js`, `bench/chunks/utf8_decode/` | his run: 7B solves one-rule units, breaks on multi-rule ones |
| His credit and record | `HorrisEllis/Nexus`: `docs/JAMES-BROOKS.md`, `docs/his-words/`, `docs/PROOF-OF-COMPETENCY.md` | proof entries for 2026-10-31 on branch `claude/determined-meitner-93l5ue` (not yet in Nexus `main`) |

## Landed in parallel (another session, same branch, pushed while this one ran)

- `1cb2d7d` **synth.eg: code generation with no model — utf8_decode 6/6, deterministic.** The task the 7B model failed (0/3)
  is solved with no model at all. Read it before building the split-on-struggle step or the Guardian lifeline: those may now
  be the fallback behind synth, not the plan.
- spec 16 (the loop, one atom at every zoom; LP-05..LP-08), bench with Python beside Emerge and JavaScript and real
  tokenizers (eg 356 / js 436 / py 355 tokens), and a finding: native for-over-string is quadratic.

## Next, in his order of value

1. **The Nexus bridge** (recommended first). One small, real Nexus piece (a system's door or a gate) written with `eg say`,
   built with `eg build --standalone`, required by Nexus, with its own test. Then every piece can move the same way.
2. **His vocabulary, grown from his record.** `docs/his-words/` in Nexus holds his words with their meaning; add the 30–50 he
   uses most for Nexus work (door, gate, hat, spine, template, route) to `emerge/lang/say/words.eg`, each with its quote.
3. **Split on struggle** in `bench/chunks.js`: a unit that fails twice is split along its declared invariants. First ask him
   for `units[].error` from his results file (it settles whether the 7B's failures are syntax slips or wrong rules).
4. **The Guardian lifeline** (later, additive): a unit the local model cannot do goes to a browser agent through Guardian;
   it counts only if the checker and tests pass; the answer is crystallized so the gap never needs a model again.
   Read Guardian's current interface in Nexus before designing it.

## Open, his to decide

- `eg say` word mappings are the coder's reading of his meanings (marked "to confirm" in `say.spec`).
- The three personal poems of the toolkit are held back by his rule (evidence only, identity stripped); he can overrule.
- D5 (text tables) governs native `upper` / `lower`.
- Whether the beginner lessons (levels 1–5) should use node files from the first example.
