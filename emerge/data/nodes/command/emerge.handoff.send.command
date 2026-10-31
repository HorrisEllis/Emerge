{
  "envelope": 1,
  "uuid": "a0a7dcd2-comm-0000-0000-000000000105",
  "type": "command",
  "id": "emerge.handoff.send",
  "system": "emerge",
  "summary": "send a handoff",
  "payload": {
    "capability": "emerge.handoff.move",
    "cli": "handoff",
    "handler": "handoff",
    "route": "emerge.handoff.send",
    "events": [
      "emerge.handoff.queued",
      "emerge.handoff.refused"
    ]
  }
}
