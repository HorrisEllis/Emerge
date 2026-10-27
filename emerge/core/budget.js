'use strict';
// emerge/core/budget.js — BUDGET: the cost of every transition is counted; a constraint can bound it.
// component_id: emerge.core.budget
// Map: docs/2026-10-02-emerge-field-memory-build-phasemap.spec (EM1)

const { defineConstraint } = require('./constraint');

function createBudget() {
  let spent = 0;
  return Object.freeze({
    charge(cost) { spent += cost; return spent; },
    get spent() { return spent; },
  });
}

/** budgetConstraint(limit) — refuses a transition whose cost would take the run past the limit. */
function budgetConstraint(limit, id = 'budget.limit') {
  return defineConstraint({ id, name: `the run spends at most ${limit}`, type: 'hard',
    check: (_next, ctx) => (ctx.spent + ctx.cost <= limit) || { ok: false, reason: `would spend ${ctx.spent + ctx.cost} of ${limit}` } });
}

module.exports = { createBudget, budgetConstraint };
