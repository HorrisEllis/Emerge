'use strict';
// jaa-store.js — the JAA database: a table per name, rows upserted by id, each table its own JSON file in
// data/node-index/, and an append-only <table>.jsonl beside it for history. Small on purpose — it is the index,
// the node files stay canonical, and the whole index can be rebuilt from them.
const fs = require('fs');
const path = require('path');
const { atomicWrite } = require('./lib/atomic-write.js');

class JaaStore {
  constructor(dir) { this.dir = dir; this.tables = new Map(); fs.mkdirSync(dir, { recursive: true }); }

  _file(name) { return path.join(this.dir, `${name}.json`); }

  _load(name) {
    if (!this.tables.has(name)) {
      let rows = {};
      try { rows = JSON.parse(fs.readFileSync(this._file(name), 'utf8')); } catch (_) { rows = {}; }
      this.tables.set(name, rows);
    }
    return this.tables.get(name);
  }

  _flush(name) { atomicWrite(this._file(name), JSON.stringify(this._load(name), null, 1)); }

  upsert(name, row) {
    if (!row || !row.id) throw new Error(`jaa ${name}: a row needs an id`);
    this._load(name)[row.id] = { ...row, updatedAt: Date.now() };
    this._flush(name);
    return row;
  }

  get(name, id) { const r = this._load(name)[id]; return r && !r.deleted ? r : null; }

  all(name, { withDeleted = false } = {}) { return Object.values(this._load(name)).filter(r => withDeleted || !r.deleted); }

  remove(name, id) {
    const rows = this._load(name);
    if (!rows[id] || rows[id].deleted) return false;
    rows[id] = { ...rows[id], deleted: true, updatedAt: Date.now() };   // a soft delete: the row stays, marked
    this._flush(name);
    return true;
  }

  count(name) { return this.all(name).length; }

  append(name, entry) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(path.join(this.dir, `${name}.jsonl`), JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
  }

  names() {
    let files = [];
    try { files = fs.readdirSync(this.dir); } catch (_) {}
    return [...new Set([...this.tables.keys(), ...files.filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))])];
  }
}

module.exports = { JaaStore };
