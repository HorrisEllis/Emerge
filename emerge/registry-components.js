// registry-components.js — the spine. Every component connects only to this.
// Each id points at a node in data/nodes/; the node schemas are in schemas/. A new component is one entry here,
// its file in lib/, and its component, capability, command and event nodes — nothing else is rewired.
module.exports = {
  system: 'emerge',
  components: [
    {
      type: 'component',
      id: 'emerge.core',
      uuid: 'a0a7dcd2-core-0000-0000-000000000001',
      file: 'lib/core.js',
      intent: 'the system reporting on itself: its status and its nodes',
      version: '0.1.0',
      status: 'built',
      capabilities: ['emerge.core.observe'],
      hooks: ['emerge.core.http'],
      consumers: [],
      data: { dir: 'data/nodes', store: 'node', types: ['component', 'capability', 'command', 'event', 'route', 'hook', 'wire', 'bundle'] },
    },
    // the drawbridge: work moves to and from other systems as verified files (input/ → processing/ → done/ | failed/)
    {
      type: 'component',
      id: 'emerge.handoff',
      uuid: 'a0a7dcd2-hand-0000-0000-000000000101',
      file: 'lib/handoff.js',
      intent: 'work moves between systems as a file: verified by the registry and the handshake, then moved to the target\'s input/',
      version: '0.1.0',
      status: 'built',
      capabilities: ['emerge.handoff.move'],
      hooks: [],
      consumers: [],
      data: { dir: 'input, processing, done, failed, output', store: 'node', types: ['handoff'] },
    },
    // recursion: a module is a system — this skeleton again, one level down, from the system's own template
    {
      type: 'component',
      id: 'emerge.modules',
      uuid: 'a0a7dcd2-modu-0000-0000-000000000102',
      file: 'lib/modules.js',
      intent: 'a module is a system: the skeleton laid out again under modules/, from template/',
      version: '0.1.0',
      status: 'built',
      capabilities: ['emerge.modules.nest'],
      hooks: [],
      consumers: [],
      data: { dir: 'modules', store: 'node', types: ['module'] },
    },
    // ── the idea's components slot in below ──
  ],
  // the events a person should see, declared here so the UI reads them from the contract and keeps no list of its own
  // (James, 2026-10-17: "making the ui disposable, soveriegn"): [{ event: 'emerge.x.done', level: 'ok'|'warn'|'err', text }]
  toasts: [],
};
