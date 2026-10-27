'use strict';
// warp/core/Link.js — WARP 2's atom: a LINK, cause → effect, carrying its field values. Not a message.
// EM2 (docs/2026-10-02-emerge-field-memory-build-phasemap.spec). James: "still i want to make warp mine" · "no. i want warp 2"
// Nothing exists without its cause except a root, and a root says it is one (and why).

function createLink({ id, type, data = {}, causedBy = null, root = false, rootReason = null, field = {}, tick }) {
  if (!type || typeof type !== 'string') throw new TypeError('[warp/Link] type is required');
  if (!causedBy && !root) throw new TypeError(`[warp/Link:${type}] a link needs its cause (causedBy) or must be marked root:true`);
  if (causedBy && root) throw new TypeError(`[warp/Link:${type}] a link is caused or a root, not both`);
  return Object.freeze({
    id, type, data: Object.freeze({ ...data }), causedBy: causedBy || null, root: !!root,
    rootReason: root ? (rootReason || 'declared root') : null, field: Object.freeze({ ...field }), tick,
  });
}

module.exports = { createLink };
