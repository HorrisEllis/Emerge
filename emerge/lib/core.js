'use strict';
// lib/core.js — component emerge.core, capability emerge.core.observe: the system reporting on itself.
// Its commands are nodes (data/nodes/command/emerge.status.command, emerge.nodes.command); this file is only
// what they run.

function status(args, ctx) {
  return { ...ctx.heartbeat.snapshot(), shape: ctx.shape(), components: require('./commands.js').components(ctx).map(c => ({ id: c.id, status: c.status })) };
}

function nodes(args, ctx) {
  const type = args.type || 'component';
  return { type, nodes: ctx.index.list(type) };
}

module.exports = { status, nodes };
