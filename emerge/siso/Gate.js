'use strict';
/**
 * Gate — recognises one event type, transforms it.
 * Signature is unique per stream. O(1) lookup.
 * Direct port of SISO Core Gate.js to CommonJS.
 * UUID: siso-gate-000000000-0000-4000-a000-000000000002
 */
class Gate {
  constructor(signature) {
    this.signature = signature;
  }
  /** Override. Return Event | Event[] | null. null = consumed. */
  transform(event, stream) {}
}
module.exports = { Gate };
