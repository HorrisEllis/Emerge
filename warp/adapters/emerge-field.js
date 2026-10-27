'use strict';
// warp/adapters/emerge-field.js — Emerge's constraints as WARP 2's admit(). EM2: "Every link passes the constraints first (EM1)".
// Outside warp/core on purpose: warp/core imports nothing outside warp/ (MANIFEST decoupling_rule); this adapter is
// the one place WARP meets Emerge. The next state a constraint sees is { type, ...data, field }.

function admitFrom(constraints) {
  const { evaluate } = require('../../emerge/core');
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
