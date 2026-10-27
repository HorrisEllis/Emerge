'use strict';
// warp/core/Expectation.js — declared BEFORE anything happens: "this must cause that within N ticks". Held open until
// a link of the expected type is caused by the cause (fulfilled) or the window passes (broken → a gap naming both
// ends). The residue of a run is its open expectations and its gaps — not unclaimed messages.
// EM2 (docs/2026-10-02-emerge-field-memory-build-phasemap.spec).

function createExpectation({ id, cause, effect, within, declaredAt, step = null }) {
  if (!cause) throw new TypeError('[warp/Expectation] cause is required — a link id, or a type ("any link of this type")');
  if (!effect || typeof effect !== 'string') throw new TypeError('[warp/Expectation] effect (a link type) is required');
  if (!Number.isInteger(within) || within < 1) throw new TypeError('[warp/Expectation] within must be a whole number of ticks ≥ 1');
  return { id, cause, effect, within, declaredAt, deadline: declaredAt + within, step, status: 'open', fulfilledBy: null };
}

/** gapOf(expectation) — a broken expectation as a gap: both ends named. */
function gapOf(x) {
  return Object.freeze({ type: 'gap', expectation: x.id, cause: x.cause, missingEffect: x.effect, within: x.within, deadline: x.deadline, step: x.step });
}

module.exports = { createExpectation, gapOf };
