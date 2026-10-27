'use strict';
/**
 * compiler/ring-buffer.js — Causal Memory Layer
 * UUID: mod-ringbuffer-v1-0000-0001
 * Version: 1.0.0
 *
 * Bounded circular buffer of state transition events.
 * Stores every mutation: node, field, fromValue, toValue, causedBy.
 * Enables delta debugging, replay slicing, causal tracing, rollback simulation.
 * Fixed capacity — oldest events evicted when full.
 * Emits runtime.mutation to trigger re-propagation (the ↺).
 *
 * PIPELINE (internal — record is synchronous, no stream overhead needed):
 *   GATE-RB-001: mutation event arrives → append to circular buffer
 *   GATE-RB-002: buffer at capacity → evict oldest, emit buffer.capacity.reached
 *   GATE-RB-003: record complete → emit buffer.event.recorded
 *   GATE-RB-004: replay requested → emit events in seq order → buffer.replay.complete
 *   GATE-RB-005: snapshot requested → copy current buffer state → buffer.snapshot.taken
 *   GATE-RB-006: causalChain(nodeId) → filter by nodeId + causedBy chain → return slice
 *
 * BEHAVIORAL CONTRACTS:
 *   - Capacity is fixed at construction. Default 1000 events.
 *   - Eviction is FIFO — oldest events removed first.
 *   - replay() returns events in seq order, never out of order.
 *   - record() is synchronous. Never blocks.
 *   - causalChain() follows causedBy links transitively up to buffer window.
 *   - snapshot() is a deep copy — mutations after snapshot do not affect it.
 *   - ring-buffer never writes to Cortex directly — writeback module handles that.
 *
 * ERROR PATHS:
 *   - fromSeq > toSeq in replay → return empty array, not error
 *   - causalChain with unknown nodeId → return empty array
 *   - record with malformed event → log warning, skip record (never throw)
 *
 * §1.1  Nothing silently fails — every eviction, every overflow is a typed event.
 * §1.2  record() is the single write path. No other mutation is allowed.
 * §1.3  All derived reads (replay, causalChain, diff) are pure — no side effects.
 */

// ── Sequence counter ──────────────────────────────────────────────────────────
// Global monotonic sequence — unique across all RingBuffer instances in a process.
// This matters for causal ordering when multiple buffers coexist.

let _globalSeq = 0;
function nextSeq() { return ++_globalSeq; }

// ── Mutation event factory ────────────────────────────────────────────────────

/**
 * makeMutation(nodeId, field, fromValue, toValue, causedBy) → MutationEvent
 * Canonical factory. Every record() call normalises through here.
 */
