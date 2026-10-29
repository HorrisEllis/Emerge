'use strict';
// emerge/core/index.js — EMERGE's core: James's Rheon primitives as code (docs/2026-10-02-emerge-field-memory-build-phasemap.spec EM1).
// component_id: emerge.core
// Field · Constraint · Transition · Observation · Lens · Gap · History, plus Level, Budget and Seed.
// Meaning is not here: it is human interpretation, late-stage, derived — James's.
// Zero dependencies (E10): identity (ECF + SHA-256) and logical time are emerge's own (core/identity.js, core/clock.js);
// §2026-10-28 they were intelligence/rfr2's, from the Nexus tree above emerge/.

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
