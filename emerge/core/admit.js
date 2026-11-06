'use strict';
// emerge/core/admit.js — Emerge's constraints as an admit(link) for an engine that takes one (WARP 2's Engine({ admit })).
// component_id: emerge.core
// EAS4 L0 compound (docs/2026-10-31-emerge-as-a-system-phasemap.spec, EAS_D5). James, 2026-11-05: "One primitive per gate. Compounds,
// each layer." · "A" (Emerge is a system in Nexus). Moved from lib/warp/adapters/emerge-field.js (archived there in _archive/): the
// adapter is Emerge's (it serves Emerge's constraints, §5.15), and WARP already takes admit handed in, so lib needs no edge up into
// emerge/. Requires only ./constraint (evaluate, the L0 primitive).
// Expectation — in: constraints [{ id, needs, check, permitsViolation? }]; out: admit(link) → { ok:true } | { ok:false, constraint,
// reason } | { gap, constraint }. The next state a constraint sees is { type, ...data, ...field }. A gap is never a pass (§1.2).
const { evaluate } = require('./constraint');

function admitFrom(constraints) {
  return (link) => {
    const next = { type: link.type, ...link.data, ...link.field };
    for (const c of constraints) {
      const r = evaluate(c, next, { link });
      if (r.gap) return { gap: r.gap, constraint: c.id };
      if (r.ok === false && !c.permitsViolation) return { ok: false, constraint: r.constraint, reason: r.reason };
    }
    return { ok: true };
  };
}

module.exports = { admitFrom };
