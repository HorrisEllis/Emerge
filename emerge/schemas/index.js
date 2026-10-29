'use strict';
// emerge/schemas/index.js — emerge's own, fully sovereign schema registry.
//
// §CORRECTED 2026-09-12 — James: "relevant individual node schemas per
// system. Each system is sovereign remember that." The prior version of
// this file referenced lib/node-schemas.js at runtime for shared types
// (SHARED_TYPES + shared.get()) — real, working, but not actually
// sovereign: emerge still depended on a central module to resolve most of
// its own types. Every type emerge uses now has its own real, individual
// file in this folder — a genuine copy, not a pointer. emerge can resolve
// every one of its own types with zero runtime dependency on
// lib/node-schemas.js.
//
// §HONEST TRADEOFF, NOT HIDDEN — sovereignty over centralization means
// these copies can drift from lib/node-schemas.js's originals if the
// canonical shape changes later and this copy isn't re-synced. Same
// regression this codebase already names for hat/component's own
// central schema files (lib/node-schemas.js's own header: "if
// hat-forge.js's HAT_SCHEMA... change later, these... schema files will
// silently go stale"). Real cost of real sovereignty, not concealed.

const fs = require('fs');
const path = require('path');
// §2026-10-28 — read with emerge's own js-yaml. The schema files are plain YAML envelopes (envelope, uuid, type, id,
// payload); the old reader, ../../node-export.js, lived in the Nexus tree above emerge/, so this file could not load
// when emerge stood alone. James: "don't couple to nexus … everything from the ground up."
const yaml = require('js-yaml');
const nodeExport = {
  importFromFile(file) {
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    if (!doc || typeof doc !== 'object' || doc.envelope === undefined || !doc.type || !doc.id || !doc.payload) {
      throw new Error(`emerge/schemas/index.js: ${path.basename(file)} is not a schema envelope (envelope, type, id, payload)`);
    }
    return doc;
  },
};

const SCHEMAS_DIR = __dirname;

function loadAll() {
  const out = {};
  const files = fs.readdirSync(SCHEMAS_DIR).filter((f) => f.startsWith('schema.'));
  for (const f of files) {
    const doc = nodeExport.importFromFile(path.join(SCHEMAS_DIR, f));
    if (doc.type !== 'schema') {
      throw new Error(`emerge/schemas/index.js: ${f} has type "${doc.type}", expected "schema"`);
    }
    out[doc.id] = doc.payload;
  }
  return out;
}

const SCHEMAS = loadAll();

function get(type) { return SCHEMAS[type] || null; }

/** list() -> every type emerge owns, all of them real, local files — no shared reference left. */
function list() {
  return Object.entries(SCHEMAS).map(([type, s]) => ({ type, status: s.status, source: s.source, definedIn: 'emerge/schemas' }));
}

module.exports = { get, list, SCHEMAS, MODULE_ID: 'emerge-schemas', VERSION: '2.0.0' };
