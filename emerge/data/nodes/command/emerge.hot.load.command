envelope: 1
uuid: nexus-export-command-emerge.hot.load
type: command
id: emerge.hot.load
context: emerge command — declared · served unknown (no dispatch extractor)
intent: null
summary: null
system: null
tags:
  - emerge
  - command
  - declared
exported_at: 1790684787157
source: emerge/registry-components.js
occurrences: 1
firstSeenAt: 1789250730115
lastSeenAt: 1790684787157
fingerprint: 943fa8b656211c87db62e066
payload:
  method: POST
  path: /api/hot-load
  declared: true
  served: null
  description: Hot-patch a running module (QUARANTINE→PROVE→INTEGRATE→MONITOR)
  grammar:
    - hot load
    - emerge hot
  capability: emerge.hot.load
