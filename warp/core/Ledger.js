'use strict';
// warp/core/Ledger.js — the causal ledger: append-only, hash-chained, causal by construction — each link's parent is
// recorded at the moment it is known. Zero dependencies (FNV-1a here, like intelligence/rfr2/identity's).
// EM2 (docs/2026-10-02-emerge-field-memory-build-phasemap.spec).

function canonical(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function fnv(s) {
  let h1 = 0x811c9dc5 | 0, h2 = 0xc4a6c57b | 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h1 >>> 13); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

class Ledger {
  constructor() { this._entries = []; this._byId = new Map(); }
  append(kind, body) {
    const prev = this._entries.length ? this._entries[this._entries.length - 1].hash : null;
    const core = { seq: this._entries.length + 1, kind, body, prev };
    const entry = Object.freeze({ ...core, hash: fnv(canonical(core)) });
    this._entries.push(entry);
    if (kind === 'link') this._byId.set(body.id, body);
    return entry;
  }
  link(id) { return this._byId.get(id) || null; }
  links() { return this._entries.filter(e => e.kind === 'link').map(e => e.body); }
  entries() { return this._entries.slice(); }
  /** chain(id) — the link and every cause above it, root last. */
  chain(id) { const out = []; let l = this.link(id); while (l) { out.push(l); l = l.causedBy ? this.link(l.causedBy) : null; } return out; }
  verify() {
    let prev = null;
    for (const e of this._entries) {
      const { hash, ...core } = e;
      if (e.prev !== prev || fnv(canonical(core)) !== hash) return { ok: false, brokenAt: e.seq };
      prev = hash;
    }
    return { ok: true, brokenAt: null };
  }
  toJSON() { return this._entries.slice(); }
}

module.exports = { Ledger, canonical, fnv };
