'use strict';
/**
 * Event — a datum flowing through the stream.
 * Immutable. type is its signature. data is arbitrary.
 * Direct port of SISO Core Event.js to CommonJS.
 * UUID: siso-event-00000000-0000-4000-a000-000000000001
 */
class Event {
  constructor(type, data = {}) {
    this.type = type;
    this.data = data;
    Object.freeze(this.data); // Events are immutable — enforce it
  }
}
module.exports = { Event };
