'use strict';
// lib/ledger.js — the event ledger: every event, per session, timestamped, in data/ledger/<session>/events.jsonl.
const fs = require('fs');
const path = require('path');

function session() { return new Date().toISOString().replace(/[:.]/g, '-'); }

class Ledger {
  constructor(root, id = session()) {
    this.session = id;
    this.dir = path.join(root, 'data', 'ledger', id);
    this.file = path.join(this.dir, 'events.jsonl');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  append(event, data = null) {
    const entry = { ts: Date.now(), event, data };
    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    return entry;
  }

  tail(n = 50) {
    let lines = [];
    try { lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean); } catch (_) {}
    return lines.slice(-n).map(l => JSON.parse(l));
  }
}

module.exports = { Ledger, session };
