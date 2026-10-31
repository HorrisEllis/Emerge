'use strict';
// event-taxonomy.js — the system's events, generated from its event nodes (data/nodes/event/), never hand-written.
// The system events below are the ones the skeleton's own parts emit whether or not a node names them.
// The compiler's own events (events-compiler.js, written from the code) are declared here too: one taxonomy, two sources.
const COMPILER = require('./events-compiler.js');

const SYSTEM = ['emerge.heartbeat', 'emerge.node.changed', 'emerge.command.ran', 'emerge.listener.failed',
  // a handoff's life on the receiving side, and the receipts that come back (lib/handoff.js)
  'emerge.handoff.taken', 'emerge.handoff.done', 'emerge.handoff.failed', 'emerge.handoff.reported', 'emerge.handoff.recovered', 'emerge.handoff.drain_failed'];

function taxonomy(index) {
  const out = Object.fromEntries(SYSTEM.map(e => [e, { from: 'skeleton' }]));
  for (const [k, v] of Object.entries(COMPILER)) out[k] = { from: 'compiler', ...v };
  for (const e of index.list('event')) out[e.id] = { from: 'node', command: e.command, payload: e.payload };
  return out;
}

function declared(index) { return (event) => SYSTEM.includes(event) || Object.prototype.hasOwnProperty.call(COMPILER, event) || !!index.get('event', event); }

module.exports = { SYSTEM, COMPILER, taxonomy, declared };
