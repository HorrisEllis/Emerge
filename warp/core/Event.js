'use strict';
/**
 * Event — immutable data packet. { type, data, uuid, ts }.
 * Never mutated after creation. Matches SISO's Event shape exactly —
 * this primitive isn't where WARP differs from SISO.
 */
function _uid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

class Event {
  constructor(type, data = {}) {
    if (!type || typeof type !== 'string') {
      throw new Error('[warp/Event] type must be a non-empty string');
    }
    this.type = type;
    this.data = Object.freeze({ ...data });
    this.uuid = _uid();
    this.ts = Date.now();
    Object.freeze(this);
  }
}

module.exports = { Event };
