'use strict';
/**
 * StreamLog — the audit trail. Shared across sub-streams.
 * Levels: OFF | EVENTS | DEEP | DATA
 * Direct port of SISO Core StreamLog.js to CommonJS.
 * UUID: siso-streamlog-0000-0000-4000-a000-000000000004
 */
const LEVELS = { OFF: 0, EVENTS: 1, DEEP: 2, DATA: 3 };
let streamIdCounter = 0;

class StreamLog {
  constructor(level = 'EVENTS') {
    this.level = level;
    this.entries = [];
    this.seq = 0;
  }
  record({ streamId, parentStreamId, eventType, gateClaimed, eventData }) {
    const lvl = LEVELS[this.level] || 0;
    if (lvl === 0) return;
    const entry = { seq: this.seq++, time: Date.now(), type: eventType, claimed: gateClaimed };
    if (lvl >= 2) { entry.streamId = streamId; if (parentStreamId != null) entry.parentStreamId = parentStreamId; }
    if (lvl >= 3) entry.data = eventData;
    this.entries.push(entry);
  }
  nextStreamId() { return ++streamIdCounter; }
  sample() { return { level: this.level, count: this.entries.length, entries: [...this.entries] }; }
  clear() { this.entries = []; this.seq = 0; }
}
module.exports = { StreamLog };
