'use strict';
// emerge/core/seed.js — SEED (E7): one recorded seed per run; every random draw comes from it.
// component_id: emerge.core.seed
// Map: docs/2026-10-02-emerge-field-memory-build-phasemap.spec (EM1)
// mulberry32 — small, fast, deterministic. Two runs with one seed draw the same numbers in the same order.

function createSeed(seed) {
  if (!Number.isInteger(seed)) throw new TypeError('seed: an integer is required — a run without a recorded seed cannot be replayed');
  let s = seed >>> 0, draws = 0;
  const next = () => {
    draws++;
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.freeze({
    seed,
    next,
    int(n) { return Math.floor(next() * n); },
    /** id(prefix) — an id drawn from the seed, so ids replay too. */
    id(prefix) { return `${prefix}-${Math.floor(next() * 0xffffffff).toString(16).padStart(8, '0')}${Math.floor(next() * 0xffffffff).toString(16).padStart(8, '0')}`; },
    get draws() { return draws; },
  });
}

module.exports = { createSeed };
