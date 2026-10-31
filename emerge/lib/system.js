'use strict';
// lib/system.js — boot: config, schemas, the JAA store, the ledger and bus, the node index (and its first reindex),
// the listener and the heartbeat. server.js and cli.js both start here; neither builds any of this itself.
const path = require('path');
const config = require('../config.js');
const schemas = require('../schemas/index.js');
const taxonomy = require('../event-taxonomy.js');
const { JaaStore } = require('../jaa-store.js');
const { Ledger } = require('./ledger.js');
const { Bus } = require('./bus.js');
const { NodeIndex } = require('./node-index.js');
const { Listener } = require('./listener.js');
const { Heartbeat } = require('./heartbeat.js');
const boundary = require('./boundary.js');

const ROOT = path.resolve(__dirname, '..');

// The component shape: every component at least one capability, every capability at least one command, every
// command its events — each a node. A gap is a problem the heartbeat reports, not a crash.
function shape(ctx) {
  const out = [];
  for (const c of require('./commands.js').components(ctx)) {
    if (!(c.capabilities || []).length) out.push(`component ${c.id} has no capability`);
    for (const cap of c.capabilities || []) {
      if (!ctx.index.get('capability', cap)) out.push(`component ${c.id}: capability ${cap} has no node`);
      const cmds = ctx.index.list('command', { capability: cap });
      if (!cmds.length) out.push(`capability ${cap} has no command`);
      for (const cmd of cmds) if (!(cmd.events || []).length) out.push(`command ${cmd.id} has no events`);
    }
  }
  return out;
}

function boot({ root = ROOT, watch = false, beat = false, ledgerSession } = {}) {
  const cfg = config.load(root);
  const system = cfg.system;
  delete require.cache[require.resolve(path.join(root, 'registry-components.js'))];
  const registry = require(path.join(root, 'registry-components.js'));
  const store = new JaaStore(path.join(root, 'data', 'node-index'));
  const ledger = new Ledger(root, ledgerSession);
  const index = new NodeIndex({ root, store, schemas: schemas.create(path.join(root, 'schemas')) });
  const bus = new Bus(ledger, taxonomy.declared(index));
  const ctx = { root, system, config: cfg, registry, store, ledger, bus, index };
  ctx.listener = new Listener({ root, system, index, bus, pollMs: cfg.listener && cfg.listener.pollMs });
  ctx.listener.sync();
  // sovereign: the system holds only its own folder; a require that leaves it is a problem the heartbeat reports
  ctx.boundary = () => boundary.outside(root);
  ctx.heartbeat = new Heartbeat({ system, index, bus, intervalMs: cfg.heartbeatMs,
    checks: [() => ctx.boundary().map(o => `${o.file} requires ${o.requires}: outside this system (reach another system through its contract)`)] });
  ctx.shape = () => shape(ctx);
  if (watch) ctx.listener.start();
  if (beat) ctx.heartbeat.start();
  ctx.stop = () => { ctx.listener.stop(); ctx.heartbeat.stop(); };
  return ctx;
}

module.exports = { boot, shape, ROOT };
