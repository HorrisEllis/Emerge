'use strict';
// component_id: emerge.lang.ledger · spec: CIE-EG §4 (entry hash, canonical form, verify, checkpoints)
//
// Pure functions, no world state: the runtime appends with them, the tests and (later) the file reader verify with them.
//   ECF        canonical form of a value           (§4.3)
//   hashEntry  the chain hash of one entry         (§4.2)
//   merkle*    root and proofs over entry hashes   (§4.6)
//   verify*    recompute every hash and link       (§4.4)
//
// Hashes are 64 lowercase hex characters (32 bytes). The genesis entry's prev is 32 zero bytes.

const crypto = require('crypto');

const sha = (...parts) => { const h = crypto.createHash('sha256'); for (const p of parts) h.update(p); return h.digest(); };
const ZERO = '0'.repeat(64);
const TAG_ENTRY = Buffer.from('eg.ledger.entry.v1\0', 'utf8');
const EMPTY_ROOT = sha(Buffer.from('eg.merkle.empty.v1', 'utf8')).toString('hex');

class LedgerDataError extends Error {}

/** kinds the ledger itself and the gate own; a program's `record` may not forge them */
const RESERVED_KINDS = new Set(['genesis', 'boot', 'register', 'deliver', 'gap', 'gap.ack', 'gap.close', 'transition', 'rejected', 'checkpoint', 'rekey']);

// ── ECF: the one byte sequence per value (§4.3) ───────────────────────────────
const wellFormed = s => { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0xD800 && c <= 0xDBFF) { const d = s.charCodeAt(i + 1); if (d >= 0xDC00 && d <= 0xDFFF) { i++; continue; } return false; } if (c >= 0xDC00 && c <= 0xDFFF) return false; } return true; };

function ecfString(s, what) {
  if (!wellFormed(s)) throw new LedgerDataError(`${what} holds a lone surrogate — not valid text`);
  if (s !== s.normalize('NFC')) throw new LedgerDataError(`${what} is not NFC-normalized (ledger text must be NFC; normalize it explicitly)`);
  return JSON.stringify(s);                       // minimal JSON escapes: \" \\ \b \f \n \r \t, other C0 controls as \u00xx; everything else raw UTF-8
}

function ecfNumber(n) {
  if (!Number.isFinite(n)) throw new LedgerDataError(`${n} cannot be recorded — NaN and infinity are not data`);
  if (n === 0) return '0';                        // -0 is written as 0
  return String(n);                               // integer-valued up to 2^53: plain decimal · otherwise ECMAScript's shortest round-trip form
}

const byteOrder = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

/** canonical text of a data value: no whitespace, map keys in raw byte order, ints in plain decimal */
function ecf(v, what = 'value') {
  if (v === null || v === undefined) return 'null';
  switch (typeof v) {
    case 'boolean': return v ? 'true' : 'false';
    case 'number': return ecfNumber(v);
    case 'bigint': return v.toString();
    case 'string': return ecfString(v, what);
    case 'object': break;
    default: throw new LedgerDataError(`${what} is a ${typeof v}, not data`);
  }
  if (Array.isArray(v)) return '[' + v.map((x, i) => ecf(x, `${what}[${i}]`)).join(',') + ']';
  const keys = Object.keys(v).sort(byteOrder);
  return '{' + keys.map(k => ecfString(k, `${what} key`) + ':' + ecf(v[k], `${what}.${k}`)).join(',') + '}';
}
const ecfBytes = (v, what) => Buffer.from(ecf(v, what), 'utf8');

// ── the entry hash (§4.2) ─────────────────────────────────────────────────────
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const hexBytes = (h, what) => { if (!/^[0-9a-f]{64}$/.test(h)) throw new LedgerDataError(`${what} must be 64 lowercase hex digits`); return Buffer.from(h, 'hex'); };

/**
 * SHA-256( "eg.ledger.entry.v1" 0x00 || prev(32) || seq(u64 BE) || len(kind)(u32 BE) || kind || len(body)(u32 BE) || ecf(body) )
 * Length-prefixed, so no two different entries can produce the same input by shifting a boundary.
 */
function hashEntry({ seq, kind, body, prev }) {
  const k = Buffer.from(kind, 'utf8');
  const b = ecfBytes(body === undefined ? null : body, `${kind} body`);
  return sha(TAG_ENTRY, hexBytes(prev, 'prev'), u64(seq), u32(k.length), k, u32(b.length), b).toString('hex');
}

