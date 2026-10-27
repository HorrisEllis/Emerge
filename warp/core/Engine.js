'use strict';
// warp/core/Engine.js — WARP 2's engine. James: "still i want to make warp mine" · "no. i want warp 2"
// EM2 (docs/2026-10-02-emerge-field-memory-build-phasemap.spec).
//
//   emit(type, data, { causedBy } | { root:true, rootReason }) — a link, if it passes:
//     1. WARP's Axioms (1.x Axiom objects work as they are: check(link, null, state))
//     2. the constraints — admit(link) handed in (Emerge's field, through warp/adapters/emerge-field.js), so warp/core
//        stays zero-dependency: { ok } | { ok:false, constraint, reason } | { gap }
//   then it is in the ledger, fulfils any open expectation it answers, and goes to its handlers. A handler's emits
//   are caused by the link it was handed — the parent is recorded at the moment it is known.
//   expect({ cause, effect, within }) — declared before; advance() moves logical time and breaks what is overdue.
//   emit(..., { expect: [{ effect, within }] }) — what this link must cause, declared with it, before its handlers run.
//   residue() — open expectations and gaps: what did not happen, with its cause.

const { createLink } = require('./Link');
const { createExpectation, gapOf } = require('./Expectation');
const { Ledger } = require('./Ledger');

class Engine {
  constructor({ axioms = [], admit = null, ids = null } = {}) {
    this.ledger = new Ledger();
    this._axioms = axioms.slice();
    this._admit = admit;
    this._handlers = new Map();
    this._open = [];          // every expectation, in declaration order (advance walks the open ones)
    this._waiting = new Map();   // effect type -> Set of open expectations on a cause TYPE waiting for it
    this._waitingOn = new Map(); // `${effect}|${causeLinkId}` -> Set of open expectations on that one link
    this._gaps = [];
    this._tick = 0;
    this._n = 0;
    this._ids = ids || ((p) => `${p}-${++this._n}`);   // deterministic by default; one run, one ledger
  }

  get tick() { return this._tick; }
  on(type, handler) { const h = this._handlers.get(type) || []; h.push(handler); this._handlers.set(type, h); return this; }

  emit(type, data = {}, { causedBy = null, root = false, rootReason = null, field = {}, expect = [] } = {}) {
    if (causedBy && !this.ledger.link(causedBy)) throw new Error(`[warp/Engine] cause ${causedBy} is not in the ledger`);
    const link = createLink({ id: this._ids('l'), type, data, causedBy, root, rootReason, field, tick: this._tick });
    for (const ax of this._axioms) {
      let ok = false; try { ok = ax.check(link, null, { tick: this._tick }) === true; } catch (_) { ok = false; }
      if (!ok && ax.severity !== 'soft') {
        this.ledger.append('rejected', { link, by: 'axiom', id: ax.id });
        return { ok: false, link, rejected: { axiom: ax.id } };
      }
    }
    if (this._admit) {
      const r = this._admit(link) || { ok: true };
      if (r.gap) { const gap = Object.freeze({ type: 'gap', cause: link.id, missingVariable: r.gap, constraint: r.constraint || null }); this._gaps.push(gap); this.ledger.append('gap', gap); return { ok: false, link, gap }; }
      if (r.ok === false) { this.ledger.append('rejected', { link, by: 'constraint', id: r.constraint, reason: r.reason || null }); return { ok: false, link, rejected: { constraint: r.constraint, reason: r.reason } }; }
    }
    this.ledger.append('link', link);
    // fulfilled when the expected effect has the cause anywhere above it (cause → … → effect): by link id, or by type
    if (causedBy) {
      const above = this.ledger.chain(causedBy);
      const fulfil = (x, set) => { x.status = 'fulfilled'; x.fulfilledBy = link.id; set.delete(x); this.ledger.append('fulfilled', { expectation: x.id, by: link.id }); };
      for (const l of above) {
        const set = this._waitingOn.get(`${type}|${l.id}`);
        if (set) { for (const x of [...set]) fulfil(x, set); if (!set.size) this._waitingOn.delete(`${type}|${l.id}`); }
      }
      const byType = this._waiting.get(type);
      if (byType && byType.size) {
        const types = new Set(above.map(l => l.type));
        for (const x of [...byType]) if (types.has(x.cause)) fulfil(x, byType);
      }
    }
    // what this link must cause, declared with it — before any handler runs, so nothing can happen first
    for (const ex of expect) this.expect({ ...ex, cause: link.id });
    for (const h of this._handlers.get(type) || []) {
      h(link, { emit: (t, d, o = {}) => this.emit(t, d, { ...o, causedBy: link.id }) });
    }
    return { ok: true, link };
  }

  expect({ cause, effect, within, step = null }) {
    const x = createExpectation({ id: this._ids('x'), cause, effect, within, declaredAt: this._tick, step });
    x.causeIsLink = !!this.ledger.link(cause);   // a link already in the ledger, else a type: "any link of this type"
    this._open.push(x);
    const key = x.causeIsLink ? `${effect}|${cause}` : null;
    const index = x.causeIsLink ? this._waitingOn : this._waiting, k = key || effect;
    if (!index.has(k)) index.set(k, new Set());
    index.get(k).add(x);
    this.ledger.append('expected', { ...x });
    return x;
  }

  advance(n = 1) {
    this._tick += n;
    const broken = [];
    const still = [];
    for (const x of this._open) {
      if (x.status !== 'open') continue;
      if (this._tick <= x.deadline) { still.push(x); continue; }
      {
        x.status = 'broken';
        const k = x.causeIsLink ? `${x.effect}|${x.cause}` : x.effect, idx = x.causeIsLink ? this._waitingOn : this._waiting;
        const set = idx.get(k); if (set) { set.delete(x); if (!set.size) idx.delete(k); }
        const gap = gapOf(x);
        this._gaps.push(gap); broken.push(gap);
        this.ledger.append('gap', gap);
      }
    }
    this._open = still;   // settled expectations live on in the ledger, not in the open list
    return broken;
  }

  residue() { return { open: this._open.filter(x => x.status === 'open').map(x => ({ ...x })), gaps: this._gaps.slice() }; }
}

module.exports = { Engine };
