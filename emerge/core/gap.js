'use strict';
// emerge/core/gap.js — GAP: missing information required to evaluate a constraint (ARCHITECT-SPEC §4.2).
// component_id: emerge.core.gap
// Map: docs/2026-10-02-emerge-field-memory-build-phasemap.spec (EM1)

function createGap({ id, missingVariable, affectedConstraint, source, severity = 'high', causedBy = null }) {
  if (!missingVariable) throw new TypeError('gap: missingVariable is required — a gap names what is missing');
  if (!affectedConstraint) throw new TypeError('gap: affectedConstraint is required — a gap names the constraint it blocks');
  return Object.freeze({ type: 'gap', id, missingVariable, affectedConstraint, source: source || 'unknown', severity, status: 'open', causedBy });
}

module.exports = { createGap };
