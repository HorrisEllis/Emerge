'use strict';
// emerge/core/observation.js — OBSERVATION: evidence about states or transitions, with confidence, source and cost.
// component_id: emerge.core.observation
// Map: docs/2026-10-02-emerge-field-memory-build-phasemap.spec (EM1)

function _unit(name, v) {
  if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new RangeError(`observation: ${name} must be a number in [0..1], got ${v}`);
  return v;
}

function createObservation({ id, subject, value, confidence, source, cost = 0 }) {
  if (!subject) throw new TypeError('observation: subject is required — evidence is about something');
  if (!source) throw new TypeError('observation: source is required — evidence says where it came from');
  if (typeof cost !== 'number' || cost < 0) throw new RangeError(`observation: cost must be a number ≥ 0, got ${cost}`);
  return Object.freeze({ type: 'observation', id, subject, value, confidence: _unit('confidence', confidence), source, cost });
}

module.exports = { createObservation };
