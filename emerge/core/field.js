'use strict';
// emerge/core/field.js — FIELD: the collection of possible states, and the one place a transition becomes real.
// component_id: emerge.core.field
// Map: docs/2026-10-02-emerge-field-memory-build-phasemap.spec (EM1)
//
// "Meaning is downstream of constraints." (ARCHITECT-SPEC) — a proposal (a model's, a rule's, James's) passes every
// constraint before it changes the state:
//   a constraint it breaks  → rejected, with that constraint's id (a soft one lets it through at its cost)
//   a constraint it cannot be checked against → a Gap naming the missing variable; nothing changes
// Everything — the seed, each transition, rejection, gap and observation — goes into the history. Ids are drawn from
// the seed, and the history holds logical ticks only, so one seed replays byte-identical.

const { createSeed } = require('./seed');
const { createHistory } = require('./history');
const { createTransition } = require('./transition');
const { createObservation } = require('./observation');
const { createGap } = require('./gap');
const { evaluate } = require('./constraint');
const { createBudget } = require('./budget');
const { snapshot } = require('./lens');

function createField({ seed, state = {}, constraints = [] } = {}) {
  const rng = createSeed(seed);
  const history = createHistory();
  const budget = createBudget();
  const laws = [];
  const gaps = [];
  let current = { ...state };

  history.append('seed', { seed, state: current });

  const field = {
    addConstraint(c) {
      if (laws.some(x => x.id === c.id)) throw new Error(`field: constraint ${c.id} is already in the field`);
      laws.push(c);
      history.append('constraint', { id: c.id, name: c.name, constraintType: c.constraintType, needs: c.needs });
      return field;
    },

    /** propose({ source, changes, cost?, causedBy? }) -> { ok, transition?, rejected?, gap?, violations? } */
    propose(input) {
      const t = createTransition({ ...input, id: rng.id('t') });
      const next = { ...current, ...t.changes };
      const ctx = Object.freeze({ state: snapshot(current), spent: budget.spent, cost: t.cost, source: t.source });
      const violations = [];
      for (const law of laws) {
        const r = evaluate(law, next, ctx);
        if (r.gap) {
          const gap = createGap({ id: rng.id('g'), missingVariable: r.gap, affectedConstraint: law.id, source: t.source, causedBy: t.id });
          gaps.push(gap);
          history.append('gap', { transition: t, gap });
          return { ok: false, transition: t, gap };
        }
        if (r.ok === false) {
          if (!law.permitsViolation) {
            history.append('rejected', { transition: t, constraint: r.constraint, reason: r.reason });
            return { ok: false, transition: t, rejected: { constraint: r.constraint, reason: r.reason } };
          }
          violations.push({ constraint: r.constraint, reason: r.reason, cost: law.violationCost });
        }
      }
      const cost = t.cost + violations.reduce((s, v) => s + v.cost, 0);
      budget.charge(cost);
      current = next;
      history.append('transition', { transition: t, violations, spent: budget.spent });
      return { ok: true, transition: t, violations };
    },

    /** observe({ subject, value, confidence, source, cost? }) — evidence is recorded; it never changes the state. */
    observe(input) {
      const o = createObservation({ ...input, id: rng.id('o') });
      budget.charge(o.cost);
      history.append('observation', o);
      return o;
    },

    /** look(lens) — a lens sees a frozen copy; it cannot write to the field. */
    look(lens) { return lens.look({ state: current, gaps, spent: budget.spent }); },

    state() { return snapshot(current); },
    gaps() { return gaps.slice(); },
    get spent() { return budget.spent; },
    history,
    seed,
  };
  for (const c of constraints) field.addConstraint(c);
  return Object.freeze(field);
}

module.exports = { createField };
