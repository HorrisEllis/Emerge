{
  "envelope": 1,
  "uuid": "a0a7dcd2-comm-0000-0000-000000000106",
  "type": "command",
  "id": "emerge.handoffs",
  "system": "emerge",
  "summary": "list the handoffs",
  "payload": {
    "capability": "emerge.handoff.move",
    "cli": "handoffs",
    "handler": "handoffs",
    "route": "emerge.handoffs",
    "events": [
      "emerge.handoffs.listed"
    ]
  }
}
