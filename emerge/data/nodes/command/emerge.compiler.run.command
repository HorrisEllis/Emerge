{
  "envelope": 1,
  "uuid": "emerge-comp-comm-0003-2026-1105-000000000009",
  "type": "command",
  "id": "emerge.compiler.run",
  "system": "emerge",
  "summary": "compile, then T2 through the model; files and progress come back",
  "payload": {
    "capability": "emerge.compiler.spec",
    "cli": "run-spec",
    "route": "emerge.compiler.run",
    "events": [
      "emerge.compiler.ran"
    ],
    "expects": {
      "in": "{ spec: YAML text, name?, host?: route settings, model?: { api: 'route', url } | { api: 'ollama'|'openai', url?, model? } (EAS_D9), dryRun? }",
      "out": "{ ok, stage: compile | compile_only | complete, summary, moduleName, t2: { dispatched, completed, failed, skipped, model, results }, progress: [{ node, status, detail, ts }], files, ms }",
      "fails": "400 naming a missing or non-settings field \u00b7 { ok: false, stage: 'compile', error } \u00b7 a T2 node the model or the checker refuses is a result with its reason, never dropped"
    }
  }
}
