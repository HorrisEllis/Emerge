'use strict';
// emerge/schemas/index.js — Emerge's own schemas, two sets, two contracts (EAS_D2, 2026-10-31):
//   schemas/schema.<type>          the system's node types (genesis's skeleton): the node index validates data/nodes/ against these
//   schemas/records/schema.<type>  the Loom record shapes (component, hook, wire, …) that `eg components` exports; lang/components.js
//                                  reads their required fields
// Both are envelopes { envelope, type: schema, id, payload }; the node schemas are JSON, the record schemas YAML (JSON is YAML too).
//
// §CORRECTED 2026-09-12 — James: "relevant individual node schemas per system. Each system is sovereign remember that." Every type
// Emerge uses has its own file here; nothing is read from Nexus at run time.
const fs = require('fs');
const path = require('path');

function _read(file) {
  const text = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(text); } catch (_) { return require('js-yaml').load(text); }
}

/** loadAll(dir) -> { type: payload } for every schema.<type> in dir */
function loadAll(dir = __dirname) {
  const out = {};
  for (const f of fs.readdirSync(dir).filter(f => f.startsWith('schema.'))) {
    const doc = _read(path.join(dir, f));
    if (!doc || doc.type !== 'schema' || !doc.id || !doc.payload) throw new Error(`schemas/${path.relative(__dirname, path.join(dir, f))}: not a schema envelope (type schema, id, payload)`);
    out[doc.id] = doc.payload;
  }
  return out;
}

/** create(dir) -> the skeleton's reader: { get(type), types(), all } (lib/system.js) */
function create(dir = __dirname) {
  const all = loadAll(dir);
  return { get: (type) => all[type] || null, types: () => Object.keys(all).sort(), all };
}

// The record schemas, as the old reader served them (get, list, SCHEMAS).
const RECORDS_DIR = path.join(__dirname, 'records');
const SCHEMAS = loadAll(RECORDS_DIR);
function get(type) { return SCHEMAS[type] || null; }
function list() {
  return Object.entries(SCHEMAS).map(([type, s]) => ({ type, status: s.status, source: s.source, definedIn: 'emerge/schemas/records' }));
}

module.exports = { create, loadAll, get, list, SCHEMAS, RECORDS_DIR, MODULE_ID: 'emerge-schemas', VERSION: '3.0.0' };
