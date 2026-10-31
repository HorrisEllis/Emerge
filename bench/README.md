# Emerge vs JavaScript token benchmark

Put this folder next to `emerge/` (repo root), or set `EG_PATH=/path/to/emerge/lang/eg.js`.

    node bench.js static                          # sizes of the reference solutions; checks every reference passes
    node bench.js llm --model <ollama-model>      # a local model solves each task in both languages, with retries
                  [--attempts 5] [--tasks median,tank] [--ctx 8192] [--url http://localhost:11434]

`llm` mode reports total tokens (prompt + output, as Ollama counts them) until the tests pass, per task and language.
The plumbing was tested against a fake server only: no real model has run it yet. Ollama may reuse its prompt cache between
attempts, which lowers the reported prompt counts for the Emerge reference context.

Not covered yet: hidden tests (to count silently wrong programs), edit-an-existing-project tasks, repeat runs.

## Chunk benchmark (cie-eg.spec §15)

Does cutting careful handwork into minimal units, each with its boundary declared at every edge, let a smaller model
write it? `chunks.js` runs the same job two ways with the same model and the same small syntax card:

- **monolith**: one prompt, "write a strict UTF-8 decoder" (CIE-EG §2.2).
- **chunked**: six units (`seq_len`, `is_cont`, `lead_bits`, `add_cont`, `valid_scalar`, `decode`), one prompt each. A
  unit sees only its own boundary and the signatures of the units it may call, never their code. Each unit is tested
  alone, then the assembled program is tested with the monolith's tests.

Everything is built from `chunks/utf8_decode/chunks.spec`.

    cd emerge && npm install && cd ..                 # once: js-yaml, to read the .spec
    node bench/chunks.js static                       # every reference unit passes; prompt sizes
    node bench/chunks.js selftest                     # whole pipeline against a fake model server

    ollama pull qwen2.5-coder:0.5b   (and :1.5b, :3b, :7b)
    node bench/chunks.js sweep --models qwen2.5-coder:0.5b,qwen2.5-coder:1.5b,qwen2.5-coder:3b,qwen2.5-coder:7b --trials 3 --temperature 0.4

    # llama.cpp server, LM Studio or vLLM instead of Ollama:
    node bench/chunks.js run --model <name> --api openai --url http://localhost:8080

Options: `--attempts 3` (retries with the test output fed back), `--trials N` (use a temperature above 0 so trials differ),
`--assist` (when a unit fails, use its reference and carry on, so later units are still measured). Results are saved
to `bench/results/`. The report gives, per model: monolith solved, chunked solved, units passed, and tokens.

Status: the references pass and the plumbing passes the self-test; no real model has run it yet.

## Results, 2026-10-31 (this container: Linux x86-64, Node v22.23.4, Python 3.13.18)

### Tokens to write the reference solutions (`node bench.js static`, real tokenizers)

| task | Emerge | JavaScript | Python |
|---|---|---|---|
| median | 77 | 88 | 66 |
| rle | 98 | 77 | 70 |
| tank (state, range rule, audit trail) | **71** | 149 | 146 |
| top_word | 110 | 122 | 73 |
| **total (cl100k_base)** | **356** | 436 | 355 |

o200k_base gives the same picture (357 / 440 / 357). Emerge also needs ~1,200 tokens of reference context per session,
because no model knows it; JavaScript and Python need none. The Python solutions were written for this run, by the same
coder, after the Emerge and JavaScript ones.

### Speed (`speed/run.sh`: run-length encode 200k chars + median of 200k numbers, best of 5, identical output required)

| way | ms |
|---|---|
| Emerge interpreter (`eg run`) | 2,094 |
| Emerge compiled to JavaScript (`eg build`) | 1,445 |
| Emerge native (x86-64 ELF, no libc) | 215,182 |
| JavaScript (Node) | 146 |
| Python | 209 |

Native is slow because of one quadratic operation: `for ch in s` over a string (2x the length, 4x the time: 20k chars
2.2 s, 40k chars 8.9 s). Generating the input (9 ms at 20k) and the median, with the prelude's merge sort, (76 ms at
20k) scale normally. Also found: `push` copies the list (`xs + [x]` in core/prelude.eg), so building a list with it
is quadratic in every backend; the workload preallocates and assigns by index instead.
