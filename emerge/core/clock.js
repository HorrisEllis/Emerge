'use strict';
// emerge/core/clock.js — logical time for the core: sequence numbers and ticks, no wall clock (CIE-EG 4.9).
// component_id: emerge.core.clock
// §2026-10-28 — replaces ../../../intelligence/rfr2/time (Nexus tree). Two runs with one seed count the same.

function createClock() {
  let seq = 0, tick = 0;
  return Object.freeze({
    nextSeq()  { return ++seq; },
    nextTick() { return ++tick; },
    get seq()  { return seq; },
    get tick() { return tick; },
  });
}

module.exports = { createClock };
