'use strict';
/**
 * Gate — pure transform. matches(event) -> bool, transform(event) -> Event[].
 *
 * v1.0.1 change: transform now RETURNS the events it produces instead of
 * calling stream.emit() as a side effect. A gate can be tested completely
 * in isolation — assert on the returned array, no Stream object needed at
 * all. Stream (below) is the only thing that calls emit(). This is the
 * stricter reading of "pure function" the SISO paper claims but the
 * original imperative emit-as-side-effect shape didn't fully enforce.
 */
class Gate {
  constructor(signature, { matches, transform, schema = null } = {}) {
    if (!signature || typeof signature !== 'string') {
      throw new Error('[warp/Gate] signature must be a non-empty string');
    }
    if (typeof transform !== 'function') {
      throw new Error(`[warp/Gate:${signature}] transform must be a function`);
    }
    this.signature = signature;
    this._matches = matches || ((event) => event.type === signature);
    this._transform = transform;
    // v1.1.0: optional structured-output contract. Deliberately NOT a
    // full JSON-Schema implementation — that's an external dependency,
    // which breaks "zero dependencies." { requiredKeys: [...], types: {k: 'string'|'number'|...} }
    // is enough to validate shape without importing anything.
    this.schema = schema;
  }

  matches(event) {
    return this._matches(event);
  }

  transform(event) {
    return this._transform(event);
  }

  /**
   * validates output against this.schema if one was declared.
   * Returns { ok, missing: [], wrongType: [] }. No schema = always ok.
   */
  validateOutput(output) {
    if (!this.schema) return { ok: true, missing: [], wrongType: [] };
    const missing = [];
    const wrongType = [];
    const required = this.schema.requiredKeys || [];
    const types = this.schema.types || {};
    for (const key of required) {
      if (output == null || !(key in output)) { missing.push(key); continue; }
      const expected = types[key];
      if (expected && typeof output[key] !== expected) wrongType.push({ key, expected, actual: typeof output[key] });
    }
    return { ok: missing.length === 0 && wrongType.length === 0, missing, wrongType };
  }
}

module.exports = { Gate };