// ── Merkle root and proofs over entry hashes (§4.6) ───────────────────────────
// leaf = SHA-256(0x00 || entry hash) · node = SHA-256(0x01 || left || right) · an odd node is carried up unchanged (never duplicated)
const leaf = h => sha(Buffer.from([0]), hexBytes(h, 'entry hash'));
const node = (l, r) => sha(Buffer.from([1]), l, r);

function merkleRoot(hashes) {
  if (!hashes.length) return EMPTY_ROOT;
  let level = hashes.map(leaf);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? node(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0].toString('hex');
}

/** the sibling path from hashes[index] up to the root: [{ side: 'L'|'R', hash }] — side is where the sibling sits */
function merkleProof(hashes, index) {
  if (!Number.isInteger(index) || index < 0 || index >= hashes.length) throw new LedgerDataError(`no leaf ${index}`);
  let level = hashes.map(leaf), i = index;
  const path = [];
  while (level.length > 1) {
    if (i % 2 === 1) path.push({ side: 'L', hash: level[i - 1].toString('hex') });
    else if (i + 1 < level.length) path.push({ side: 'R', hash: level[i + 1].toString('hex') });
    const next = [];
    for (let j = 0; j < level.length; j += 2) next.push(j + 1 < level.length ? node(level[j], level[j + 1]) : level[j]);
    level = next; i = Math.floor(i / 2);
  }
  return path;
}

function merkleFold(entryHash, path) {
  let cur = leaf(entryHash);
  for (const s of path) cur = s.side === 'L' ? node(hexBytes(s.hash, 'sibling'), cur) : node(cur, hexBytes(s.hash, 'sibling'));
  return cur.toString('hex');
}

// ── verify (§4.4) ─────────────────────────────────────────────────────────────
/**
 * Recompute every hash, check every prev link and every seq, and check each checkpoint against the chain it sits in
 * (head, entries, gaps, Merkle root). Returns { ok: true } or { ok: false, seq, reason }.
 * Any edit, deletion, reordering or truncation-then-append of different content fails.
 */
function verify(entries) {
  let prev = ZERO, since = [], gaps = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], at = i + 1;
    const bad = reason => ({ ok: false, seq: at, reason });
    if (e.seq !== at) return bad(`seq is ${e.seq}, expected ${at}`);
    if (e.prev !== prev) return bad('prev does not link to the previous entry');
    let h;
    try { h = hashEntry(e); } catch (err) { return bad(err.message); }
    if (h !== e.hash) return bad('hash does not match the entry');
    if (e.kind === 'checkpoint') {
      const b = e.body;
      if (!b || b.head !== prev || b.entries !== at - 1) return bad('checkpoint head/entries do not match the chain');
      if (b.gaps !== gaps) return bad('checkpoint gap count does not match the chain');
      if (b.root !== merkleRoot(since)) return bad('checkpoint Merkle root does not match the entries since the last checkpoint');
      since = [];
    } else since.push(e.hash);
    if (e.kind === 'gap') gaps++;
    prev = e.hash;
  }
  return { ok: true };
}

/** verify from a checkpoint instead of from the start: the checkpoint at `from` is the trusted anchor; everything after it must chain */
function verifyFrom(entries, from) {
  const at = entries.findIndex(e => e.seq === from);
  if (at < 0) return { ok: false, seq: from, reason: `no entry ${from}` };
  if (entries[at].kind !== 'checkpoint') return { ok: false, seq: from, reason: `entry ${from} is not a checkpoint` };
  let prev = entries[at].prev;
  if (entries[at].body.head !== prev) return { ok: false, seq: from, reason: 'checkpoint head does not match its prev' };
  for (let i = at; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== (i === at ? from : entries[i - 1].seq + 1)) return { ok: false, seq: e.seq, reason: 'seq out of order' };
    if (e.prev !== prev) return { ok: false, seq: e.seq, reason: 'prev does not link to the previous entry' };
    let h; try { h = hashEntry(e); } catch (err) { return { ok: false, seq: e.seq, reason: err.message }; }
    if (h !== e.hash) return { ok: false, seq: e.seq, reason: 'hash does not match the entry' };
    prev = e.hash;
  }
  return { ok: true };
}

module.exports = { ZERO, EMPTY_ROOT, RESERVED_KINDS, LedgerDataError, ecf, ecfBytes, hashEntry, merkleRoot, merkleProof, merkleFold, verify, verifyFrom, sha };
