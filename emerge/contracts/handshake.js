'use strict';
// contracts/handshake.js — systems are isolated and meet only through their interaction contracts. Before one
// system calls another it verifies the other's contract: same id, a compatible version (same major), every
// resource it needs present, and the hash it saw last time (if any) unchanged.
const crypto = require('crypto');

function hash(contract) { return crypto.createHash('sha1').update(JSON.stringify(contract)).digest('hex'); }

function _major(v) { const m = String(v || '').match(/^(\d+)\./); return m ? Number(m[1]) : null; }

/** verify(theirs, { id, version, needs: [resource paths], hash }) -> { ok, problems } */
function verify(theirs, expect = {}) {
  const problems = [];
  if (!theirs || typeof theirs !== 'object') return { ok: false, problems: ['no contract'] };
  if (expect.id && theirs.id !== expect.id) problems.push(`id is ${theirs.id}, expected ${expect.id}`);
  if (expect.version && _major(theirs.version) !== _major(expect.version)) problems.push(`version ${theirs.version} is not compatible with ${expect.version}`);
  const have = new Set((theirs.resources || []).map(r => `${r.method || 'GET'} ${r.path}`));
  for (const n of expect.needs || []) if (!have.has(n)) problems.push(`missing ${n}`);
  if (expect.hash && hash(theirs) !== expect.hash) problems.push('the contract changed since it was last verified');
  return { ok: !problems.length, problems, hash: hash(theirs) };
}

module.exports = { hash, verify };
