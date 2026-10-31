'use strict';
// lib/envelope.js — node files: one file per fact at data/nodes/<type>/<id>.<type>, in the node envelope
// { envelope: 1, uuid, type, id, system, summary, payload }. Written as JSON, which is also YAML, so Nexus's own
// node reader (lib/node-export.js) reads them as they are.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWrite } = require('./atomic-write.js');

function nodePath(root, type, id) { return path.join(root, 'data', 'nodes', type, `${id}.${type}`); }

function read(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!doc || doc.envelope !== 1 || !doc.type || !doc.id) throw new Error(`${file}: not a node envelope`);
  return doc;
}

function write(root, type, id, payload, meta = {}) {
  const file = nodePath(root, type, id);
  let uuid = meta.uuid;
  if (!uuid) { try { uuid = read(file).uuid; } catch (_) { uuid = crypto.randomUUID(); } }
  const doc = { envelope: 1, uuid, type, id, system: meta.system || null, summary: meta.summary || null, payload };
  atomicWrite(file, JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

function fingerprint(doc) {
  return crypto.createHash('sha1').update(JSON.stringify({ uuid: doc.uuid, payload: doc.payload })).digest('hex');
}

// The node as its schema sees it: the envelope's type/id/uuid plus its payload's fields.
function flat(doc) { return { ...(doc.payload || {}), type: doc.type, id: doc.id, uuid: doc.uuid }; }

const TYPE_OK = {
  string: (v) => typeof v === 'string', number: (v) => typeof v === 'number', boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v), object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

/** validate(doc, schema) -> [problem] — schema is a schema node's payload: { fields: { name: { type, required } } }. */
function validate(doc, schema) {
  if (!schema || !schema.fields) return [`no schema for node type "${doc.type}"`];
  const n = flat(doc), out = [];
  for (const [name, f] of Object.entries(schema.fields)) {
    const v = n[name];
    if (v === undefined || v === null || v === '') { if (f.required) out.push(`${doc.type} ${doc.id}: ${name} is required`); continue; }
    if (TYPE_OK[f.type] && !TYPE_OK[f.type](v)) out.push(`${doc.type} ${doc.id}: ${name} must be ${f.type}`);
  }
  return out;
}

module.exports = { nodePath, read, write, fingerprint, flat, validate };
