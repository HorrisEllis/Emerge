# Node type → system map — Emerge

## Legend
WRITES / READS / VIA LOOM / PARTICIPATES / NOT USED — same as Guardian/Versionium.

| Type | Status | Grounding |
|---|---|---|
| `capability` | WRITES | `emerge/registry-components.js`, same `_c()` convention. |
| `command` | WRITES | Same registry, route-shaped entries. |
| `component` | VIA LOOM | Confirmed — `'emerge'` is in `capability-map.js`'s real `SYSTEMS` map. |
| `hook` | VIA LOOM | Same scan. |
| `wire` | VIA LOOM | Same scan. |
| `node` | VIA LOOM | Same scan. |
| `spec` | WRITES — plus its own spec-compiler role | `emerge/spec/emerge.spec`, `emerge/emerge.spec`, and `emerge/SPEC_COMPILER.spec` — emerge is the system that *compiles* specs (`emerge-codegen-v2.js`, `emerge-ide.js`, `emerge-kernel.js`), not just a system that happens to have one. |
| `system` | IS ONE | `emerge` is a real, named system in `NEXUS_MAP.md` and `capability-map.js`'s `SYSTEMS` map. |
| Everything else in the 32 | NOT CHECKED EXHAUSTIVELY | Not swept for every remaining type this pass. |
