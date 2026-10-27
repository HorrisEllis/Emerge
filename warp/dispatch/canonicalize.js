'use strict';
/**
 * canonicalize.js — v1.4 addition. Two separate things live here on
 * purpose, because they answer two different questions:
 *
 *   canonicalize(value)     -> "are these two values EXACTLY equal,
 *                               ignoring non-semantic noise?"
 *   fingerprint(value)      -> "are these two values SHAPED alike?"
 *   similarityScore(a, b)   -> "how alike are their shapes, 0..1?"
 *
 * The v1.4 patch doc asked for "deep AST normalization" with steps like
 * normalize_identifiers and flatten_equivalent_structures. Those are real
 * operations on *source code* (an actual AST) — proving two different-
 * looking code trees are semantically identical is a hard, separate
 * problem (constant folding, alpha-renaming, associativity, etc.) that a
 * generic reimplementation here cannot honestly claim to solve for
 * arbitrary languages. What WARP actually has is *event data* — plain
 * JSON-shaped values — so this module canonicalizes at that level:
 * deterministic key order, dropped non-semantic noise (undefined keys,
 * -0, trailing whitespace), nothing more. If a consumer wants real code
 * AST canonicalization, that belongs in a Gate-specific hook, not core.
 */

function canonicalize(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
  if (typeof value === 'string') return value.replace(/\s+$/g, '');
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);

  const sorted = {};
  for (const k of Object.keys(value).sort()) {
    const v = value[k];
    if (v === undefined) continue; // strip non-semantic "key present but undefined"
    sorted[k] = canonicalize(v);
  }
  return sorted;
}

/**
 * fingerprint(value) — walks the canonical structure and records
 * (path, type) pairs, discarding leaf *content*. Two payloads with the
 * same keys/nesting/types but different string or number values produce
 * the same fingerprint. This is deliberately coarser than the exact-cache
 * digest — it's the basis for fuzzy structural matching, never for a
 * cache hit that skips axiom checks on real content.
 */
function fingerprint(value, prefix = '$', out = new Set()) {
  const c = canonicalize(value);
  if (c === null) {
    out.add(`${prefix}:null`);
  } else if (Array.isArray(c)) {
    out.add(`${prefix}:array[${c.length}]`);
    c.forEach((item, i) => fingerprint(item, `${prefix}[${Math.min(i, 3)}]`, out)); // cap index buckets so long arrays don't blow up the set
  } else if (typeof c === 'object') {
    const keys = Object.keys(c).sort();
    out.add(`${prefix}:object{${keys.join(',')}}`);
    for (const k of keys) fingerprint(c[k], `${prefix}.${k}`, out);
  } else {
    out.add(`${prefix}:${typeof c}`);
  }
  return out;
}

function fingerprintKey(value) {
  return [...fingerprint(value)].sort().join('|');
}

/**
 * similarityScore(a, b) -> Jaccard index over the two fingerprint sets,
 * 0 (nothing alike) .. 1 (identical shape). This is what
 * pre_generation.structural_prediction.threshold compares against —
 * threshold 0.87 means "87% of structural (path,type) pairs match,"
 * a concrete, testable definition instead of an unstated one.
 */
function similarityScore(a, b) {
  const fa = fingerprint(a);
  const fb = fingerprint(b);
  if (fa.size === 0 && fb.size === 0) return 1;
  let intersection = 0;
  for (const item of fa) if (fb.has(item)) intersection++;
  const union = fa.size + fb.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

module.exports = { canonicalize, fingerprint, fingerprintKey, similarityScore };
