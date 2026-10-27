envelope: 1
uuid: nexus-export-command-emerge.seams
type: command
id: emerge.seams
context: emerge command — declared · served unknown (no dispatch extractor)
intent: null
summary: null
system: null
tags:
  - emerge
  - command
  - declared
exported_at: 1790684787150
source: emerge/registry-components.js
occurrences: 1
firstSeenAt: 1789250730122
lastSeenAt: 1790684787150
fingerprint: b5d12c3b7f72e36535e08e75
payload:
  method: GET
  path: /api/seams
  declared: true
  served: null
  description: Active SEAM sessions for current file
  grammar:
    - seams
    - emerge seams
  capability: emerge.seams
