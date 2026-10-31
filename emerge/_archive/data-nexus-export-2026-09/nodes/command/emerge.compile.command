envelope: 1
uuid: nexus-export-command-emerge.compile
type: command
id: emerge.compile
context: emerge command — declared · served unknown (no dispatch extractor)
intent: null
summary: null
system: null
tags:
  - emerge
  - command
  - declared
exported_at: 1790684787159
source: emerge/registry-components.js
occurrences: 1
firstSeenAt: 1789250730115
lastSeenAt: 1790684787159
fingerprint: 3faaa0c20b8dd9879ca68686
payload:
  method: POST
  path: /compile
  declared: true
  served: null
  description: Compile .emerge spec → T0/T1/T2 pipeline
  grammar:
    - compile
    - emerge compile
  capability: emerge.compile
