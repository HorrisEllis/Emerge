'use strict';
/**
 * Stream — the dispatch loop. Same O(1) signature-lookup discipline as
 * SISO's Stream. The addition: every transform runs through registered
 * Axioms first. A hard-axiom failure rejects the transform — logged,
 * event routed to `rejected`, never silently completed and never
 * silently dropped (both are failure modes; this distinguishes them).
 *
 * hook(kind, plugin) is the one extension point — scorer/crystallizer/
 * cascader all attach here, all pure-function-shaped like Gate, no
 * special-casing per kind.
 *
 * §COS MERGE 2026-07-11 — cos/siso/Stream.js forked from base SISO and
 * added a ring buffer (tail/since for late-joining SSE clients and cos's
 * events CLI), deregister() (compartment teardown), and direct SSE
 * broadcast. Checked before merging: cos's own header already called
 * these "COS extension over base SISO" — they were written as additions
 * from day one, not a competing redesign. Ported verbatim, nothing of
 * warp's existing axiom/hook/observer machinery touched.
 *
 * The one behavior change: gate.transform(event) is now called as
 * gate.transform(event, this). Safe for every existing warp gate — an
 * extra argument to a function that only declares one parameter is
 * simply ignored in JS, not an error — and required for cos's real gates
 * (cos/host/gates/*.js, 30+ of them), which call `stream.emit(...)`
 * imperatively from inside transform() using that second argument.
 * Checked: none of warp's own gates read a second parameter, so this
 * cannot change anything for them.
 */
const DEFAULT_RING_CAP = 500;

class Stream {
  constructor({ log = null, parentStreamId = null, axioms = [], ringCap = DEFAULT_RING_CAP } = {}) {
    this.gates = new Map();
    this.axioms = [...axioms];
    this.pending = [];
    this.rejected = []; // NEW vs SISO: axiom failures land here, not pending
    this.eventCount = 0;
    this.log = log;
    this.streamId = log ? log.nextStreamId() : null;
    this.parentStreamId = parentStreamId;
    this._hooks = { scorer: [], crystallizer: [], cascader: [] };
    this._observers = new Map(); // event type -> [handler] — pub/sub, separate from gate routing

    // §COS MERGE — ring buffer + SSE, ported from cos/siso/Stream.js
    this._seq        = 0;
    this._ringCap    = ringCap;
    this._ring       = [];      // circular buffer of stamped events
    this._wildcards  = [];      // onAny() observers — read-only, not gates
    this._sseClients = new Set();
  }

  register(gate) {
    if (this.gates.has(gate.signature)) {
      throw new Error(`[warp/Stream] Signature collision: '${gate.signature}'`);
    }
    this.gates.set(gate.signature, gate);
  }

  /**
   * Unregister a gate by signature. No-op if not found.
   * §COS MERGE — used by cos when compartments are destroyed and their
   * gates deregistered. Warp itself never removes a gate once registered
   * (no prior caller needed this) so this is additive, not a behavior
   * change for any existing warp consumer.
   */
  deregister(signature) {
    this.gates.delete(signature);
  }

