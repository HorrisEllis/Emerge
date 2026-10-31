'use strict';
// lib/atomic-write.js — write a file so a reader never sees half of it: temp file, then rename.
// On Windows a rename can fail with EPERM/EBUSY while antivirus or the indexer holds the target for a moment;
// that is retried a few times before it is an error (Nexus's own jaa flushes hit exactly this).
const fs = require('fs');
const path = require('path');

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

function _pause(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function atomicWrite(file, text, { tries = 6 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 1; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (!RETRYABLE.has(e.code) || i >= tries) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
      _pause(25 * 2 ** i);
    }
  }
}

module.exports = { atomicWrite };