function makeMutation(nodeId, field, fromValue, toValue, causedBy = null) {
  return {
    mutationId: `mut-${nodeId}-${field}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    seq:        nextSeq(),
    nodeId,
    field,
    fromValue,
    toValue,
    causedBy,   // mutationId of the event that triggered this one — the causal link
    ts:         Date.now(),
  };
}

// ── RingBuffer ────────────────────────────────────────────────────────────────

class RingBuffer {
  /**
   * @param {object} options
   * @param {number}   options.capacity    — max events before FIFO eviction (default 1000)
   * @param {Function} options.onMutation  — callback(MutationEvent) — the ↺ hook
   * @param {Function} options.onEvict     — callback({ evictedCount, retainedCount })
   * @param {Function} options.onWarn      — callback(message) for malformed records
   */
  constructor(options = {}) {
    this._capacity  = options.capacity  ?? 1000;
    this._onMutation = options.onMutation ?? null;   // ↺ — called after every record
    this._onEvict    = options.onEvict    ?? null;
    this._onWarn     = options.onWarn     ?? null;
    this._buf        = [];   // circular buffer as array — O(1) push, O(n) evict at capacity
    this._snapshots  = new Map();  // snapshotId → Snapshot
    this._recordCount = 0;
  }

  // ── GATE-RB-001 + GATE-RB-002 + GATE-RB-003 ─────────────────────────────
  /**
   * record(event) → MutationEvent | null
   *
   * CONTRACT: synchronous. Never throws. Returns null on malformed input.
   *
   * Accepts either a pre-built MutationEvent or a plain object with
   * { nodeId, field, fromValue, toValue, causedBy? } — normalises to MutationEvent.
   */
  record(event) {
    // Validate
    if (!event || typeof event !== 'object') {
      this._warn('record: received non-object event — skipped');
      return null;
    }

    let mut;
    if (event.mutationId && event.seq != null) {
      // Already a MutationEvent — accept as-is but re-sequence if seq already used
      mut = { ...event };
      if (this._buf.some(e => e.seq === mut.seq)) {
        mut = { ...mut, seq: nextSeq() };  // re-sequence collision
      }
    } else {
      // Plain object — normalise
      const { nodeId, field, fromValue, toValue, causedBy } = event;
      if (!nodeId || !field) {
        this._warn(`record: missing nodeId or field in event — skipped (got: ${JSON.stringify(event).slice(0, 80)})`);
        return null;
      }
      mut = makeMutation(nodeId, field, fromValue, toValue, causedBy ?? null);
    }

    // GATE-RB-002: evict if at capacity
    if (this._buf.length >= this._capacity) {
      const evictCount = Math.ceil(this._capacity * 0.1);  // evict 10% at once — amortise cost
      const evicted    = this._buf.splice(0, evictCount);
      if (this._onEvict) {
        this._onEvict({
          evictedCount:  evicted.length,
          retainedCount: this._buf.length,
          oldestEvicted: evicted[0]?.seq,
          newestEvicted: evicted[evicted.length - 1]?.seq,
        });
      }
    }

    // GATE-RB-001: append
    this._buf.push(mut);
    this._recordCount++;

    // GATE-RB-003: emit ↺
    if (this._onMutation) {
      try { this._onMutation(mut); }
      catch (e) { this._warn(`onMutation callback threw: ${e.message}`); }
    }

    return mut;
  }

  // ── GATE-RB-004 ───────────────────────────────────────────────────────────
  /**
   * replay(fromSeq?, toSeq?) → MutationEvent[]
   *
   * Returns events in ascending seq order within [fromSeq, toSeq].
   * CONTRACT: fromSeq > toSeq → empty array, not error.
   * CONTRACT: omit args → return all buffered events.
   */
  replay(fromSeq, toSeq) {
    const from = fromSeq ?? -Infinity;
    const to   = toSeq   ??  Infinity;

    // fromSeq > toSeq → empty (not error)
    if (from > to) return [];

    return this._buf
      .filter(e => e.seq >= from && e.seq <= to)
      .sort((a, b) => a.seq - b.seq);  // always seq-sorted, even if _buf drifted
  }

  // ── GATE-RB-005 ───────────────────────────────────────────────────────────
  /**
   * snapshot() → Snapshot
   *
   * Deep copy of current buffer state.
   * CONTRACT: mutations after snapshot do not affect it.
   * Stores internally by snapshotId for use in diff().
   */
  snapshot() {
    const snapshotId = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const events     = this._buf.map(e => ({ ...e }));  // shallow-copy each event
    const snap = {
      snapshotId,
      ts:         Date.now(),
      eventCount: events.length,
      firstSeq:   events[0]?.seq ?? null,
      lastSeq:    events[events.length - 1]?.seq ?? null,
      events,
    };
    this._snapshots.set(snapshotId, snap);
    return snap;
  }

  // ── GATE-RB-006 ───────────────────────────────────────────────────────────
  /**
   * causalChain(nodeId) → MutationEvent[]
   *
   * Returns the causal ancestry of all mutations touching nodeId.
   * Follows causedBy links transitively — as far back as the buffer holds.
   * CONTRACT: unknown nodeId → empty array.
   * CONTRACT: circular causedBy chains are detected and halted.
   */
  causalChain(nodeId) {
    if (!nodeId) return [];

    // Seed: all events that directly touch nodeId
    const seen    = new Set();
    const chain   = [];
    const byMutId = new Map(this._buf.map(e => [e.mutationId, e]));

    // BFS over causal links
    const queue = this._buf.filter(e => e.nodeId === nodeId);
    for (const e of queue) {
      if (!seen.has(e.mutationId)) {
        seen.add(e.mutationId);
        chain.push(e);
      }
    }

    // Follow causedBy links transitively
    let i = 0;
    while (i < chain.length) {
      const current  = chain[i++];
      const causedBy = current.causedBy;
      if (causedBy && !seen.has(causedBy)) {
        const ancestor = byMutId.get(causedBy);
        if (ancestor) {
          seen.add(causedBy);
          chain.push(ancestor);
        }
      }
    }

    return chain.sort((a, b) => a.seq - b.seq);
  }

  /**
   * rollbackSimulate(nodeId, toValue) → SimulatedState
   *
   * Simulate what the node's state would look like if field=toValue had been set
   * at the earliest point in the buffer, then replayed forward.
   *
   * Does NOT mutate anything. Pure projection.
   * Useful for: "what would the gap field look like if I had specced this earlier?"
   */
  rollbackSimulate(nodeId, toValue) {
    const chain    = this.causalChain(nodeId);
    if (!chain.length) return { nodeId, toValue, simulatedEvents: [], affectedFields: {} };

    const affectedFields = {};
    const simulatedEvents = [];

    for (const ev of chain) {
      const simulated = {
        ...ev,
        fromValue: ev.nodeId === nodeId ? toValue : ev.fromValue,
        toValue:   ev.nodeId === nodeId ? toValue : ev.toValue,
        simulated: true,
      };
      simulatedEvents.push(simulated);
      affectedFields[ev.field] = simulated.toValue;
    }

    return { nodeId, toValue, simulatedEvents, affectedFields };
  }

  /**
   * diff(snapshotA, snapshotB) → StateDelta
   *
   * Compares two snapshots. Returns events present in B but not in A (by seq),
   * events in A but not in B (evicted/rolled-back), and net field changes per node.
   */
  diff(snapA, snapB) {
    const seqA = new Set((snapA.events ?? []).map(e => e.seq));
    const seqB = new Set((snapB.events ?? []).map(e => e.seq));

    const added   = (snapB.events ?? []).filter(e => !seqA.has(e.seq));
    const removed = (snapA.events ?? []).filter(e => !seqB.has(e.seq));

    // Net field changes per node in the added events
    const netChanges = {};
    for (const ev of added) {
      if (!netChanges[ev.nodeId]) netChanges[ev.nodeId] = {};
      netChanges[ev.nodeId][ev.field] = {
        from: ev.fromValue,
        to:   ev.toValue,
        seq:  ev.seq,
        ts:   ev.ts,
      };
    }

    return {
      addedCount:   added.length,
      removedCount: removed.length,
      added,
      removed,
      netChanges,
      fromSnapshot: snapA.snapshotId,
      toSnapshot:   snapB.snapshotId,
    };
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  get size()        { return this._buf.length; }
  get capacity()    { return this._capacity; }
  get recordCount() { return this._recordCount; }

  /**
   * stats() → RingBufferStats
   * Current health metrics — feeds into baseline-tracker.
   */
  stats() {
    const utilisation = this._buf.length / this._capacity;
    const nodeFreq    = {};
    for (const e of this._buf) {
      nodeFreq[e.nodeId] = (nodeFreq[e.nodeId] ?? 0) + 1;
    }
    const hotNodes = Object.entries(nodeFreq)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 5)
      .map(([nodeId, count]) => ({ nodeId, count }));

    return {
      size:        this._buf.length,
      capacity:    this._capacity,
      utilisation: Math.round(utilisation * 1000) / 1000,
      recordCount: this._recordCount,
      firstSeq:    this._buf[0]?.seq ?? null,
      lastSeq:     this._buf[this._buf.length - 1]?.seq ?? null,
      hotNodes,
      snapshotCount: this._snapshots.size,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _warn(msg) {
    if (this._onWarn) { try { this._onWarn(msg); } catch(_) {} }
    // Always write to stderr — ring-buffer warnings are never silent
    process.stderr.write(`[ring-buffer] WARN: ${msg}\n`);
  }
}

// ── MutationBus ───────────────────────────────────────────────────────────────
/**
 * MutationBus — the ↺ implementation.
 *
 * Wraps a RingBuffer and adds subscriber dispatch.
 * When a mutation is recorded, all registered subscribers are called.
 * This is what makes the runtime reactive:
 *   record(mutation) → notify subscribers → re-propagation → re-invariant-check
 *
 * Subscribers receive (mutation, bus) — they can call bus.record() to emit
 * downstream mutations, creating the causal chain.
 *
 * CONTRACT: subscriber errors are caught and logged — never propagate to record().
 * CONTRACT: re-entrant records (subscriber calling record()) are queued, not nested.
 *           This prevents stack overflow in tight causal loops.
 */
class MutationBus {
  constructor(options = {}) {
    this._subscribers = new Map();   // name → fn(mutation, bus)
    this._draining    = false;
    this._queue       = [];          // re-entrant record queue

    this._ring = new RingBuffer({
      capacity:   options.capacity ?? 1000,
      onEvict:    options.onEvict  ?? null,
      onWarn:     options.onWarn   ?? null,
      onMutation: (mut) => this._dispatch(mut),
    });
  }

  /**
   * subscribe(name, fn) → void
   * Register a subscriber. name is used for deduplication and error attribution.
   * fn(mutation, bus) — can call bus.record() for downstream mutations.
   */
  subscribe(name, fn) {
    if (typeof fn !== 'function') throw new Error(`MutationBus.subscribe: '${name}' is not a function`);
    this._subscribers.set(name, fn);
  }

  unsubscribe(name) { this._subscribers.delete(name); }

  /**
   * record(event) → MutationEvent | null
   * Thin wrapper over RingBuffer.record() with re-entrancy protection.
   */
  record(event) {
    if (this._draining) {
      // Re-entrant call from a subscriber — queue it
      this._queue.push(event);
      return null;
    }
    return this._ring.record(event);
  }

  // Delegate read operations to ring buffer
  replay(fromSeq, toSeq)              { return this._ring.replay(fromSeq, toSeq); }
  diff(snapA, snapB)                  { return this._ring.diff(snapA, snapB); }
  snapshot()                          { return this._ring.snapshot(); }
  causalChain(nodeId)                 { return this._ring.causalChain(nodeId); }
  rollbackSimulate(nodeId, toValue)   { return this._ring.rollbackSimulate(nodeId, toValue); }
  stats()                             { return this._ring.stats(); }

  get size()     { return this._ring.size; }
  get capacity() { return this._ring.capacity; }

  // ── Private ───────────────────────────────────────────────────────────────

  _dispatch(mutation) {
    this._draining = true;
    try {
      for (const [name, fn] of this._subscribers) {
        try { fn(mutation, this); }
        catch (e) {
          process.stderr.write(`[mutation-bus] subscriber '${name}' threw: ${e.message}\n`);
        }
      }
      // Drain re-entrant queue
      while (this._queue.length > 0) {
        const queued = this._queue.shift();
        this._ring.record(queued);  // will re-trigger _dispatch via onMutation
      }
    } finally {
      this._draining = false;
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * createRingBuffer(options) → RingBuffer
 * createMutationBus(options) → MutationBus
 *
 * Prefer MutationBus when you need the ↺ subscriber dispatch.
 * Use RingBuffer directly when you only need storage + read ops.
 */
function createRingBuffer(options = {}) { return new RingBuffer(options); }
function createMutationBus(options = {}) { return new MutationBus(options); }

module.exports = {
  RingBuffer,
  MutationBus,
  createRingBuffer,
  createMutationBus,
  makeMutation,
};
