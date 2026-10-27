'use strict';
// emerge/core/lens.js — LENS: a projection of the field. Read-only by construction: it is handed a deep-frozen copy.
// component_id: emerge.core.lens
// Map: docs/2026-10-02-emerge-field-memory-build-phasemap.spec (EM1)

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); }
  return v;
}
function snapshot(v) { return deepFreeze(JSON.parse(JSON.stringify(v ?? null))); }

function createLens(name, project) {
  if (!name) throw new TypeError('lens: a name is required');
  if (typeof project !== 'function') throw new TypeError(`lens ${name}: project(view) is required`);
  return Object.freeze({ type: 'lens', name, look(view) { 'use strict'; return project(snapshot(view)); } });
}

module.exports = { createLens, snapshot, deepFreeze };
