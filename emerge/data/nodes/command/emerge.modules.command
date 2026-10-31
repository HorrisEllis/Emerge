{
  "envelope": 1,
  "uuid": "a0a7dcd2-comm-0000-0000-000000000108",
  "type": "command",
  "id": "emerge.modules",
  "system": "emerge",
  "summary": "list the modules",
  "payload": {
    "capability": "emerge.modules.nest",
    "cli": "modules",
    "handler": "modules",
    "route": "emerge.modules",
    "events": [
      "emerge.modules.listed"
    ]
  }
}
