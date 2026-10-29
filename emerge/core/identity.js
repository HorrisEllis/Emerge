'use strict';
// emerge/core/identity.js — canonical form and hash for the core: Emerge's own.
// component_id: emerge.core.identity
// §2026-10-28 — replaces ../../../intelligence/rfr2/identity, which lived in the Nexus tree above emerge/, so history,
// level and field could not load when emerge stood alone. James: "don't couple to nexus … everything from the ground up."
//   canonicalize(v) → CIE-EG 4.3 canonical form (ECF), the same bytes the ledger hashes (lang/ledger.js)
//   hash(text)      → full SHA-256, 64 hex digits. The rfr2 helper was a 64-bit hash; CIE-EG principle 6 says integrity
//                     is the full 256-bit hash, and section 7 lists a truncated digest as a flaw to fix.

const crypto = require('crypto');
const { ecf } = require('../lang/ledger');

const canonicalize = v => ecf(v);
const hash = text => crypto.createHash('sha256').update(String(text)).digest('hex');

module.exports = { canonicalize, hash };
