{
  "envelope": 1,
  "uuid": "emerge-lang-comm-0003-0000-2026-1031-000000000003",
  "type": "command",
  "id": "emerge.lang.test",
  "system": "emerge",
  "summary": "run an Emerge program's test blocks, each in its own whatif fork",
  "payload": {
    "capability": "emerge.lang.code",
    "cli": "lang-test",
    "route": "emerge.lang.test",
    "events": [
      "emerge.lang.tested"
    ]
  }
}
