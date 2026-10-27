'use strict';
// emerge/core/index.js — EMERGE's core: James's Rheon primitives as code (docs/2026-10-02-emerge-field-memory-build-phasemap.spec EM1).
// component_id: emerge.core
// Field · Constraint · Transition · Observation · Lens · Gap · History, plus Level, Budget and Seed.
// Meaning is not here: it is human interpretation, late-stage, derived — James's.
// Zero dependencies (E10): identity and logical time are intelligence/rfr2's, reused.

module.exports = {
  ...require('./field'),
  ...require('./constraint'),
  ...require('./transition'),
  ...require('./observation'),
  ...require('./lens'),
  ...require('./gap'),
  ...require('./history'),
  ...require('./level'),
  ...require('./budget'),
  ...require('./seed'),
};
