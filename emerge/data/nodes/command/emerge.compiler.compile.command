{
  "envelope": 1,
  "uuid": "emerge-comp-comm-0000-2026-1105-000000000003",
  "type": "command",
  "id": "emerge.compiler.compile",
  "system": "emerge",
  "summary": "compile a spec to its T0/T1 package; the files come back as text",
  "payload": {
    "capability": "emerge.compiler.spec",
    "cli": "compile",
    "route": "emerge.compiler.compile",
    "events": [
      "emerge.compiler.compiled"
    ],
    "expects": {
      "in": "{ spec: YAML text (meta, modules, schemas), name?: the spec file's name, tier?: 0|1 (default 1), host?: route settings (EAS_D9) for the host's preflight and writeback, skipWriteback? }",
      "out": "{ ok: true, files: { relative/path: text }, t0: { emitted }, t1: { emitted }, cortex?, writeback? (with a host), ms } \u2014 the same files compiler/index.js compile() writes, read back",
      "fails": "400 naming the missing field \u00b7 { ok: false, error, step } when the compiler refuses the spec (its own words) \u00b7 never a partial ok"
    }
  }
}