  /**
   * on(type, handler) — observe every event of a given type as it passes
   * through emit(), without owning a gate for it. A caller that wants a
   * live feed (a UI, a logger) registers here instead of registering a
   * competing Gate for the same signature, which would throw on
   * collision. An observer's own error is caught and swallowed — same
   * §1.2-shaped guarantee as axiom-check failures: something watching
   * must never be able to break something running.
   */
  on(type, handler) {
    if (!this._observers.has(type)) this._observers.set(type, []);
    this._observers.get(type).push(handler);
    return () => {
      const arr = this._observers.get(type) || [];
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  /**
   * onAny(fn) — §COS MERGE. Subscribe to every event regardless of type,
   * as a read-only observer. Distinct from on(type, handler) above (which
   * is per-type warp pub/sub, already existed) — this is cos's wildcard
   * fan-out, used for the events CLI and SSE relay. Kept as a separate
   * method rather than overloading on() with an optional type — two
   * different call shapes on one method name is exactly the kind of
   * ambiguity this codebase's own "collision is a hard error" rule warns
   * against; two named methods, no ambiguity.
   */
  onAny(fn) {
    this._wildcards.push(fn);
    return () => {
      this._wildcards = this._wildcards.filter(f => f !== fn);
    };
  }

  registerAxiom(axiom) {
    this.axioms.push(axiom);
  }

  hook(kind, plugin) {
    if (!this._hooks[kind]) {
      throw new Error(`[warp/Stream] unknown hook kind: '${kind}'`);
    }
    if (typeof plugin !== 'function') {
      throw new Error(`[warp/Stream] hook '${kind}' plugin must be a function`);
    }
    this._hooks[kind].push(plugin);
  }

  hooks(kind) {
    return this._hooks[kind] ? [...this._hooks[kind]] : [];
  }

  /**
   * Run all hard axioms against a gate about to fire on an event.
   * Returns { ok: bool, failures: [{ axiomId, severity }] }.
   * Soft-axiom failures are recorded but never block.
   */
  _checkAxioms(event, gate) {
    const failures = [];
    for (const axiom of this.axioms) {
      let passed;
      try {
        passed = !!axiom.check(event, gate, this.sampleHere());
      } catch (e) {
        // §1.2-equivalent: an axiom that throws is a failure, not a pass.
        passed = false;
      }
      if (!passed) failures.push({ axiomId: axiom.id, severity: axiom.severity });
    }
    const hardFail = failures.some(f => f.severity === 'hard');
    return { ok: !hardFail, failures };
  }

  /**
   * emit(event) — synchronous when every gate.transform() on the path is
   * synchronous (byte-identical to the pre-2026-07-06 behavior: void
   * return, throws propagate synchronously, loom/schema/driver.js's
   * `stream.emit(event)` followed by its own redundant `gate.transform()`
   * call keeps working exactly as it does today). Returns a Promise only
   * when a transform on the path actually returned one — an async gate's
   * caller can `await stream.emit(event)` to know when it's really done;
   * a sync caller that never awaits anything sees no behavior change at
   * all, because until an async gate exists on the path, nothing here
   * ever returns a thenable.
   *
   * §WHY NOT BLANKET async emit() — checked a real, current consumer
   * first (loom/schema/driver.js): it calls stream.emit(event) unawaited
   * today and relies on errors propagating synchronously. A blanket
   * `async emit()` would silently convert that into an unhandled promise
   * rejection instead of a catchable throw — a real regression for the
   * one system already using this as its backbone, not a hypothetical.
   *
   * §COS MERGE 2026-07-11 — every emission now also: stamps into the ring
   * buffer, fires wildcard (onAny) observers, and broadcasts to any
   * subscribeSSE() clients. All three are additive side effects that run
   * regardless of axiom/gate outcome — matching cos's original behavior
   * where ring/wildcard/SSE saw every event unconditionally, not just
   * claimed ones.
   */
  emit(event) {
    this.eventCount++;
    const seq = ++this._seq;

    const stamped = {
      seq,
      type: event.type,
      payload: event.data,
      timestamp: Date.now(),
    };
    this._ring.push(stamped);
    if (this._ring.length > this._ringCap) this._ring.shift();
    for (const fn of this._wildcards) {
      try { fn(stamped); } catch (_) { /* an observer's error never breaks the stream */ }
    }
    this._broadcastSSE(stamped);

    for (const handler of this._observers.get(event.type) || []) {
      try { handler(event); } catch (_) { /* an observer's error never breaks the stream */ }
    }
    const gate = this.gates.get(event.type);

    if (!gate) {
      if (this.log) {
        this.log.record({
          streamId: this.streamId, parentStreamId: this.parentStreamId,
          eventType: event.type, gateClaimed: null, axiomResult: null,
        });
      }
      this.pending.push(event);
      return;
    }

    const axiomResult = this._checkAxioms(event, gate);

    if (this.log) {
      this.log.record({
        streamId: this.streamId, parentStreamId: this.parentStreamId,
        eventType: event.type, gateClaimed: gate.signature,
        axiomResult,
      });
    }

    if (!axiomResult.ok) {
      this.rejected.push({ event, gate: gate.signature, failures: axiomResult.failures });
      return;
    }

    // §COS MERGE — pass `this` (the stream) as a second argument. Every
    // current warp gate declares transform(event) and simply never reads
    // a second parameter — passing one is a no-op for them. Cos's gates
    // declare transform(event, stream) and use it to call stream.emit(...)
    // imperatively from inside their own transform body.
    const produced = gate.transform(event, this);

    // Thenable check, not `produced instanceof Promise` — a caller could
    // hand back any promise-shaped object (e.g. from a different realm/
    // library), duck-typing is the correct check here, same reasoning
    // Node's own util.types.isPromise-adjacent code uses.
    if (produced && typeof produced.then === 'function') {
      return produced.then(resolved => this._emitProduced(resolved));
    }
    return this._emitProduced(produced);
  }

  /**
   * _emitProduced — normalize void/single-Event/Event[] into an array and
   * recurse. Split out from emit() so both the sync and async branches
   * above share one implementation instead of two copies that could drift.
   * Recursion itself follows the same sync-unless-thenable rule: if any
   * downstream emit() call in the chain returns a Promise (because
   * something further down the graph is async), this correctly awaits it
   * before continuing — Promise.all over the recursive calls, so sibling
   * events at the same depth still process depth-first per-branch, same
   * ordering guarantee as the fully-synchronous version.
   */
  _emitProduced(produced) {
    const events = produced == null ? [] : (Array.isArray(produced) ? produced : [produced]);
    const results = events.map(next => this.emit(next));
    if (results.some(r => r && typeof r.then === 'function')) {
      return Promise.all(results);
    }
    // Every recursive call was synchronous — return nothing, exactly
    // like the original void contract.
  }

  sampleHere() {
    return {
      pending: [...this.pending],
      rejected: [...this.rejected],
      eventCount: this.eventCount,
      gateCount: this.gates.size,
      axiomCount: this.axioms.length,
    };
  }

  // ── §COS MERGE — ring buffer API ──────────────────────────────────────────
  /** Return last N stamped events from the ring buffer. */
  tail(n = 50) {
    return this._ring.slice(-n);
  }

  /** Return all stamped events since a given seq number. */
  since(afterSeq) {
    return this._ring.filter(e => e.seq > afterSeq);
  }

  get seq() { return this._seq; }

  // ── §COS MERGE — SSE API ──────────────────────────────────────────────────
  subscribeSSE(client) {
    this._sseClients.add(client);
    return () => this._sseClients.delete(client);
  }

  _broadcastSSE(stamped) {
    if (this._sseClients.size === 0) return;
    const data = `data: ${JSON.stringify(stamped)}\n\n`;
    for (const client of this._sseClients) {
      try { client.write(data); } catch (_) { this._sseClients.delete(client); }
    }
  }

  get sseClientCount() { return this._sseClients.size; }
}

module.exports = { Stream };
