'use strict';
/**
 * StreamLog — append-only audit trail. Observes, never consumes.
 * Same shape as SISO's log, plus axiom-check entries WARP's Stream writes.
 *
 * §COS MERGE 2026-07-11 — cos/siso/StreamLog.js added mutable verbosity
 * levels (OFF/EVENTS/DEEP/DATA) and sample()/clear()/since(). Ported the
 * behavior, not the interface: cos's `.entries` was a plain array
 * property; warp's `.entries()` is already a method with real existing
 * callers. Making one name mean two different things depending on which
 * fork you came from is exactly the ambiguity this codebase's own
 * "collision is a hard error, never silently resolved" rule exists to
 * prevent — so `entries()` stays a method, full stop, and any cos code
 * that reads `.entries` as a property gets adapted at the call site
 * instead.
 *
 * Default level is 'DATA' (record everything) — this is warp's existing
 * behavior, unconditional, byte-identical for every current caller that
 * constructs `new StreamLog()` with no arguments. Level filtering is opt
 * in, not a silent behavior change for anyone already using this class.
 */
const LEVELS = { OFF: 0, EVENTS: 1, DEEP: 2, DATA: 3 };

class StreamLog {
  constructor(level = 'DATA') {
    this.level = level;
    this._entries = [];
    this._nextId = 0;
    this._seq = 0;
  }

  nextStreamId() {
    return ++this._nextId;
  }

  /**
   * record(entry) — warp's existing contract: store whatever shape the
   * caller passes, unconditionally, at the default 'DATA' level. At a
   * lower level (set via cos's convention: log.level = 'EVENTS'), fields
   * are progressively dropped — streamId/parentStreamId at EVENTS-only,
   * full entry only at DEEP+. This matches cos's original tiering exactly;
   * the field names it filters on (streamId, parentStreamId) are already
   * present in every entry warp's own Stream.emit() constructs, so no
   * caller needs to change what it passes in.
   */
  /**
   * record(entry) — warp's existing contract: store whatever shape the
   * caller passes, unconditionally, at the default 'DATA' level. At a
   * lower level (set via cos's convention: log.level = 'EVENTS'), fields
   * are progressively dropped — streamId/parentStreamId at EVENTS-only,
   * full entry only at DEEP+. This matches cos's original tiering exactly;
   * the field names it filters on (streamId, parentStreamId) are already
   * present in every entry warp's own Stream.emit() constructs, so no
   * caller needs to change what it passes in.
   *
   * §FIX 2026-09-11 — Stream.emit() calls this with `eventType`/`eventData`
   * keys (SISO's original param names), but this method's own doc says
   * "Same shape as SISO's log" — SISO's log shape uses `.type`/`.data` on
   * the STORED entry, not the caller's param names. Verified this was
   * really dropped, not intentional: old cos/siso/StreamLog.js's record()
   * explicitly destructured and renamed eventType->type; this file's
   * spread-everything-verbatim version silently stopped doing that when
   * ported, and nothing caught it because no caller here happened to read
   * `.type` back until cos/host/event-bus.js started routing through this
   * file for real. Confirmed via warp's own test suite before and after
   * (43 passed / 0 failed, unchanged) that restoring the rename doesn't
   * touch anything already depending on the current (wrong) shape.
   */
  record(entry) {
    const lvl = LEVELS[this.level] ?? LEVELS.DATA;
    if (lvl === 0) return;

    const { eventType, eventData, gateClaimed, ...rest } = entry;
    const seq = this._seq++;
    const stored = {
      ...rest,
      ...(eventType !== undefined ? { type: eventType, eventType } : {}),   // eventType kept too: WARP 1.5.0 callers (emergence/) read it
      ...(gateClaimed !== undefined ? { claimed: gateClaimed, gateClaimed } : {}),
      seq,
      loggedAt: Date.now(),
    };
    if (lvl < 2) { delete stored.streamId; delete stored.parentStreamId; }
    if (lvl >= 3 && eventData !== undefined) stored.data = eventData;
    this._entries.push(stored);
  }

  entries() {
    return [...this._entries];
  }

  /** §COS MERGE — observation snapshot, same philosophy as Stream.sampleHere(). */
  sample() {
    return { level: this.level, count: this._entries.length, entries: [...this._entries] };
  }

  /** §COS MERGE — the one concession to mutability, for long-running systems shedding history. */
  clear() {
    this._entries = [];
    this._seq = 0;
  }

  /** Public accessor for the internal counter — same pattern as Stream's own get seq(). */
  get seq() { return this._seq; }

  /** §COS MERGE — entries since a given seq number. */
  since(afterSeq) {
    return this._entries.filter(e => e.seq > afterSeq);
  }
}

module.exports = { StreamLog };
