'use strict';
/**
 * deltaCache.js — v1.4 "structural delta cache."
 *
 * Correcting scope up front: this is a STORAGE optimization, not a
 * generation-avoidance one. It doesn't reduce model calls — exact-cache
 * (crystallizer) and pre-generation matching (pregen.js) already own
 * that. What it reduces is bytes-at-rest for a population of near-
 * duplicate promoted outputs sharing a gate-class: store one base in
 * full, store every other member as a diff against that base, reconstruct
 * on read. The spec patch filed this under the same "cheaper/faster"
 * heading as the generation-avoidance mechanisms; it isn't the same kind
 * of saving and shouldn't be counted twice against the same multiplier.
 *
 * Diff format is a flat list of {path, op, value} ops (op: 'set'|'delete'),
 * computed by walking both canonicalized structures together — good
 * enough for JSON-shaped Gate outputs, not a general-purpose diff/patch
 * library (no dependency budget for one, per MANIFEST's zero-deps rule).
 */
const { canonicalize } = require('./canonicalize');

function computeDelta(base, target) {
  const b = canonicalize(base);
  const t = canonicalize(target);
  const ops = [];
  _diffWalk(b, t, '$', ops);
  return ops;
}

function _diffWalk(b, t, path, ops) {
  const bIsObj = b !== null && typeof b === 'object';
  const tIsObj = t !== null && typeof t === 'object';

  if (!bIsObj || !tIsObj || Array.isArray(b) !== Array.isArray(t)) {
    if (JSON.stringify(b) !== JSON.stringify(t)) ops.push({ path, op: 'set', value: t });
    return;
  }

  if (Array.isArray(b)) {
    // Arrays: compared element-by-element up to the longer length. Not
    // an LCS-based diff (that's real complexity for a zero-dependency
    // devkit) — a full replace of any array that changed length or
    // whose elements changed is honest and simple, not clever.
    if (b.length !== t.length) { ops.push({ path, op: 'set', value: t }); return; }
    for (let i = 0; i < t.length; i++) _diffWalk(b[i], t[i], `${path}[${i}]`, ops);
    return;
  }

  const bKeys = new Set(Object.keys(b));
  const tKeys = new Set(Object.keys(t));
  for (const k of bKeys) if (!tKeys.has(k)) ops.push({ path: `${path}.${k}`, op: 'delete' });
  for (const k of tKeys) _diffWalk(b[k], t[k], `${path}.${k}`, ops);
}

function applyDelta(base, ops) {
  const result = JSON.parse(JSON.stringify(canonicalize(base)));
  for (const op of ops) {
    const parts = _parsePath(op.path);
    if (op.op === 'delete') {
      _deleteAtPath(result, parts);
    } else {
      _setAtPath(result, parts, op.value);
    }
  }
  return result;
}

function _parsePath(path) {
  // '$.a.b[2].c' -> ['a', 'b', 2, 'c']
  const parts = [];
  const re = /\.([^.\[\]]+)|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(path)) !== null) {
    parts.push(m[1] !== undefined ? m[1] : Number(m[2]));
  }
  return parts;
}

function _setAtPath(obj, parts, value) {
  if (parts.length === 0) return value;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined) cur[parts[i]] = typeof parts[i + 1] === 'number' ? [] : {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function _deleteAtPath(obj, parts) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined) return;
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
}

/**
 * DeltaCrystallizer — wraps any base crystallizer (must implement
 * get/set), adds a delta layer per gate-class. First entry for a class
 * is stored in full as the base; every subsequent entry is stored as a
 * delta against it. Reconstruction cost (applying a diff) is paid on
 * read instead of on write — a real trade, not a free win, stated as one.
 */
class DeltaCrystallizer {
  constructor(baseStore) {
    if (!baseStore || typeof baseStore.get !== 'function' || typeof baseStore.set !== 'function') {
      throw new Error('[warp/DeltaCrystallizer] baseStore must implement get(key)/set(key,value)');
    }
    this._store = baseStore;
    this._bases = new Map(); // gateClass -> { digest, value }
  }

  get(digest) {
    const entry = this._store.get(digest);
    if (!entry) return null;
    if (entry.__delta) {
      const base = this._bases.get(entry.__baseClass);
      if (!base) return null; // base missing — cannot reconstruct, honest miss rather than a guess
      return applyDelta(base.value, entry.__ops);
    }
    return entry.__full !== undefined ? entry.__full : entry;
  }

  set(digest, value, gateClass = null) {
    if (!gateClass || !this._bases.has(gateClass)) {
      // Canonicalize before storing — computeDelta/applyDelta always work
      // on canonicalized structures, so the base must match that shape
      // too, or a later diff-then-reconstruct round trip won't equal
      // canonicalize(original) even though it's semantically the same
      // value (just different key order / raw non-canonical noise).
      const canonicalValue = canonicalize(value);
      if (gateClass) this._bases.set(gateClass, { digest, value: canonicalValue });
      this._store.set(digest, { __full: canonicalValue });
      return;
    }
    const base = this._bases.get(gateClass);
    const ops = computeDelta(base.value, value);
    this._store.set(digest, { __delta: true, __baseClass: gateClass, __ops: ops });
  }
}

module.exports = { computeDelta, applyDelta, DeltaCrystallizer };
