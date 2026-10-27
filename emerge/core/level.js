'use strict';
// emerge/core/level.js — LEVEL: every node sits at a level, with its parent and children; its hash is its summary plus
// its children's hashes, so a change anywhere below shows at every level above.
// component_id: emerge.core.level
// Map: docs/2026-10-02-emerge-field-memory-build-phasemap.spec (EM1)

const { canonicalize, hash64 } = require('../../../intelligence/rfr2/identity');

function createLevels() {
  const nodes = new Map();
  const api = {
    add({ id, level, parent = null, summary = '' }) {
      if (!id || !Number.isInteger(level) || level < 0) throw new TypeError('level: id and an integer level ≥ 0 are required');
      if (nodes.has(id)) throw new Error(`level: ${id} is already placed`);
      if (parent !== null) {
        const p = nodes.get(parent);
        if (!p) throw new Error(`level: parent ${parent} of ${id} is not placed`);
        if (p.level !== level - 1) throw new Error(`level: ${id} at ${level} under ${parent} at ${p.level} — a child is one level below its parent`);
        p.children.push(id);
      }
      nodes.set(id, { id, level, parent, summary, children: [] });
      return api;
    },
    get(id) { const n = nodes.get(id); return n ? { ...n, children: n.children.slice() } : null; },
    hashOf(id) {
      const n = nodes.get(id);
      if (!n) return null;
      return hash64(canonicalize({ summary: n.summary, children: n.children.map(c => api.hashOf(c)) }));
    },
    setSummary(id, summary) { const n = nodes.get(id); if (!n) throw new Error(`level: ${id} is not placed`); n.summary = summary; },
  };
  return Object.freeze(api);
}

module.exports = { createLevels };
