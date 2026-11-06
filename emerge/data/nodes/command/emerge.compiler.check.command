{
  "envelope": 1,
  "uuid": "emerge-comp-comm-0004-2026-1105-000000000012",
  "type": "command",
  "id": "emerge.compiler.check",
  "system": "emerge",
  "summary": "a spec's knowledge graph (kg-builder): the ids it declares, its BLACK nodes; nothing written",
  "payload": {
    "capability": "emerge.compiler.spec",
    "cli": "check-spec",
    "route": "emerge.compiler.check",
    "events": [
      "emerge.compiler.checked"
    ],
    "expects": {
      "in": "{ spec: YAML text } or, on the command line, { file: its path }",
      "out": "{ ok: true, ids: [every non-BLACK node's id and name], black: [ids], nodes: count }",
      "fails": "400 naming the missing field \u00b7 { ok: false, error } for a spec that is not YAML or does not build, in kg-builder's words"
    }
  }
}
