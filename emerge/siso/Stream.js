'use strict';
/**
 * Stream — the processing loop.
 * Gates register by signature. Events arrive via emit().
 * O(1) gate lookup. Depth-first transform. Unclaimed → pending.
 * Direct port of SISO Core Stream.js to CommonJS.
 * UUID: siso-stream-00000000-0000-4000-a000-000000000003
 *
 * Added: Stream.replay(log) — reconstruct a prior run from its StreamLog.
 */

const { Event } = require('./Event.js');

class Stream {
  constructor({ log = null, parentStreamId = null } = {}) {
    this.gates = new Map();
    this.pending = [];
    this.eventCount = 0;
    this.log = log;
    this.streamId = log ? log.nextStreamId() : null;
    this.parentStreamId = parentStreamId;
  }

  register(gate) {
    if (this.gates.has(gate.signature)) {
      throw new Error(`Signature collision: '${gate.signature}'`);
    }
    this.gates.set(gate.signature, gate);
  }

  emit(event) {
    this.eventCount++;
    const gate = this.gates.get(event.type);
    if (this.log) {
      this.log.record({
        streamId:       this.streamId,
        parentStreamId: this.parentStreamId,
        eventType:      event.type,
        gateClaimed:    gate ? gate.signature : null,
        eventData:      event.data,
      });
    }
    if (gate) {
      const result = gate.transform(event, this);
      // Support gates returning Event or Event[] (Jaa-style)
      // OR using stream.emit() directly (SISO Core style)
      if (result instanceof Event) { this.emit(result); }
      else if (Array.isArray(result)) {
        for (const e of result) if (e && e.type) this.emit(e);
      }
      // null / undefined = consumed
    } else {
      this.pending.push(event);
    }
  }

  sampleHere() {
    return {
      pending:    [...this.pending],
      eventCount: this.eventCount,
      gateCount:  this.gates.size,
    };
  }

  /**
   * Stream.replay(log, replayStream)
   *
   * Reconstruct a prior run by re-emitting every event recorded in a
   * StreamLog into replayStream (or a new bare stream if none provided).
   *
   * CONTRACT:
   *   - Stateless. No file I/O, no HTTP, no side effects.
   *   - Requires log.level === 'DATA' (payloads must be present).
   *   - Re-emits events in recorded sequence order.
   *   - Gates in replayStream receive the original event data.
   *   - Returns replayStream.sampleHere() after all events are re-emitted.
   *
   * WHY:
   *   The log records decisions, not text. Re-playing it reconstructs the
   *   exact sequence of transformations. Every compile run is auditable,
   *   diff-able, and replayable from its log alone.
   *   (Jonathan Bailey's review, point 3.)
   *
   * USAGE:
   *   // Record a run
   *   const { stream, log } = createPipeline('DATA');
   *   await driveAsync(stream, seedEvent);
   *
   *   // Later: replay into a fresh observation stream
   *   const replayResult = Stream.replay(log);
   *   // replayResult.pending contains all events that were 'pending'
   *   // in the original run, in the same order.
   *
   * LIMITATIONS:
   *   - Replay does not re-execute gate logic (no gates registered on
   *     the replay stream by default). It re-emits events — all land
   *     in pending unless you register gates on the replayStream.
   *   - If you want to re-execute logic, register the same gates on
   *     replayStream before calling replay().
   *   - Requires DATA level log. EVENTS level does not store payloads.
   */
  static replay(log, replayStream = null) {
    const sample = log.sample();

    if (!sample.entries.length) {
      return { ok: true, replayed: 0, pending: [], note: 'log was empty' };
    }

    // Check that payloads are present (DATA level requirement)
    const hasPayloads = sample.entries.some(e => e.data !== undefined);
    if (!hasPayloads && sample.level !== 'DATA') {
      return {
        ok:    false,
        error: `Stream.replay requires log level 'DATA' (payloads needed). Current level: '${sample.level}'.`,
        tip:   "Create pipeline with createPipeline('DATA') to enable replay.",
      };
    }

    // Use provided replayStream or create a bare one (no gates → all events land in pending)
    const target = replayStream ?? new Stream();

    // Re-emit in sequence order (entries are already sorted by seq)
    const sorted = [...sample.entries].sort((a, b) => a.seq - b.seq);
    for (const entry of sorted) {
      const event = new Event(entry.type, entry.data ?? {});
      target.emit(event);
    }

    return {
      ok:       true,
      replayed: sorted.length,
      ...target.sampleHere(),
    };
  }
}

module.exports = { Stream };
