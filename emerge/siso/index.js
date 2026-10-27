'use strict';
const { Event }     = require('./Event.js');
const { Gate }      = require('./Gate.js');
const { Stream }    = require('./Stream.js');
const { StreamLog } = require('./StreamLog.js');
module.exports = { Event, Gate, Stream, StreamLog };

// ── Bus — named-stream factory with global listener support ──────────────────
// bus.onAny(fn)    — fn(event) called for every event emitted on ANY stream
// bus.offAny(fn)   — remove listener
// bus.onAnyOnce(fn)— fires once then auto-removes
class Bus {
  constructor() {
    this._streams   = new Map();
    this._listeners = new Set();
  }

  stream(name) {
    if (!this._streams.has(name)) {
      const s = new Stream();
      // Intercept emit so Bus.onAny listeners fire for every event on every stream
      const origEmit = s.emit.bind(s);
      s.emit = (event) => {
        origEmit(event);
        for (const fn of this._listeners) {
          try { fn(event); } catch(_) {}
        }
      };
      this._streams.set(name, s);
    }
    return this._streams.get(name);
  }

  // Register a listener for ALL events on ALL streams
  onAny(fn) {
    if (typeof fn !== 'function') throw new TypeError('bus.onAny: listener must be a function');
    this._listeners.add(fn);
    return this; // chainable
  }

  // Remove a previously registered onAny listener
  offAny(fn) {
    this._listeners.delete(fn);
    return this;
  }

  // Fire once then auto-remove
  onAnyOnce(fn) {
    const wrapper = (ev) => { fn(ev); this._listeners.delete(wrapper); };
    this._listeners.add(wrapper);
    return this;
  }

  // Get all stream names
  streams() { return [...this._streams.keys()]; }
}

module.exports = { Bus, Event, Gate, Stream, StreamLog };
