'use strict';
// warp/adapters/siso-gates.js — WARP 1.x runs unchanged; this records it in WARP 2's ledger.
// EM2 (docs/2026-10-02-emerge-field-memory-build-phasemap.spec): "WARP 1.x gates (cos's 30+, loom's driver) run
// unchanged through warp/adapters/siso-gates.js, each as a link from an unknown cause, until moved one by one."
//
// attach(stream, engine) wraps the 1.x Stream's emit on that instance only. An event emitted while a gate is handling
// another is a link caused by that one (the parent the 1.x Stream knew and never recorded). An event from outside any
// gate — or produced after an async transform resolved, when the parent is no longer on the stack — is a root marked
// 'cause unknown (WARP 1.x)', never an invented cause. The 1.x stream's own behaviour is untouched.

function attach(stream, engine) {
  const original = stream.emit;
  let current = null;
  stream.emit = function (event) {
    const r = current
      ? engine.emit(event.type, event.data || {}, { causedBy: current })
      : engine.emit(event.type, event.data || {}, { root: true, rootReason: 'cause unknown (WARP 1.x)' });
    const prev = current;
    current = r.ok ? r.link.id : prev;
    try { return original.call(stream, event); } finally { current = prev; }
  };
  return () => { stream.emit = original; };
}

module.exports = { attach };
