envelope: 1
uuid: nexus-export-command-emerge.snapshot
type: command
id: emerge.snapshot
context: emerge command — declared · served unknown (no dispatch extractor)
intent: null
summary: null
system: null
tags:
  - emerge
  - command
  - declared
exported_at: 1790684787158
source: emerge/registry-components.js
occurrences: 1
firstSeenAt: 1789250730116
lastSeenAt: 1790684787158
fingerprint: 9252a5a9e92bb98a08e77168
payload:
  method: POST
  path: /api/snapshot
  declared: true
  served: null
  description: Snapshot before applying patch
  grammar:
    - snapshot
    - emerge snapshot
  capability: emerge.snapshot
