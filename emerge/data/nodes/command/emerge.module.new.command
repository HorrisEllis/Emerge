{
  "envelope": 1,
  "uuid": "a0a7dcd2-comm-0000-0000-000000000107",
  "type": "command",
  "id": "emerge.module.new",
  "system": "emerge",
  "summary": "lay out a module",
  "payload": {
    "capability": "emerge.modules.nest",
    "cli": "module",
    "handler": "newModule",
    "route": "emerge.module.new",
    "events": [
      "emerge.module.created"
    ]
  }
}
