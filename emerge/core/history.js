'use strict';
// emerge/core/history.js — HISTORY: constraint-consistent transition paths. Append-only, hash-chained.
// component_id: emerge.core.history
// Map: docs/2026-10-02-emerge-field-memory-build-phasemap.spec (EM1)
// Each entry carries the hash of the one before (like lib/nexstore/log.js). Logical ticks only — no wall time — so two
// runs with one seed write byte-identical histories. Hashing is emerge's own (core/identity.js: ECF + full SHA-256);
// §2026-10-28 it was intelligence/rfr2's 64-bit hash, from the Nexus tree above emerge/.

const { canonicalize, hash: hash64 } = require('./identity');
const { createClock } = require('./clock');

function createHistory() {
  const entries = [];
  const clock = createClock();
  return Object.freeze({
    append(kind, body) {
      const prev = entries.length ? entries[entries.length - 1].hash : null;
      const core = { seq: clock.nextSeq(), tick: clock.nextTick(), kind, body: body ?? null, prev };
      const entry = Object.freeze({ ...core, hash: hash64(canonicalize(core)) });
      entries.push(entry);
      return entry;
    },
    entries() { return entries.slice(); },
    get length() { return entries.length; },
    get lastHash() { return entries.length ? entries[entries.length - 1].hash : null; },
    /** verify() -> { ok, brokenAt } — every link and every hash recomputed. */
    verify() {
      let prev = null;
      for (const e of entries) {
        const { hash, ...core } = e;
        if (e.prev !== prev || hash64(canonicalize(core)) !== hash) return { ok: false, brokenAt: e.seq };
        prev = hash;
      }
      return { ok: true, brokenAt: null };
    },
    toJSON() { return entries.slice(); },
  });
}

module.exports = { createHistory };
