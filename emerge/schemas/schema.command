envelope: 1
uuid: nexus-export-schema-command
type: schema
id: command
context: >-
  emerge/schemas — sovereign local copy. Origin: lib/node-schemas/schema.command (shared canonical
  version, may have moved on independently since this copy was made — sovereignty means emerge does
  not depend on it at runtime, not that the two can never drift).
intent: null
summary: null
system: emerge
tags: []
exported_at: 1789235656679
source: nexus.lib.node-export
payload:
  status: REAL
  source: clear-glass/src/ipc/bridge.js — _buildCommandIndex()'s real, live-introspected route entries
  fields:
    method:
      type: string
      required: true
      description: real HTTP method, e.g. 'GET'
    path:
      type: string
      required: true
      description: real route path, introspected from Express's own route table, never hand-maintained
