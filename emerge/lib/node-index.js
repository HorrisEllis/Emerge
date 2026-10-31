'use strict';
// lib/node-index.js — the node index. The node files are canonical; each node type has a JAA table (nodes_<type>)
// as its index and nodes_<type>_ledger as its append-only history. reindex() reads every node file, checks it
// against its type's schema, upserts what changed, soft-deletes what is gone, and returns what it did.
const fs = require('fs');
const path = require('path');
const env = require('./envelope.js');

class NodeIndex {
  constructor({ root, store, schemas }) { this.root = root; this.store = store; this.schemas = schemas; this.problems = []; }

  _types() {
    const dir = path.join(this.root, 'data', 'nodes');
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name); }
    catch (_) { return []; }
  }

  reindex() {
    const changes = [], problems = [];
    for (const type of this._types()) {
      const dir = path.join(this.root, 'data', 'nodes', type);
      const table = `nodes_${type}`, seen = new Set();
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith(`.${type}`))) {
        let doc;
        try { doc = env.read(path.join(dir, f)); } catch (e) { problems.push(e.message); continue; }
        const bad = env.validate(doc, this.schemas.get(type));
        if (bad.length) { problems.push(...bad); continue; }   // refused until it matches its schema — said, not passed
        seen.add(doc.id);
        const fp = env.fingerprint(doc), old = this.store.get(table, doc.id);
        if (old && old.fingerprint === fp) continue;
        this.store.upsert(table, { id: doc.id, uuid: doc.uuid, file: path.join('data', 'nodes', type, f), fingerprint: fp, node: env.flat(doc) });
        this.store.append(`${table}_ledger`, { op: old ? 'change' : 'add', id: doc.id, fingerprint: fp });
        changes.push({ op: old ? 'change' : 'add', type, id: doc.id });
      }
      for (const row of this.store.all(table)) {
        if (seen.has(row.id)) continue;
        this.store.remove(table, row.id);
        this.store.append(`${table}_ledger`, { op: 'delete', id: row.id });
        changes.push({ op: 'delete', type, id: row.id });
      }
    }
    this.problems = problems;
    return { changes, problems };
  }

  get(type, id) { const r = this.store.get(`nodes_${type}`, id); return r ? r.node : null; }

  list(type, where = null) {
    const rows = this.store.all(`nodes_${type}`).map(r => r.node);
    return where ? rows.filter(n => Object.entries(where).every(([k, v]) => (Array.isArray(n[k]) ? n[k].includes(v) : n[k] === v))) : rows;
  }

  counts() { return Object.fromEntries(this._types().map(t => [t, this.store.count(`nodes_${t}`)])); }
}

module.exports = { NodeIndex };
