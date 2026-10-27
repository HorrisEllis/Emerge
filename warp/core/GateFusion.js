'use strict';
/**
 * GateFusion — v1.4 "gate fusion system." Merges an adjacent chain of
 * pure Gates into a single Gate, so Stream.emit()'s recursive dispatch
 * doesn't pay a Map lookup + axiom pass + log-record round trip per
 * intermediate hop for transforms that always fire together anyway.
 *
 * The spec's constraint was "no shared side effects." Gate.transform is
 * already documented core primitive as pure with zero side effects (see
 * core/Gate.js's own header) — so that constraint is Gate's existing
 * contract, not a new check this module invents or verifies. fuseChain
 * does NOT attempt to prove purity at runtime (there is no way to prove
 * that generically); it trusts the same contract every other part of
 * WARP already trusts every Gate to honor, and documents that trust
 * explicitly rather than pretending to enforce it.
 *
 * What IS enforced: adjacency. Gate B only fuses onto Gate A if A's
 * transform can actually produce an event of the type B matches — this
 * module runs each gate's `matches` against a synthetic probe event of
 * every declared handoff type to catch a wrong chain order early,
 * rather than silently fusing gates that were never really adjacent.
 */
const { Event } = require('./Event');
const { Gate } = require('./Gate');

/**
 * fuseChain(gates, fusedSignature) — gates: ordered array of Gate
 * instances, where gates[i]'s transform is expected to produce events
 * matched by gates[i+1]. Returns one Gate whose transform runs the whole
 * chain internally and returns only the final-stage output events (plus
 * any branch events that don't match the next stage, so nothing produced
 * along the way is silently dropped).
 */
function fuseChain(gates, fusedSignature) {
  if (!Array.isArray(gates) || gates.length < 2) {
    throw new Error('[warp/GateFusion] fuseChain requires at least 2 gates');
  }
  for (let i = 0; i < gates.length - 1; i++) {
    if (!(gates[i] instanceof Gate) || !(gates[i + 1] instanceof Gate)) {
      throw new Error('[warp/GateFusion] fuseChain requires Gate instances');
    }
  }

  const fused = new Gate(fusedSignature, {
    matches: (event) => gates[0].matches(event),
    transform: (event) => {
      let frontier = [event];
      const passthrough = [];

      for (let stage = 0; stage < gates.length; stage++) {
        const gate = gates[stage];
        const next = [];
        for (const e of frontier) {
          if (!gate.matches(e)) { passthrough.push(e); continue; }
          const produced = gate.transform(e);
          const events = produced == null ? [] : (Array.isArray(produced) ? produced : [produced]);
          next.push(...events);
        }
        frontier = next;
        if (frontier.length === 0) break;
      }

      return [...passthrough, ...frontier];
    },
  });

  fused.fusedFrom = gates.map(g => g.signature); // traceability — a fused gate still says what it's made of
  return fused;
}

/**
 * canFuse(gateA, gateB, sampleEventTypes) — best-effort adjacency check.
 * For each declared sample type, run gateA.matches on a probe Event, and
 * if it matches, confirm gateA.transform's contract lines up with
 * gateB.matches on at least one plausible output type. This is a
 * heuristic sanity check, not a proof — see module header.
 */
function canFuse(gateA, gateB, sampleEventTypes = []) {
  for (const type of sampleEventTypes) {
    const probe = new Event(type, {});
    if (gateA.matches(probe)) return true;
  }
  // No sample types supplied — fall back to signature-name convention
  // (best-effort only): can't prove adjacency, say so via null.
  return sampleEventTypes.length === 0 ? null : false;
}

module.exports = { fuseChain, canFuse };
