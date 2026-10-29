# Building from Emerge

Emerge is its own project and the foundation every other project is built from. It depends on nothing above it
(`cie-eg.spec`, section 0, *foundation*). A project's integrations live in that project's own repo.

## The native compiler: no Node

Emerge's compiler is written in Emerge and builds itself (`cie-eg.spec`, section 10). On Linux x86-64:

```
emerge/lang/native/bin/emerge program.eg -o program          # compile any program in the native subset; run ./program
cd emerge/lang/native && ./bin/emerge emerge.eg -o bin/emerge  # the compiler rebuilds itself, byte for byte
```

Node was used once, as stage 0, to make that binary. `lang/test/selfhost.test.js` checks that stage 0 still produces
exactly the committed binary and that it reproduces itself. What still runs on Node, and the order it is being moved to
Emerge, is the build plan in `cie-eg.spec` (`native_lang`, `native_system`, `native_tools`, `native_windows`).

## Build any project from its spec

```
cd emerge
npm install                                              # once
node build-spec.js path/to/project.spec --dry-run         # the plan and open decisions; writes nothing
node build-spec.js path/to/project.spec                   # scaffolds + a build record in <root>/.emerge/build/
node build-spec.js path/to/project.spec --build           # then a local model writes each ready module
```

- **Build root:** `--out`, else the spec's `meta.build_root` (relative to the spec file), else the current folder.
- **Language:** `meta.language_stack: [emerge]` builds in Emerge (`.eg`). Without it, the compiler emits TypeScript.
- **Build plan:** each module can carry `build: { state, file, blocked_by, next }`. Built modules are skipped. Modules
  blocked by an open decision are deferred until you remove the id. The rest are built.
- **Model:** a local Ollama by default (`--model qwen2.5-coder:7b`), or `--api openai --url http://localhost:8080`
  (llama.cpp, LM Studio, vLLM), or `--model-module <file>` for anything else. Every answer must pass the Emerge
  checker; a failing one goes to `<file>.t2-rejected.eg`, and a hand-written file gets `<file>.t2-proposal.eg` beside it.
- **Host:** where the build reports. The default is local: `.emerge/build/<spec>.json` lists every file with its
  SHA-256, the plan, the gaps and what the model did, with no timestamps, so it diffs cleanly. `--host <file>` plugs in
  a project's own.

For this repo: `npm run plan`, `npm run scaffold`, `npm run build:spec` (all on `spec/cie-eg.spec`).

## Plugging in a project

A project that wants its own host or model keeps it in its own repo and passes it in: `--host <file>` and
`--model-module <file>` on the command line, or `require('<Emerge>/emerge/build-spec').buildSpec({ spec, host, model })`.
A host exports `createHost()` (see `emerge/compiler/host.js` for the interface); a model exports `createModel()` with
`generate(prompt)` (see `emerge/compiler/model.js`). Emerge never imports either.
