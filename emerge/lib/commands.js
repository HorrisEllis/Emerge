'use strict';
// lib/commands.js — runs command nodes. A command names its capability; the registry says which component owns that
// capability and which file it is — registry-components.js with the live component nodes over it, so a capability
// added as nodes alone is runnable — the handler is the command's own `handler`, or the last part of its id. The
// command's events are emitted after it runs. Nothing imports a component directly — this is the door.
const path = require('path');

/** components(ctx) -> the registry's entries with each component node laid over its entry (a node-only component counts). */
function components(ctx) {
  const byId = new Map((ctx.registry.components || []).map(c => [c.id, c]));
  for (const n of ctx.index.list('component')) byId.set(n.id, { ...(byId.get(n.id) || {}), ...n });
  return [...byId.values()];
}

function find(ctx, nameOrId) {
  const all = ctx.index.list('command');
  return all.find(c => c.id === nameOrId) || all.find(c => c.cli === nameOrId) || null;
}

async function run(ctx, nameOrId, args = {}) {
  const cmd = find(ctx, nameOrId);
  if (!cmd) throw Object.assign(new Error(`no command "${nameOrId}"`), { status: 404 });
  const comp = components(ctx).find(c => (c.capabilities || []).includes(cmd.capability));
  if (!comp) throw Object.assign(new Error(`no component in the registry has capability ${cmd.capability}`), { status: 500 });
  const mod = require(path.join(ctx.root, comp.file));
  const handler = cmd.handler || cmd.id.split('.').pop();
  if (typeof mod[handler] !== 'function') throw Object.assign(new Error(`${comp.file} has no ${handler}()`), { status: 500 });
  const result = await mod[handler](args, ctx);
  for (const e of cmd.events || []) ctx.bus.emit(e, { command: cmd.id, result });
  ctx.bus.emit(`${ctx.system}.command.ran`, { command: cmd.id });
  return result;
}

module.exports = { components, find, run };
