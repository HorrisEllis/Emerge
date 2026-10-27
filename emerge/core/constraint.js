'use strict';
// emerge/core/constraint.js — CONSTRAINT: reduces valid future states (ARCHITECT-SPEC §4.1).
// component_id: emerge.core.constraint
// Map: docs/2026-10-02-emerge-field-memory-build-phasemap.spec (EM1)
//
// A constraint names the variables it needs. evaluate() gives one of three answers, never a guess:
//   { ok: true }                         — the next state is valid
//   { ok: false, constraint, reason }    — it is not; the constraint's id says which law it broke
//   { gap: missingVariable }             — it cannot be evaluated: a needed variable is absent
// 'soft' and 'probabilistic' constraints permit a violation at its violationCost; every other type refuses.

const TYPES = Object.freeze(['hard', 'soft', 'probabilistic', 'temporal', 'causal', 'relational']);
const PERMITS_VIOLATION = new Set(['soft', 'probabilistic']);

function defineConstraint({ id, name, type = 'hard', needs = [], check, violationCost = 1, strength = 1 }) {
  if (!id) throw new TypeError('constraint: id is required — a rejection names its constraint');
  if (!TYPES.includes(type)) throw new TypeError(`constraint ${id}: type "${type}" is not one of ${TYPES.join(', ')}`);
  if (typeof check !== 'function') throw new TypeError(`constraint ${id}: check(next, ctx) is required`);
  return Object.freeze({ type: 'constraint', id, name: name || id, constraintType: type, needs: Object.freeze([...needs]), check, violationCost, strength, permitsViolation: PERMITS_VIOLATION.has(type) });
}

/** evaluate(constraint, next, ctx) — next is the state the transition would produce; ctx is read-only. */
function evaluate(constraint, next, ctx = {}) {
  for (const v of constraint.needs) if (!(v in next) || next[v] === undefined) return { gap: v };
  const r = constraint.check(next, ctx);
  if (r === true || (r && r.ok === true)) return { ok: true };
  return { ok: false, constraint: constraint.id, reason: (r && r.reason) || `${constraint.name} does not hold` };
}

module.exports = { defineConstraint, evaluate, TYPES };
