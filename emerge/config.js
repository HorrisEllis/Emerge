'use strict';
// config.js — the system's configuration: emerge.config.json, then the environment over it (EMERGE_PORT,
// EMERGE_HEARTBEAT_MS). Anything adjustable lives here, not in code.
const fs = require('fs');
const path = require('path');

function load(root = __dirname) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'emerge.config.json'), 'utf8'));
  const env = (k) => process.env[`EMERGE_${k}`];
  if (env('PORT') !== undefined) cfg.port = Number(env('PORT'));
  if (env('HEARTBEAT_MS') !== undefined) cfg.heartbeatMs = Number(env('HEARTBEAT_MS'));
  return cfg;
}

// The IDE server's static defaults (emerge-ide.js reads these; its --port flag still wins). Kept from the old config.js.
const DEFAULT_PORT = parseInt(process.env.EMERGE_IDE_PORT || '4242', 10);
const BUS_LOG_MAX = 200;

module.exports = { load, DEFAULT_PORT, BUS_LOG_MAX };
