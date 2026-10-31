# Learn Emerge

James Brooks, 2026-10-30: *"i also, for other people. want a fully, enterprise grade, systems thinking, level tutorial and
user documantation, for any comprehention level, from kids learning to code, to senior systems engineers or experts at
their field. as simple as possible, but the highest amount of leverage. Find that slope, and make it steep."*

Emerge is his: the language, its architecture (CIE-EG) and its direction. The wording of these lessons, and the one
sentence below, are the coder's summary of his design. Made for its author first (2026-10-31: *"it's meant for me. To
make coding easy for me using my own language. Ai is additive."*), shared here for everyone else.

**Emerge in one sentence:** things that never touch, talking only through a gate, and everything that happens written
down where it can't be erased.

That one sentence is the whole language. Every level below is the same sentence, seen closer.

| Level | For | You will be able to | Time |
|---|---|---|---|
| [0 · The idea](learn/0-the-idea.md) | Anyone, from age 8 | Explain how Emerge thinks, with no code | 5 min |
| [1 · First words](learn/1-first-words.md) | First time coding | Print, name things, make recipes, repeat | 15 min |
| [2 · Things that remember](learn/2-things-that-remember.md) | Beginners | Build a thing with memory and a rule it can never break | 20 min |
| [2½ · Say it in your words](learn/2s-say-it.md) | Anyone | Write a working program by saying it in plain words, with no syntax and no AI | 10 min |
| [3 · Parts that never touch](learn/3-parts-that-never-touch.md) | Programmers | Join parts by wires, with shapes checked before anything runs | 30 min |
| [4 · Truth and gaps](learn/4-truth-and-gaps.md) | Engineers | Prove a history, name what is missing, try futures without risk | 30 min |
| [5 · Systems](learn/5-systems.md) | Systems engineers | Define kinds, spawn parts from templates, read a system as stocks, flows and feedback | 45 min |
| [6 · The core](learn/6-the-core.md) | Experts | Read the ledger's bytes, the architecture (CIE-EG), the native compiler, and change the language itself | as long as you like |

**Words:** [every word, said plainly and said exactly](learn/words.md).
**Reference:** [`emerge/lang/README.md`](../emerge/lang/README.md) (the whole language) · [`emerge/lang/MAP.md`](../emerge/lang/MAP.md)
(every keyword and builtin, generated from the source) · [`CIE-EG_Specification_v0_3_1.md`](../CIE-EG_Specification_v0_3_1.md)
(the architecture).

## Run the examples

You need [Node.js](https://nodejs.org) 18 or newer. Nothing else.

```
cd emerge
node lang/eg.js run ../docs/learn/examples/1-hello.eg
```

## These docs are tested

Every program in `learn/examples/` is run by `node docs/learn/verify.js`, once interpreted and once compiled, and both
must print exactly what its `.out` file says. Every `.say` sentence must still make `eg say` write exactly the files the
lesson shows. If the language changes and a lesson stops being true, that check fails. CI runs it on every push.
