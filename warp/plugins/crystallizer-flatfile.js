'use strict';
/**
 * crystallizer-flatfile.js — default storage adapter for the exact-cache.
 * Trivial in-memory + optional flat-file persistence. A consuming project
 * swaps this for its own adapter (e.g. NEXUS's JAA) without core ever
 * changing — this file lives outside core/ specifically so it's optional.
 */
const fs = require('fs');

class FlatFileCrystallizer {
  constructor({ path = null } = {}) {
    this._path = path;
    this._store = new Map();
    if (path && fs.existsSync(path)) {
      try {
        const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
        for (const [k, v] of Object.entries(raw)) this._store.set(k, v);
      } catch (_) { /* corrupt or empty — start fresh, never crash boot */ }
    }
  }

  get(digest) {
    return this._store.has(digest) ? this._store.get(digest) : null;
  }

  set(digest, value) {
    this._store.set(digest, value);
    if (this._path) {
      const obj = Object.fromEntries(this._store);
      fs.writeFileSync(this._path, JSON.stringify(obj, null, 2));
    }
  }

  /**
   * invalidate(digest) — rollback. A promoted crystal found wrong later
   * (an axiom bug that let something bad through, later fixed) needs a
   * way to be un-promoted. Without this, correctness could only ever
   * improve by luck of the axiom version bump orphaning the old digest —
   * the bad entry would sit in the store forever, unreachable but never
   * actually gone. This makes removal explicit and logged by the caller,
   * never silent.
   */
  invalidate(digest) {
    const existed = this._store.has(digest);
    this._store.delete(digest);
    if (existed && this._path) {
      const obj = Object.fromEntries(this._store);
      fs.writeFileSync(this._path, JSON.stringify(obj, null, 2));
    }
    return existed;
  }

  size() {
    return this._store.size;
  }
}

module.exports = { FlatFileCrystallizer };
