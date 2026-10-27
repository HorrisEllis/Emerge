'use strict';
// emerge/core/transition.js — TRANSITION: movement between states. A proposal until the constraints let it through.
// component_id: emerge.core.transition
// Map: docs/2026-10-02-emerge-field-memory-build-phasemap.spec (EM1)

function createTransition({ id, source, changes, cost = 0, causedBy = null }) {
  if (!source) throw new TypeError('transition: source is required — who proposed it (a model, a rule, James)');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('transition: changes must be an object of key → value');
  if (typeof cost !== 'number' || cost < 0) throw new RangeError(`transition: cost must be a number ≥ 0, got ${cost}`);
  return Object.freeze({ type: 'transition', id, source, changes: Object.freeze({ ...changes }), cost, causedBy });
}

module.exports = { createTransition };
