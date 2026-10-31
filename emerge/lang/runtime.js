'use strict';
// emerge/lang/runtime.js — the one runtime both backends call.
// component_id: emerge.lang.runtime · spec: emerge/lang/emerge-lang.spec (semantics, compartments, signals, ledger, axioms, whatif)
//
// Values: num · string · bool · null · list (Array) · map (null-prototype object) · fn (JS function tagged __eg)
//         · Compartment handle · EModule.
// The world: compartments, top-level handlers, the signal queue, the hash-chained ledger, gaps, the seed, spent.
// Every operator, builtin and world operation lives here, so the interpreter and the compiled JS cannot disagree.
// Constraint evaluation is emerge/core/constraint.js's — the same three answers: ok, broken (with id), or a gap.

const fs = require('fs');
const crypto = require('crypto');
const { EmergeError } = require('./errors');
const { defineConstraint, evaluate } = require('../core/constraint');
const { graphRecords } = require('./components');
const build = require('./build-loader');
const L = require('./ledger');

const VERSION = require('../package.json').version;
const SYSTEM_FILES = new Set(['<prelude>']);   // errors raised in here are reported at the caller's line
const TDZ = /Cannot access '(?:v_)?([A-Za-z0-9_]+)' before initialization/;

// ── value helpers ────────────────────────────────────────────────────────────
class Compartment {
  constructor(name, id, intent, template = null) { this.name = name; this.id = id; this.intent = intent; this.template = template; }
}
class EModule {
  constructor(name, exports) { this.name = name; this.exports = exports; }
}
/** bytes — an immutable byte sequence (CIE-EG §3). Indexing gives a num 0..255. */
class EBytes {
  constructor(u8) { this.b = u8; Object.freeze(this); }
}

const isMap = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Compartment) && !(v instanceof EModule) && !(v instanceof EBytes);
const isFn = v => typeof v === 'function' && !!v.__eg;
const mkMap = () => Object.create(null);

function typeOf(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return 'num';
  if (typeof v === 'bigint') return 'int';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'bool';
  if (Array.isArray(v)) return 'list';
  if (isFn(v)) return 'fn';
  if (v instanceof Compartment) return 'compartment';
  if (v instanceof EModule) return 'module';
  if (v instanceof EBytes) return 'bytes';
  if (isMap(v)) return 'map';
  return 'unknown';
}

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isMap(v)) { const m = mkMap(); for (const k of Object.keys(v)) m[k] = clone(v[k]); return m; }
  return v;
}

function freeze(v) {
  if (Array.isArray(v) || isMap(v)) {
    if (!Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) freeze(v[k]); }
  }
  return v;
}
const frozenCopy = v => freeze(clone(v));

function eq(a, b) {
  if (a === b) return true;
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof EBytes) return b instanceof EBytes && Buffer.compare(Buffer.from(a.b), Buffer.from(b.b)) === 0;
  if (isMap(a)) {
    if (!isMap(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!(k in b) || !eq(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function fmtNum(n) { return Object.is(n, -0) ? '0' : String(n); }

function show(v, nested = false) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return nested ? JSON.stringify(v) : v;
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map(x => show(x, true)).join(', ') + ']';
  if (isFn(v)) return `<fn ${v.__eg.name}>`;
  if (v instanceof Compartment) return `<${v.isComponent ? 'component' : 'compartment'} ${v.name}>`;
  if (v instanceof EModule) return `<module ${v.name}>`;
  if (v instanceof EBytes) return `<bytes ${v.b.length}${v.b.length ? ': ' + Buffer.from(v.b.subarray(0, 16)).toString('hex') + (v.b.length > 16 ? '…' : '') : ''}>`;
  if (isMap(v)) {
    const ks = Object.keys(v);
    if (!ks.length) return '{}';
    return '{' + ks.map(k => `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : JSON.stringify(k)}: ${show(v[k], true)}`).join(', ') + '}';
  }
  return String(v);
}

/** JSON.stringify where a 64-bit int is written as a plain JSON number, exactly. JSON.rawJSON does it on Node 21+;
 *  before that the int goes out as a tagged string and the tag is unwrapped after (the tag carries a fresh nonce, so
 *  no string in the data can match it). */
function stringifyBig(v, indent) {
  if (JSON.rawJSON) return JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? JSON.rawJSON(String(x)) : x), indent);
  const tag = `\u0000int${Math.random().toString(36).slice(2)}:`;
  const out = JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? tag + x : x), indent);
  const quoted = JSON.stringify(tag).slice(1, -1).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return out.replace(new RegExp(`"${quoted}(-?\\d+)"`, 'g'), '$1');
}

// mulberry32 — the same generator as emerge/core/seed.js, with its position exposed so whatif can restore it.
function createRng(seed) {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get pos() { return s; },
    set pos(v) { s = v; },
  };
}

// ── the runtime ──────────────────────────────────────────────────────────────
function createRuntime(opts = {}) {
  const seed = opts.seed === undefined ? 0 : opts.seed;
  if (!Number.isInteger(seed)) throw new TypeError('runtime: seed must be an integer — a run without a recorded seed cannot be replayed');
  const out = opts.out || (s => process.stdout.write(s));
  const errOut = opts.err || (s => process.stderr.write(s));
  const argv = (opts.argv || []).slice();
  const loadModule = opts.loadModule || null; // (absPath, rt) → exports map

  const rt = {};
  rt.file = opts.file || '<input>';
  rt.line = 0;
  rt.frames = [];   // caller locations of the fn calls in flight
  // the core rules: lang/core/primitives.eg, built. Read once per runtime, so a program sees one consistent set.
  const P = build.primitives();
  rt.primitives = P;

  // ── errors & location ──
  rt.at = (line, file) => { rt.line = line; if (file !== undefined) rt.file = file; };
  /** where an error belongs: here, or — inside the prelude — the nearest caller outside it */
  const loc = () => {
    if (!SYSTEM_FILES.has(rt.file)) return [rt.file, rt.line];
    for (let i = rt.frames.length - 1; i >= 0; i--) if (!SYSTEM_FILES.has(rt.frames[i].file)) return [rt.frames[i].file, rt.frames[i].line];
    return [rt.file, rt.line];
  };
  rt.error = (msg) => { const [f, l] = loc(); throw new EmergeError(msg, f, l); };
  const err = rt.error;

  rt.toError = (e) => {
    if (e instanceof EmergeError) return e;
    if (e && e.name === 'EmergeSyntaxError') return e;
    if (e instanceof RangeError && String(e.message).includes('call stack')) { const [f, l] = loc(); return new EmergeError('stack overflow — recursion too deep', f, l); }
    const m = e && TDZ.exec(e.message || '');
    const [f, l] = loc();
    if (m) return new EmergeError(`"${m[1]}" is used before its declaration ran`, f, l);
    return new EmergeError(`internal: ${e && e.message ? e.message : String(e)}`, f, l);
  };

  // ── functions ──
  rt.fn = (name, arity, impl) => {
    impl.__eg = { name: name || 'anonymous', arity };
    return impl;
  };
  rt.call = (f, args) => {
    if (!isFn(f)) err(`cannot call ${typeOf(f)} — only fn values can be called`);
    const a = f.__eg.arity;
    if (Array.isArray(a)) {
      if (args.length < a[0] || (a[1] !== -1 && args.length > a[1])) {
        err(`${f.__eg.name} takes ${a[1] === -1 ? `at least ${a[0]}` : a[0] === a[1] ? a[0] : `${a[0]} to ${a[1]}`} argument(s), got ${args.length}`);
      }
    } else if (args.length !== a) err(`${f.__eg.name} takes ${a} argument(s), got ${args.length}`);
    const file = rt.file, line = rt.line;
    rt.frames.push({ file, line });
    try { return f(...args); }
    catch (e) { throw (e instanceof EmergeError || (e && e.name === 'EmergeSyntaxError')) ? e : rt.toError(e); } // located where it happened, before the caller's line is restored
    finally { rt.frames.pop(); rt.file = file; rt.line = line; }
  };

  rt.ty = (v, name, nullable, what) => {
    if (v === null || v === undefined) {
      if (nullable || name === 'any') return null;
      err(`${what} must be ${name}, got null`);
    }
    let ok;
    switch (name) {
      case 'int': ok = typeof v === 'bigint'; break;
      case 'float': case 'num': ok = typeof v === 'number'; break;
      case 'string': ok = typeof v === 'string'; break;
      case 'bool': ok = typeof v === 'boolean'; break;
      case 'list': ok = Array.isArray(v); break;
      case 'bytes': ok = v instanceof EBytes; break;
      case 'map': ok = isMap(v); break;
      case 'fn': ok = isFn(v); break;
      case 'any': ok = true; break;
      default: ok = false;
    }
    if (!ok) err(`${what} must be ${name}, got ${typeOf(v)} ${show(v, true)}`);
    return v;
  };

  // ── operators ──
  /** conditions: a real bool when truth.strict (primitives.eg); otherwise null/false/0/""/[]/{} are false */
  rt.truth = (v, where) => {
    if (typeof v === 'boolean') return v;
    if (P.truth.strict) err(`${where} needs a bool, got ${typeOf(v)} ${show(v, true)}`);
    if (v === null || v === undefined || v === 0 || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (isMap(v)) return Object.keys(v).length > 0;
    return true;
  };
  rt.not = v => !rt.truth(v, 'not');
  const num2 = (op, a, b) => {
    if (typeof a !== 'number' || typeof b !== 'number') err(`${op} needs two nums, got ${typeOf(a)} and ${typeOf(b)}`);
  };
  // ── 64-bit int (CIE-EG §3): a distinct type, never mixed with num. Overflow is an error; wrap_* is the explicit wrapping family.
  const I_MIN = -(2n ** 63n), I_MAX = 2n ** 63n - 1n;
  const isI = v => typeof v === 'bigint';
  const fit = (v, op) => { if (v < I_MIN || v > I_MAX) err(`int overflow in ${op}: result does not fit in 64 bits (use wrap_add / wrap_sub / wrap_mul to wrap)`); return v; };
  const mixed = (op, a, b) => err(`${op} does not mix int and num (got ${typeOf(a)} and ${typeOf(b)}): convert explicitly with int(x) or num(x)`);
  const arith2 = (op, a, b) => {            // → 'i' both ints · 'n' both nums
    if (isI(a) && isI(b)) return 'i';
    if (typeof a === 'number' && typeof b === 'number') return 'n';
    if ((isI(a) && typeof b === 'number') || (typeof a === 'number' && isI(b))) mixed(op, a, b);
    err(`${op} needs two nums or two ints, got ${typeOf(a)} and ${typeOf(b)}`);
  };
  rt.add = (a, b) => {
    if (isI(a) && isI(b)) return fit(a + b, '+');
    if ((isI(a) && typeof b === 'number') || (typeof a === 'number' && isI(b))) mixed('+', a, b);
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    if (typeof a === 'string') return a + show(b);
    if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
    if (a instanceof EBytes && b instanceof EBytes) return new EBytes(Buffer.concat([a.b, b.b]));
    if (isMap(a) && isMap(b)) { const m = mkMap(); Object.assign(m, a, b); return m; }
    err(`+ cannot combine ${typeOf(a)} and ${typeOf(b)}`);
  };
  rt.sub = (a, b) => { if (arith2('-', a, b) === 'i') return fit(a - b, '-'); return a - b; };
  rt.mul = (a, b) => {
    if (typeof a === 'string' && typeof b === 'number') {
      if (!Number.isInteger(b) || b < 0) err('string * n needs a non-negative int n');
      return a.repeat(b);
    }
    if (arith2('*', a, b) === 'i') return fit(a * b, '*'); return a * b;
  };
  rt.div = (a, b) => {
    if (arith2('/', a, b) === 'i') err('int / int is not defined: use idiv(a, b) for integer division, or num(a) / num(b)');
    if (b === 0) err('division by zero'); return a / b;
  };
  rt.mod = (a, b) => {
    if (arith2('%', a, b) === 'i') { if (b === 0n) err('modulo by zero'); return ((a % b) + b) % b; }
    if (b === 0) err('modulo by zero'); return ((a % b) + b) % b;
  };
  rt.pow = (a, b) => {
    if (arith2('**', a, b) === 'i') {
      if (b < 0n) err('int ** needs a non-negative exponent');
      if (a === 0n || a === 1n) return b === 0n ? 1n : a;
      if (a === -1n) return b % 2n === 0n ? 1n : -1n;
      if (b > 63n) err('int overflow in **: result does not fit in 64 bits');
      return fit(a ** b, '**');
    }
    return a ** b;
  };
  // ── bit operations on 32-bit words (CIE-EG §3, for now): ints in [-2^31, 2^32); negatives are two's complement;
  //    every result is an unsigned word in [0, 2^32). Shift counts are 0..31.
  const word = (v, op) => {
    if (!Number.isInteger(v) || v < -2147483648 || v > 4294967295) err(`${op} works on 32-bit words: an int in [-2^31, 2^32), got ${show(v, true)}`);
    return v >>> 0;
  };
  const count = (n, op) => { if (!Number.isInteger(n) || n < 0 || n > 31) err(`${op} needs a shift count in 0..31, got ${show(n, true)}`); return n; };
  //    On two ints the same operators work on the full 64-bit two's-complement pattern: & | ^ ~ << (wraps, as a bit operation does) and >> (arithmetic).
  //    A shift count may be a num or an int, 0..63.
  const wrap64 = v => BigInt.asIntN(64, v);
  const needIs = (op, a, b) => { if (!isI(a) || !isI(b)) mixed(op, a, b); };
  const count64 = (n, op) => {
    const c = isI(n) ? n : (Number.isInteger(n) ? BigInt(n) : null);
    if (c === null || c < 0n || c > 63n) err(`${op} on an int needs a shift count in 0..63, got ${show(n, true)}`);
    return c;
  };
  rt.band = (a, b) => { if (isI(a) || isI(b)) { needIs('&', a, b); return a & b; } return (word(a, '&') & word(b, '&')) >>> 0; };
  rt.bor = (a, b) => { if (isI(a) || isI(b)) { needIs('|', a, b); return a | b; } return (word(a, '|') | word(b, '|')) >>> 0; };
  rt.bxor = (a, b) => { if (isI(a) || isI(b)) { needIs('^', a, b); return a ^ b; } return (word(a, '^') ^ word(b, '^')) >>> 0; };
  rt.bnot = a => (isI(a) ? ~a : (~word(a, '~')) >>> 0);
  rt.shl = (a, n) => (isI(a) ? wrap64(a << count64(n, '<<')) : (word(a, '<<') << count(n, '<<')) >>> 0);
  rt.shr = (a, n) => (isI(a) ? a >> count64(n, '>>') : word(a, '>>') >>> count(n, '>>'));
  rt.neg = a => { if (isI(a)) return fit(-a, 'unary -'); if (typeof a !== 'number') err(`unary - needs a num or an int, got ${typeOf(a)}`); return -a; };
  rt.eq = (a, b) => eq(a, b);
  rt.neq = (a, b) => !eq(a, b);
  rt.cmp = (op, a, b) => {
    if ((isI(a) && typeof b === 'number') || (typeof a === 'number' && isI(b))) mixed(op, a, b);
    const okNum = (typeof a === 'number' && typeof b === 'number') || (isI(a) && isI(b));
    const okStr = typeof a === 'string' && typeof b === 'string';
    if (!okNum && !okStr) err(`${op} compares two nums or two strings, got ${typeOf(a)} and ${typeOf(b)}`);
    switch (op) { case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b; }
  };
  rt.range = (a, b) => {
    if (isI(a) && isI(b)) { const r = []; for (let i = a; i < b; i++) r.push(i); return r; }
    if (!Number.isInteger(a) || !Number.isInteger(b)) err('.. needs two ints (both nums or both ints)');
    const r = [];
    for (let i = a; i < b; i++) r.push(i);
    return r;
  };
  rt.contains = (a, b) => {
    if (typeof a === 'string') { if (typeof b !== 'string') err('string contains needs a string'); return a.includes(b); }
    if (Array.isArray(a)) return a.some(x => eq(x, b));
    if (isMap(a)) { if (typeof b !== 'string') err('map contains needs a string key'); return Object.prototype.hasOwnProperty.call(a, b); }
    err(`contains needs a string, list or map on the left, got ${typeOf(a)}`);
  };
  rt.isIn = (a, b) => rt.contains(b, a);
  rt.startsWith = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string') err('starts_with needs two strings'); return a.startsWith(b); };
  rt.endsWith = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string') err('ends_with needs two strings'); return a.endsWith(b); };
  rt.matches = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') err('matches needs a string and a pattern string');
    let re;
    try { re = new RegExp(b); } catch (e) { err(`bad pattern ${JSON.stringify(b)}: ${e.message}`); }
    return re.test(a);
  };
  rt.coalesce = (a, rhs) => (a === null || a === undefined ? rhs() : a);
  rt.and = (a, rhs) => rt.truth(a, 'and') && rt.truth(rhs(), 'and');
  rt.or = (a, rhs) => rt.truth(a, 'or') || rt.truth(rhs(), 'or');
  rt.updMember = (o, name, f) => rt.setMember(o, name, f(rt.get(o, name)));
  rt.updIndex = (o, i, f) => rt.setIndex(o, i, f(rt.index(o, i)));
  rt.str = (parts) => parts.map(p => show(p)).join('');
  rt.list = (items) => items;
  rt.map = (pairs) => { const m = mkMap(); for (let i = 0; i < pairs.length; i += 2) m[pairs[i]] = pairs[i + 1]; return m; };

  // ── member / index ──
  rt.get = (o, name) => {
    if (isMap(o)) return Object.prototype.hasOwnProperty.call(o, name) ? o[name] : null;
    if (o instanceof Compartment) return compMember(o, name);
    if (o instanceof EModule) {
      if (!Object.prototype.hasOwnProperty.call(o.exports, name)) err(`module ${o.name} has no export "${name}"`);
      return o.exports[name];
    }
    if (o === null || o === undefined) err(`cannot read .${name} of null`);
    err(`${typeOf(o)} has no member .${name}`);
  };
  rt.index = (o, i) => {
    if (o instanceof EBytes) {
      if (!Number.isInteger(i)) err(`bytes index must be an int, got ${typeOf(i)}`);
      const j = i < 0 ? o.b.length + i : i;
      if (j < 0 || j >= o.b.length) err(`index ${i} is out of range for bytes of ${o.b.length}`);
      return o.b[j];
    }
    if (Array.isArray(o)) {
      if (!Number.isInteger(i)) err(`list index must be an int, got ${typeOf(i)}`);
      const j = i < 0 ? o.length + i : i;
      if (j < 0 || j >= o.length) err(`index ${i} is out of range for a list of ${o.length}`);
      return o[j];
    }
    if (typeof o === 'string') {
      if (!Number.isInteger(i)) err(`string index must be an int, got ${typeOf(i)}`);
      const j = i < 0 ? o.length + i : i;
      if (j < 0 || j >= o.length) err(`index ${i} is out of range for a string of ${o.length}`);
      return o[j];
    }
    if (isMap(o)) {
      if (typeof i !== 'string') err(`map key must be a string, got ${typeOf(i)}`);
      return Object.prototype.hasOwnProperty.call(o, i) ? o[i] : null;
    }
    if (o === null || o === undefined) err('cannot index null');
    err(`${typeOf(o)} cannot be indexed`);
  };
  const writable = (o) => { if (Object.isFrozen(o)) err('this value is read-only — it is a lens over state, copy it with clone() to change it'); };
  rt.setMember = (o, name, v) => {
    if (!isMap(o)) err(o === null || o === undefined ? `cannot set .${name} of null` : `cannot set .${name} on ${typeOf(o)}`);
    writable(o);
    o[name] = v;
    return v;
  };
  rt.setIndex = (o, i, v) => {
    if (Array.isArray(o)) {
      writable(o);
      if (!Number.isInteger(i)) err(`list index must be an int, got ${typeOf(i)}`);
      const j = i < 0 ? o.length + i : i;
      if (j < 0 || j > o.length) err(`index ${i} is out of range for a list of ${o.length}`);
      o[j] = v;
      return v;
    }
    if (isMap(o)) {
      writable(o);
      if (typeof i !== 'string') err(`map key must be a string, got ${typeOf(i)}`);
      o[i] = v;
      return v;
    }
    err(`${typeOf(o)} cannot be indexed for assignment`);
  };
  rt.iter = (v, two) => {
    if (v instanceof EBytes) return two ? [...v.b].map((x, i) => [i, x]) : [...v.b];
    if (Array.isArray(v)) return two ? v.map((x, i) => [i, x]) : v.slice();
    if (isMap(v)) return two ? Object.keys(v).map(k => [k, v[k]]) : Object.keys(v);
    if (typeof v === 'string') return two ? [...v].map((c, i) => [i, c]) : [...v];
    err(`for needs a list, map or string, got ${typeOf(v)}`);
  };

  // ── the world ──────────────────────────────────────────────────────────────
  const W = {
    comps: [],            // [{ handle, state, constraints, handlers, fns }]
    byName: new Map(),
    globalHandlers: [],   // [{ signal, run }]
    ledger: [],
    lastCkpt: 0,          // seq of the newest checkpoint entry (0: none yet)
    gapEntries: 0,        // entries of kind gap so far (a checkpoint records the count)
    inCkpt: false,
    gaps: [],
    rng: createRng(seed),
    spent: 0,
    unrouted: [],
    axioms: [],
    ctx: [{ kind: 'top', queue: [], draining: false }],
    lens: 0,
    wires: [],            // [{ from: {comp,hook}|{signal}, to: …, line }]
    templates: new Map(), // name → { arity, factory(id, …args) → spec }
    modules: new Map(),
    loading: new Set(),
    tests: [],
  };
  rt.world = W;

  const toData = (v, what) => {
    if (v instanceof EBytes) return Buffer.from(v.b).toString('hex');
    if (v === null || v === undefined || typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string' || typeof v === 'boolean') return v === undefined ? null : v;
    if (Array.isArray(v)) return v.map(x => toData(x, what));
    if (isMap(v)) { const m = mkMap(); for (const k of Object.keys(v)) m[k] = toData(v[k], what); return m; }
    err(`${what} must be data — ${typeOf(v)} cannot be recorded`);
  };

  // ── the ledger (CIE-EG §4): lang/ledger.js owns the format; this is the world's side of it ──
  function append(kind, body) {
    if (typeof kind !== 'string' || !kind) err(`ledger: an entry kind must be a non-empty string, got ${typeOf(kind)}`);
    const prev = W.ledger.length ? W.ledger[W.ledger.length - 1].hash : L.ZERO;
    const core = { seq: W.ledger.length + 1, kind, body: body === undefined ? null : body, prev };
    let hash;
    try { hash = L.hashEntry(core); }
    catch (e) { if (e instanceof L.LedgerDataError) err(`ledger: ${e.message}`); throw e; }
    const entry = freeze(Object.assign(mkMap(), core, { hash }));
    W.ledger.push(entry);
    if (kind === 'gap') W.gapEntries++;
    if (kind === 'checkpoint') W.lastCkpt = entry.seq;
    else if (!W.inCkpt && W.ledger.length - W.lastCkpt >= P.ledger.checkpoint_every) checkpoint();
    return entry;
  }
  rt.append = append;

  /** §4.6: head, counts, one digest per component state, and a Merkle root over the entries since the last checkpoint */
  function checkpoint() {
    W.inCkpt = true;
    try {
      const last = W.ledger[W.ledger.length - 1];
      const digests = mkMap();
      for (const c of W.comps) digests[c.handle.id] = L.sha(L.ecfBytes(toData(c.state, 'state'), `state of ${c.handle.id}`)).toString('hex');
      append('checkpoint', { head: last.hash, entries: last.seq, gaps: W.gapEntries, digests, root: L.merkleRoot(W.ledger.slice(W.lastCkpt).map(e => e.hash)) });
    } finally { W.inCkpt = false; }
  }

  // chain id: a UUID derived from what the chain starts from, so two runs from the same seed and build agree (layout: 8-4-4-4-12, version 8, variant 10)
  const chainId = (() => {
    const b = Buffer.from(L.sha(Buffer.from(`eg.chain.v1\0${seed} ${VERSION}`, 'utf8')).subarray(0, 16));
    b[6] = (b[6] & 0x0f) | 0x80; b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  })();
  W.inCkpt = true;     // the genesis entry never triggers a checkpoint (and reads no primitive: the seed-mode build has none to read)
  try { append('genesis', { seed, version: VERSION, chain_id: chainId, text: { encoding: 'utf-8', normalization: 'nfc' } }); } finally { W.inCkpt = false; }

  function verifyLedger(from) {
    if (from === undefined || from === null) return L.verify(W.ledger).ok;
    return L.verifyFrom(W.ledger, Number(needNumLoose(from, 'ledger_verify'))).ok;
  }
  const needNumLoose = (v, who) => { if (typeof v === 'bigint') return Number(v); if (typeof v !== 'number') err(`${who} needs a seq (num or int), got ${typeOf(v)}`); return v; };

  const uid = (prefix) => {
    const a = Math.floor(W.rng.next() * 0xffffffff).toString(16).padStart(8, '0');
    const b = Math.floor(W.rng.next() * 0xffffffff).toString(16).padStart(8, '0');
    return `${prefix}-${a}${b}`;
  };

  const noLens = (what) => { if (W.lens > 0) err(`${what} is not allowed in a lens — compartment fns and constraints only read`); };

  // ── compartments ──
  /** the live record behind a handle — a despawned handle is an error, not a ghost */
  function liveOf(h) {
    const c = W.byName.get(h.name);
    if (!c || c.handle !== h) err(`${h.name} no longer exists — it was despawned, or spawned inside a whatif`);
    return c;
  }
  function compMember(h, name) {
    const c = liveOf(h);
    switch (name) {
      case 'state': return frozenCopy(c.state);
      case 'id': return h.id;
      case 'name': return h.name;
      case 'intent': return h.intent;
    }
    if (c.component) {
      switch (name) {
        case 'namespace': return c.component.namespace;
        case 'version': return c.component.version;
        case 'uuid': return c.component.record.uuid;
        case 'hooks': { const m = mkMap(); m.in = Object.keys(c.component.ins); m.out = Object.keys(c.component.outs); return freeze(m); }
        case 'template': return c.handle.template;
        case 'kinds': return c.component.kinds.slice();
      }
    }
    if (Object.prototype.hasOwnProperty.call(c.fns, name)) return rt.lensFn(h.name, name, null);
    err(`${c.component ? 'component' : 'compartment'} ${h.name} has no member .${name}`);
  }

  /** a compartment fn bound to a view of state: the committed state (viewOf null) or a handler's working copy */
  rt.lensFn = (compName, fnName, viewOf) => {
    const c = W.byName.get(compName);
    if (!c) err(`compartment ${compName} is not declared yet`);
    const def = c.fns[fnName];
    return rt.fn(`${compName}.${fnName}`, def.arity, (...args) => {
      const view = frozenCopy(viewOf === null ? c.state : viewOf);
      W.lens++;
      try { return def.impl(view, ...args); } finally { W.lens--; }
    });
  };

  /** a constraint type from primitives.eg mapped onto emerge/core's evaluate(): it either permits a violation or not */
  function constraintFor(owner, k) {
    const t = P.constraint_types[k.ctype];
    if (!t) err(`constraint type "${k.ctype}" is not in primitives.constraint_types`);
    const d = defineConstraint({ id: `${owner}.${k.name}`, name: k.name, type: t.permits_violation ? 'soft' : 'hard', needs: k.needs,
      violationCost: k.cost === null || k.cost === undefined ? t.default_cost : k.cost, check: k.check });
    return Object.freeze({ ...d, constraintType: k.ctype });
  }

  rt.declare = (spec) => {
    for (const c of W.comps) if (c.handle.id === spec.id) err(`id "${spec.id}" is already used by ${c.handle.name}`);
    if (W.byName.has(spec.name)) err(`${spec.name} is declared twice`);
    const handle = new Compartment(spec.name, spec.id, spec.intent, spec.template || null);
    handle.isComponent = !!spec.component;
    const constraints = spec.constraints.map(k => ({
      name: k.name, needs: k.needs, line: k.line, boundary: !!k.boundary,
      def: constraintFor(spec.name, k),
    }));
    const c = { handle, state: spec.state, constraints, handlers: spec.handlers, fns: spec.fns, component: null };
    if (spec.component) {
      const k = spec.component;
      const ins = mkMap(), outs = mkMap();
      for (const h of k.ins) ins[h.name] = h;
      for (const h of k.outs) outs[h.name] = h;
      const record = graphRecords({ components: [{
        id: spec.id, namespace: k.namespace, name: spec.name, version: k.version, uuid: k.uuid, intent: spec.intent,
        boundary: spec.constraints.filter(x => x.boundary).map(x => x.name), ins: k.ins, outs: k.outs,
        kinds: k.kinds || [], template: spec.template || null,
      }], wires: [] }).components[0];
      c.component = { namespace: k.namespace, version: k.version, ins, outs, record, decl: k, kinds: (k.kinds || []).slice(), typedState: k.typedState || [] };
      checkTypedState(c, c.state);
    }
    // initial state: every hard constraint whose needs are present must hold
    for (const k of constraints) {
      const r = runConstraint(c, k, c.state);
      if (r.ok === false && !k.def.permitsViolation) err(`${spec.component ? 'component' : 'compartment'} ${spec.name}: initial state breaks ${k.boundary ? 'boundary' : 'constraint'} ${k.name}`);
    }
    W.comps.push(c);
    W.byName.set(spec.name, c);
    if (c.component) {
      const r = c.component.record;
      append('register', { name: spec.name, id: r.id, namespace: r.namespace, version: r.version, uuid: r.uuid, boundary: r.boundary, kinds: r.kinds, template: r.template, state: toData(c.state, 'state') });
    } else append('compartment', { name: spec.name, id: spec.id, state: toData(c.state, 'state') });
    return handle;
  };

  /** state fields a kind types: checked when a component appears and before every commit */
  function checkTypedState(c, st) {
    for (const f of c.component.typedState) {
      const v = st[f.name];
      const ok = (v === null || v === undefined) ? (f.type.nullable || f.type.name === 'any') : (() => {
        try { rt.ty(v, f.type.name, false, 'x'); return true; } catch (_) { return false; }
      })();
      if (!ok) err(`${c.handle.name} breaks kind ${f.kind}: state.${f.name} must be ${f.type.name}${f.type.nullable ? '?' : ''}, got ${typeOf(v)} ${show(v, true)}`);
    }
  }

  const inHandler = () => W.ctx.some(x => x.kind === 'handler');
  const worldChange = (what) => {
    noLens(what);
    if (inHandler()) err(`${what} changes the world, not a transition — it is not allowed in handlers or in hooks`);
  };

  rt.template = (name, arity, factory) => { W.templates.set(name, { arity, factory }); };

  /** spawn T(id, …args) → a live component instance named T(id) */
  rt.spawn = (name, args) => {
    worldChange('spawn');
    const t = W.templates.get(name);
    if (!t) err(`template ${name} is used before its declaration ran`);
    if (args.length !== t.arity + 1) err(`spawn ${name} takes an id and ${t.arity} argument(s), got ${args.length} in all`);
    const id = args[0];
    if (typeof id !== 'string' || !id) err(`spawn ${name}: the first argument is the instance id, a non-empty string — got ${typeOf(id)} ${show(id, true)}`);
    const file = rt.file, line = rt.line;
    let spec;
    try { spec = t.factory(id, ...args.slice(1)); }
    finally { rt.file = file; rt.line = line; }
    spec.template = name;
    return rt.declare(spec);
  };

  rt.despawn = (h) => {
    worldChange('despawn');
    if (!(h instanceof Compartment)) err(`despawn needs a component instance, got ${typeOf(h)}`);
    const c = liveOf(h);
    if (!h.template) err(`${h.name} was declared, not spawned — only spawned instances can be despawned`);
    const touching = (e) => e.signal === undefined && e.comp === h.name;
    for (const w of W.wires.filter(w => touching(w.from) || touching(w.to))) append('unwire', { from: endText(w.from), to: endText(w.to), reason: 'despawn' });
    W.wires = W.wires.filter(w => !(touching(w.from) || touching(w.to)));
    W.comps.splice(W.comps.indexOf(c), 1);
    W.byName.delete(h.name);
    append('despawn', { name: h.name, id: h.id, template: h.template, state: toData(c.state, 'state') });
  };

  rt.comp = (name) => {
    const c = W.byName.get(name);
    if (!c) err(`compartment ${name} is used before its declaration ran`);
    return c.handle;
  };

  function runConstraint(c, k, next) {
    const view = mkMap();
    for (const key of Object.keys(next)) if (next[key] !== null && next[key] !== undefined) view[key] = next[key];
    const file = rt.file, line = rt.line;
    W.lens++;
    try {
      return evaluate(k.def, view, {});
    } finally {
      W.lens--;
      rt.file = file; rt.line = line;
    }
  }
  /** wraps a compiled/interpreted constraint body: (frozen state) → bool, demanded */
  rt.constraintCheck = (name, body) => (view) => {
    const v = body(freeze(clone(view)));
    if (typeof v !== 'boolean') err(`constraint ${name} must give a bool, got ${typeOf(v)}`);
    return v;
  };

  rt.onTop = (signal, run) => { W.globalHandlers.push({ signal, run }); };

  const matches = (pattern, name) => pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
  const curCtx = () => W.ctx[W.ctx.length - 1];

  rt.emit = (name, payload) => {
    noLens('emit');
    if (typeof name !== 'string') err(`a signal name must be a string, got ${typeOf(name)}`);
    if (payload !== null && payload !== undefined && !isMap(payload)) err(`a signal payload must be a map, got ${typeOf(payload)}`);
    const sig = { kind: 'signal', name, payload: freeze(toData(payload === undefined || payload === null ? mkMap() : payload, 'a signal payload')) };
    enqueue(sig);
  };

  function enqueue(item) {
    const cx = curCtx();
    if (cx.kind === 'handler') { cx.buffer.push(item); return; }
    cx.queue.push(item);
    if (!cx.draining) drain(cx);
  }
  const label = it => (it.kind === 'port' ? `→${it.comp}.${it.hook}` : it.kind === 'out' ? `${it.comp}.${it.hook}` : it.name);

  // ── components: hooks, shapes, wires ──
  function getComponent(target, what) {
    let c;
    if (target instanceof Compartment) c = liveOf(target);
    else if (typeof target === 'string') { c = W.byName.get(target); if (!c) err(`${target} is used before its declaration ran`); }
    else err(`${what} needs a component, got ${typeOf(target)} ${show(target, true)}`);
    const name = c.handle.name;
    if (!c.component) err(`${what}: ${name} is a compartment, not a component — only components have hooks`);
    return c;
  }
  /** a payload against a hook's shape: every field present with its type, nothing extra */
  function checkShape(payload, shape, what) {
    if (!shape) return;
    const names = new Set(shape.fields.map(f => f.name));
    for (const k of Object.keys(payload)) if (!names.has(k)) err(`${what} has no field "${k}" — its shape is {${shape.fields.map(f => `${f.name}: ${f.type.name}${f.type.nullable ? '?' : ''}`).join(', ')}}`);
    for (const f of shape.fields) rt.ty(Object.prototype.hasOwnProperty.call(payload, f.name) ? payload[f.name] : null, f.type.name, f.type.nullable, `${what} field ${f.name}`);
  }
  const portPayload = (payload, what) => {
    if (payload !== null && payload !== undefined && !isMap(payload)) err(`${what} payload must be a map, got ${typeOf(payload)}`);
    return freeze(toData(payload === undefined || payload === null ? mkMap() : payload, `${what} payload`));
  };

  /** emit out hook { … } — only from a component's own in hook */
  rt.emitOut = (hook, payload) => {
    noLens('emit out');
    let owner = null;
    for (let i = W.ctx.length - 1; i >= 0; i--) if (W.ctx[i].comp) { owner = W.ctx[i].comp; break; }
    if (!owner || !owner.component) err('emit out is only possible inside a component\'s in hook');
    const name = owner.handle.name;
    const h = owner.component.outs[hook];
    if (!h) err(`component ${name} has no out hook "${hook}"`);
    const p = portPayload(payload, `${name}.${hook}`);
    checkShape(p, h.shape, `out hook ${name}.${hook}`);
    enqueue({ kind: 'out', comp: name, hook, payload: p });
  };

  /** send Comp.hook { … } — feed a component's in hook directly */
  rt.send = (target, hook, payload) => {
    noLens('send');
    const c = getComponent(target, 'send');
    const compName = c.handle.name;
    const h = c.component.ins[hook];
    if (!h) err(`component ${compName} has no in hook "${hook}"`);
    const p = portPayload(payload, `${compName}.${hook}`);
    checkShape(p, h.shape, `in hook ${compName}.${hook}`);
    enqueue({ kind: 'port', comp: compName, hook, payload: p });
  };

  const sameEnd = (a, b) => (a.signal !== undefined ? a.signal === b.signal : a.comp === b.comp && a.hook === b.hook);
  const endText = e => (e.signal !== undefined ? JSON.stringify(e.signal) : `${e.comp}.${e.hook}`);
  /** a wire end from either backend: {signal} | {comp: name, hook} | {handle: instance, hook} */
  const normEnd = (e, what) => {
    if (e.signal !== undefined) return { signal: e.signal };
    if (e.handle !== undefined) return { comp: getComponent(e.handle, what).handle.name, hook: e.hook };
    return { comp: e.comp, hook: e.hook };
  };
  rt.wire = (fromEnd, toEnd, line) => {
    worldChange('wire');
    if (fromEnd.signal !== undefined && toEnd.signal !== undefined) err('a wire joins at least one hook — signal to signal is an on handler');
    const from = normEnd(fromEnd, 'wire'), to = normEnd(toEnd, 'wire');
    if (from.signal === undefined) {
      const c = getComponent(from.comp, 'wire');
      if (!c.component.outs[from.hook]) err(`${c.component.ins[from.hook] ? `${from.comp}.${from.hook} is an in hook — a wire runs out → in` : `component ${from.comp} has no out hook "${from.hook}"`}`);
    }
    if (to.signal === undefined) {
      const c = getComponent(to.comp, 'wire');
      if (!c.component.ins[to.hook]) err(`${c.component.outs[to.hook] ? `${to.comp}.${to.hook} is an out hook — a wire runs out → in` : `component ${to.comp} has no in hook "${to.hook}"`}`);
    }
    if (W.wires.some(w => sameEnd(w.from, from) && sameEnd(w.to, to))) err(`wire ${endText(from)} -> ${endText(to)} is declared twice`);
    W.wires.push({ from, to, line });
    append('wire', { from: endText(from), to: endText(to), line });
  };

  function wireTarget(to, payload) {
    if (to.signal !== undefined) return { kind: 'signal', name: to.signal, payload };
    return { kind: 'port', comp: to.comp, hook: to.hook, payload };
  }

  function drain(cx) {
    cx.draining = true;
    let deliveries = 0;
    try {
      while (cx.queue.length) {
        if (++deliveries > P.dispatch.max_deliveries) err(`signal storm — more than ${P.dispatch.max_deliveries} deliveries in one drain`);
        deliver(cx, cx.queue.shift());
      }
    } catch (e) {
      const remaining = cx.queue.map(label);
      cx.queue.length = 0;
      append('aborted', { remaining, error: rt.toError(e).bare });
      throw e;
    } finally {
      cx.draining = false;
    }
  }

  function deliver(cx, it) {
    if (it.kind === 'port') return deliverPort(cx, it);
    if (it.kind === 'out') {
      const ws = W.wires.filter(w => w.from.signal === undefined && w.from.comp === it.comp && w.from.hook === it.hook);
      if (!ws.length) {
        W.unrouted.push(label(it));
        append('unrouted', { signal: label(it), payload: it.payload });
        if (P.dispatch.unrouted === 'error') err(`unrouted out hook ${label(it)} — no wire takes it (primitives: dispatch.unrouted is "error")`);
      }
      for (const w of ws) cx.queue.push(wireTarget(w.to, it.payload));
      return;
    }
    const sig = it;
    let claimed = false;
    for (const c of W.comps.slice()) {
      for (const h of c.handlers) {
        if (!matches(h.signal, sig.name)) continue;
        claimed = true;
        runHandler(cx, c, sig.name, (working) => h.run(working, sig.payload));
      }
    }
    for (const w of W.wires) {
      if (w.from.signal === undefined || !matches(w.from.signal, sig.name)) continue;
      claimed = true;
      cx.queue.push(wireTarget(w.to, sig.payload));
    }
    for (const h of W.globalHandlers.slice()) {
      if (!matches(h.signal, sig.name)) continue;
      claimed = true;
      const hx = { kind: 'handler', buffer: [] };
      W.ctx.push(hx);
      try { h.run(sig.payload); } finally { W.ctx.pop(); }
      for (const s of hx.buffer) cx.queue.push(s);
    }
    if (!claimed) {
      W.unrouted.push(sig.name);
      append('unrouted', { signal: sig.name, payload: sig.payload });
      if (P.dispatch.unrouted === 'error') err(`unrouted signal "${sig.name}" — no handler or wire takes it (primitives: dispatch.unrouted is "error")`);
    }
  }

  function deliverPort(cx, it) {
    const c = getComponent(it.comp, 'deliver');
    const h = c.component.ins[it.hook];
    checkShape(it.payload, h.shape, `in hook ${it.comp}.${it.hook}`);
    runHandler(cx, c, `→${it.comp}.${it.hook}`, (working) => h.run(working, it.payload));
  }

  function runHandler(cx, c, sigName, run) {
    const sig = { name: sigName };
    const working = clone(c.state);
    const hx = { kind: 'handler', buffer: [], comp: c };
    W.ctx.push(hx);
    try { run(working); } finally { W.ctx.pop(); }
    const name = c.handle.name;
    const violations = [];
    for (const k of c.constraints) {
      const r = runConstraint(c, k, working);
      if (r.gap) {
        const g = openGap(`${name}.${k.name} cannot be evaluated: state.${r.gap} is null`, P.gaps.constraint_gap.pressure, P.gaps.constraint_gap.type);
        append('gap', { compartment: name, signal: sig.name, constraint: k.name, missing: r.gap, gap: g.id, discarded: hx.buffer.map(label) });
        cx.queue.push({ name: P.signals.gap_opened, payload: freeze(toData(g, 'gap')) });
        if (!P.transitions.discard_emits_on_refusal) for (const s of hx.buffer) cx.queue.push(s);
        return;
      }
      if (r.ok === false) {
        if (!k.def.permitsViolation) {
          append('rejected', { compartment: name, signal: sig.name, constraint: k.name, boundary: k.boundary, reason: r.reason, discarded: hx.buffer.map(label) });
          const p = mkMap(); p.compartment = name; p.signal = sig.name; p.constraint = k.name; p.boundary = k.boundary;
          cx.queue.push({ name: P.signals.rejected, payload: freeze(p) });
          if (!P.transitions.discard_emits_on_refusal) for (const s of hx.buffer) cx.queue.push(s);
          return;
        }
        violations.push({ constraint: k.name, cost: k.def.violationCost });
      }
    }
    if (c.component) checkTypedState(c, working);
    const changes = mkMap();
    for (const key of Object.keys(working)) if (!eq(working[key], c.state[key])) changes[key] = toData(working[key], 'state');
    const cost = violations.reduce((s, v) => s + v.cost, 0);
    W.spent += cost;
    c.state = working;
    append('transition', { compartment: name, signal: sig.name, changes, violations, spent: W.spent });
    for (const s of hx.buffer) cx.queue.push(s);
  }

  // ── gaps, records, promotion ──
  function openGap(message, pressure, type) {
    const g = mkMap();
    g.id = uid('gap'); g.message = message; g.pressure = pressure; g.type = type; g.line = rt.line; g.file = rt.file;
    freeze(g);
    W.gaps.push(g);
    return g;
  }
  rt.gap = (message, pressure, type) => {
    noLens('gap');
    if (typeof message !== 'string') err(`a gap message must be a string, got ${typeOf(message)}`);
    const G = P.gaps;
    if (typeof pressure !== 'number' || pressure < G.pressure_min || pressure > G.pressure_max) err(`gap pressure must be a num in [${G.pressure_min}, ${G.pressure_max}], got ${show(pressure, true)}`);
    const t = type || G.default_type;
    if (!G.types.includes(t)) err(`gap type must be one of ${G.types.join(', ')}`);
    const g = openGap(message, pressure, t);
    append('gap', { gap: g.id, message, pressure, type: t, line: rt.line });
    rt.emit(P.signals.gap_opened, toData(g, 'gap'));
    return g;
  };
  rt.record = (kind, payload) => {
    noLens('record');
    if (typeof kind !== 'string') err(`record needs a string kind, got ${typeOf(kind)}`);
    if (L.RESERVED_KINDS.has(kind)) err(`record cannot write the kind "${kind}": the runtime owns it`);
    return append(kind, toData(payload === undefined ? null : payload, 'a record payload'));
  };
  rt.promote = (value, proof) => {
    noLens('promote');
    if (typeof proof !== 'boolean') err(`a proof must be a bool, got ${typeOf(proof)}`);
    if (proof) {
      append('promote', { value: toData(value, 'a promoted value'), line: rt.line });
      const p = mkMap(); p.value = value;
      rt.emit(P.signals.promoted, p);
    } else {
      append('promotion_refused', { value: toData(value, 'a promoted value'), line: rt.line });
      rt.gap(`promotion refused at line ${rt.line}: its proof is false`, P.gaps.promotion_refused.pressure, P.gaps.promotion_refused.type);
    }
  };

  // ── whatif: fork the world, run, restore ──
  function snapshot() {
    return {
      states: W.comps.map(c => c.state), comps: W.comps.slice(), handlers: W.globalHandlers.length,
      ledger: W.ledger.length, lastCkpt: W.lastCkpt, gaps: W.gaps.length, rng: W.rng.pos, spent: W.spent, unrouted: W.unrouted.length,
      axioms: W.axioms.length, ctx: W.ctx.length, wires: W.wires.slice(), templates: [...W.templates.keys()],
    };
  }
  function restore(s) {
    W.comps = s.comps;
    W.byName = new Map(W.comps.map(c => [c.handle.name, c]));
    W.comps.forEach((c, i) => { c.state = s.states[i]; });
    for (const k of [...W.templates.keys()]) if (!s.templates.includes(k)) W.templates.delete(k);
    W.globalHandlers.length = s.handlers;
    W.ledger.length = s.ledger;
    W.lastCkpt = s.lastCkpt;
    W.gapEntries = W.ledger.filter(e => e.kind === 'gap').length;
    W.gaps.length = s.gaps;
    W.rng.pos = s.rng;
    W.spent = s.spent;
    W.unrouted.length = s.unrouted;
    W.axioms.length = s.axioms;
    W.ctx.length = s.ctx;
    W.wires = s.wires;
  }
  rt.whatif = (body) => {
    const line = rt.line;
    const snap = snapshot();
    W.ctx.push({ kind: 'whatif', queue: [], draining: false });
    let result;
    try { result = body(); }
    finally { restore(snap); }
    rt.line = line;
    append('whatif', { line });
    return result === undefined ? null : result;
  };

  // ── axioms ──
  rt.axiom = (name, line, check) => {
    W.axioms.push({ name, line, check });
    append('axiom', { name });
    checkOne(W.axioms[W.axioms.length - 1]);
  };
  function checkOne(a) {
    const file = rt.file, l = rt.line;
    let v;
    W.lens++;
    try { v = a.check(); } finally { W.lens--; rt.file = file; rt.line = l; }
    if (typeof v !== 'boolean') err(`axiom ${a.name} must give a bool, got ${typeOf(v)}`);
    if (!v) err(`axiom ${a.name} (line ${a.line}) violated`);
  }
  /** after a top-level statement: line is that statement's, so a violation names where it happened */
  rt.axioms = (line, file) => { rt.at(line, file); for (const a of W.axioms) checkOne(a); };

  rt.expect = (cond, msg) => {
    if (typeof cond !== 'boolean') err(`expect needs a bool, got ${typeOf(cond)}`);
    if (!cond) err(msg === null || msg === undefined ? 'expectation failed' : `expectation failed: ${show(msg)}`);
  };

  rt.errValue = (e) => {
    const x = rt.toError(e);
    const m = mkMap(); m.message = x.bare || x.message; m.line = x.line; m.file = x.file;
    return m;
  };

  // ── modules ──
  rt.use = (relPath, alias, fromFile) => {
    if (!loadModule) err('use is not available in this runtime');
    const path = require('path');
    const abs = path.resolve(path.dirname(fromFile), relPath);
    if (W.modules.has(abs)) return W.modules.get(abs);
    if (W.loading.has(abs)) err(`circular use of ${relPath}`);
    W.loading.add(abs);
    const file = rt.file, line = rt.line;
    let exportsMap;
    try { exportsMap = loadModule(abs, rt); }
    finally { W.loading.delete(abs); rt.file = file; rt.line = line; }
    const m = new EModule(alias, exportsMap);
    W.modules.set(abs, m);
    return m;
  };

  rt.test = (name, line, body) => { W.tests.push({ name, line, body }); };

  // ── builtins ─────────────────────────────────────────────────────────────
  const B = mkMap();
  const def = (name, arity, impl) => { B[name] = rt.fn(name, arity, impl); };
  const needList = (v, who) => { if (!Array.isArray(v)) err(`${who} needs a list, got ${typeOf(v)}`); return v; };
  const needStr = (v, who) => { if (typeof v !== 'string') err(`${who} needs a string, got ${typeOf(v)}`); return v; };
  const needNum = (v, who) => { if (typeof v !== 'number') err(`${who} needs a num, got ${typeOf(v)}`); return v; };
  const needFn = (v, who) => { if (!isFn(v)) err(`${who} needs a fn, got ${typeOf(v)}`); return v; };
  const needMap = (v, who) => { if (!isMap(v)) err(`${who} needs a map, got ${typeOf(v)}`); return v; };
  const cmpSort = (a, b, who) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    err(`${who} compares nums with nums or strings with strings, got ${typeOf(a)} and ${typeOf(b)}`);
  };

  def('print', [0, -1], (...xs) => { out(xs.map(x => show(x)).join(' ') + '\n'); return null; });
  def('str', 1, v => show(v));
  def('num', 1, v => {
    if (typeof v === 'number') return v;
    if (isI(v)) { const n = Number(v); if (BigInt(n) !== v) err(`num(${v}): an int above 2^53 is not exactly representable as num`); return n; }
    const s = needStr(v, 'num').trim();
    const n = s === '' ? NaN : Number(s);
    if (Number.isNaN(n)) err(`num cannot read ${JSON.stringify(v)}`);
    return n;
  });
  // int(x): the explicit way into the 64-bit int. A num is truncated toward zero; a string must be plain decimal digits.
  def('int', 1, v => {
    if (isI(v)) return v;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!/^[+-]?[0-9]+$/.test(s)) err(`int cannot read ${JSON.stringify(v)}`);
      return fit(BigInt(s), 'int()');
    }
    if (typeof v !== 'number') err(`int needs a num, an int or a string, got ${typeOf(v)}`);
    if (!Number.isFinite(v)) err(`int cannot convert ${show(v)}`);
    return fit(BigInt(Math.trunc(v)), 'int()');
  });
  def('floor', 1, v => Math.floor(needNum(v, 'floor')));
  def('ceil', 1, v => Math.ceil(needNum(v, 'ceil')));
  def('round', 1, v => Math.round(needNum(v, 'round')));
  def('abs', 1, v => (isI(v) ? fit(v < 0n ? -v : v, 'abs') : Math.abs(needNum(v, 'abs'))));
  def('sqrt', 1, v => { if (needNum(v, 'sqrt') < 0) err('sqrt of a negative num'); return Math.sqrt(v); });
  const minmax = (who, pick) => (...xs) => {
    const ys = xs.length === 1 && Array.isArray(xs[0]) ? xs[0] : xs;
    if (!ys.length) err(`${who} of nothing`);
    if (ys.length && ys.every(isI)) return ys.reduce((m, y) => (pick === Math.min ? (y < m ? y : m) : (y > m ? y : m)));
    for (const y of ys) needNum(y, who);
    return pick(...ys);
  };
  def('min', [1, -1], minmax('min', Math.min));
  def('max', [1, -1], minmax('max', Math.max));
  def('len', 1, v => {
    if (v instanceof EBytes) return v.b.length;
    if (typeof v === 'string' || Array.isArray(v)) return v.length;
    if (isMap(v)) return Object.keys(v).length;
    err(`len needs a string, list or map, got ${typeOf(v)}`);
  });
  def('keys', 1, m => Object.keys(needMap(m, 'keys')));
  def('values', 1, m => Object.keys(needMap(m, 'values')).map(k => m[k]));
  def('has', 2, (m, k) => Object.prototype.hasOwnProperty.call(needMap(m, 'has'), needStr(k, 'has')));
  def('get', [2, 3], (m, k, d = null) => {
    needMap(m, 'get'); needStr(k, 'get');
    return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : d;
  });
  def('clone', 1, v => clone(v));
  def('slice', [2, 3], (v, a, b) => {
    if (v instanceof EBytes) {
      if (!Number.isInteger(a) || (b !== undefined && b !== null && !Number.isInteger(b))) err('slice needs int bounds');
      return new EBytes(Buffer.from(v.b.subarray(a < 0 ? Math.max(0, v.b.length + a) : a, b === undefined || b === null ? undefined : (b < 0 ? v.b.length + b : b))));
    }
    if (typeof v !== 'string' && !Array.isArray(v)) err(`slice needs a string or list, got ${typeOf(v)}`);
    if (!Number.isInteger(a) || (b !== undefined && b !== null && !Number.isInteger(b))) err('slice needs int bounds');
    return v.slice(a, b === undefined || b === null ? undefined : b);
  });
  def('sort', 1, xs => needList(xs, 'sort').slice().sort((a, b) => cmpSort(a, b, 'sort')));
  def('sort_by', [2, 3], (xs, f, dir = 'asc') => {
    needList(xs, 'sort_by'); needFn(f, 'sort_by');
    if (dir !== 'asc' && dir !== 'desc') err('sort_by direction is "asc" or "desc"');
    const keyed = xs.map((x, i) => ({ x, i, k: rt.call(f, [x]) }));
    keyed.sort((p, q) => (dir === 'desc' ? -1 : 1) * cmpSort(p.k, q.k, 'sort_by') || p.i - q.i);
    return keyed.map(p => p.x);
  });
  def('range', [1, 3], (a, b, step) => {
    if (b === undefined) { b = a; a = 0; }
    step = step === undefined ? 1 : step;
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(step)) err('range needs ints');
    if (step === 0) err('range step cannot be 0');
    const r = [];
    if (step > 0) for (let i = a; i < b; i += step) r.push(i);
    else for (let i = a; i > b; i += step) r.push(i);
    return r;
  });
  def('join', [1, 2], (xs, sep = '') => needList(xs, 'join').map(x => show(x)).join(needStr(sep, 'join')));
  def('split', 2, (s, sep) => needStr(s, 'split').split(needStr(sep, 'split')));
  def('upper', 1, s => needStr(s, 'upper').toUpperCase());
  def('lower', 1, s => needStr(s, 'lower').toLowerCase());
  def('trim', 1, s => needStr(s, 'trim').trim());
  def('replace', 3, (s, a, b) => needStr(s, 'replace').split(needStr(a, 'replace')).join(needStr(b, 'replace')));
  def('type_of', 1, v => typeOf(v));
  def('json', 1, v => stringifyBig(toData(v, 'json')));
  def('parse_json', 1, s => {
    let v;
    try { v = JSON.parse(needStr(s, 'parse_json')); } catch (e) { err(`parse_json: ${e.message}`); }
    const conv = x => Array.isArray(x) ? x.map(conv) : (x !== null && typeof x === 'object') ? Object.keys(x).reduce((m, k) => { m[k] = conv(x[k]); return m; }, mkMap()) : x;
    return conv(v);
  });
  def('random', 0, () => W.rng.next());
  def('uid', [0, 1], (prefix = 'id') => uid(needStr(prefix, 'uid')));
  def('gaps', 0, () => W.gaps.slice());
  def('ledger', 0, () => W.ledger.slice());
  def('ledger_verify', [0, 1], (from) => verifyLedger(from));   // ledger_verify() checks the whole chain; ledger_verify(seq) starts from the checkpoint at seq
  // ledger_proof(seq): that entry belongs to the ledger — its Merkle path to the checkpoint that covers it
  def('ledger_proof', 1, (n) => {
    const seq = needNumLoose(n, 'ledger_proof');
    const e = W.ledger[seq - 1];
    if (!Number.isInteger(seq) || !e) err(`ledger_proof: no entry ${show(n, true)}`);
    if (e.kind === 'checkpoint') err(`ledger_proof: entry ${seq} is a checkpoint — it anchors the entries before it`);
    const cp = W.ledger.find(x => x.kind === 'checkpoint' && x.seq > seq);
    if (!cp) err(`ledger_proof: entry ${seq} is not under a checkpoint yet`);
    let p = cp.seq - 2; while (p >= 0 && W.ledger[p].kind !== 'checkpoint') p--;
    const hashes = W.ledger.slice(p + 1, cp.seq - 1).map(x => x.hash);
    const m = mkMap(); m.seq = seq; m.hash = e.hash; m.checkpoint = cp.seq; m.root = cp.body.root;
    m.path = L.merkleProof(hashes, seq - 1 - (p + 1)).map(s => { const o = mkMap(); o.side = s.side; o.hash = s.hash; return o; });
    return m;
  });
  def('ledger_check_proof', 1, (pr) => {
    if (!isMap(pr) || !Array.isArray(pr.path)) err('ledger_check_proof needs a proof map from ledger_proof');
    const e = W.ledger[pr.seq - 1], cp = W.ledger[pr.checkpoint - 1];
    if (!e || !cp || cp.kind !== 'checkpoint' || e.hash !== pr.hash || cp.body.root !== pr.root) return false;
    try { return L.merkleFold(pr.hash, pr.path) === pr.root; } catch (_) { return false; }
  });
  // observe() reads the ledger as a field (CIE-EG §13): the field's regime, the sigma regime, the liminal boundaries and the gap hunt, as data.
  // It refuses a ledger that does not verify. It writes nothing. observe_gaps() hands the hunter's proposals to the gate: each becomes a gap
  // entry carrying its dedup key and evidence, unless a gap with that key is already open. Returns the gaps it opened.
  const observeReport = (what) => {
    const r = require('../observe').observe(W.ledger, { primitives: P });
    if (!r.ok) err(`${what}: the ledger does not verify (entry ${r.verify.seq}: ${r.verify.reason})`);
    return r;
  };
  const dataOf = x => Array.isArray(x) ? x.map(dataOf) : (x !== null && typeof x === 'object') ? Object.keys(x).reduce((m, k) => { m[k] = dataOf(x[k]); return m; }, mkMap()) : x;
  def('observe', 0, () => { const { series, ...r } = observeReport('observe'); return freeze(dataOf(r)); });
  // ledger_why(n): the chain from entry n back to what explains it, and the world at n (CIE-EG §13.7) — the debugger, from inside the program
  def('ledger_why', 1, (n) => {
    const seq = needNumLoose(n, 'ledger_why');
    const D = require('../observe/debug'), w = D.why(W.ledger, seq);
    if (!w.ok) err(`ledger_why: ${w.reason}`);
    return freeze(dataOf(w));
  });
  def('observe_gaps', 0, () => {
    noLens('observe_gaps');
    const opened = [];
    for (const p of observeReport('observe_gaps').gaps.proposals) {
      const g = openGap(p.message, p.pressure, p.type);
      append('gap', { gap: g.id, message: p.message, pressure: p.pressure, type: p.type, line: rt.line, source: 'observe', dedup_key: p.dedup_key, evidence: p.evidence });
      rt.emit(P.signals.gap_opened, toData(g, 'gap'));
      opened.push(g);
    }
    return opened;
  });
  def('spent', 0, () => W.spent);
  def('components', 0, () => {
    const comps = W.comps.filter(c => c.component).map(c => {
      const k = c.component.decl;
      return { id: c.handle.id, namespace: k.namespace, name: c.handle.name, version: k.version, uuid: k.uuid, intent: c.handle.intent,
        boundary: c.component.record.boundary, ins: k.ins, outs: k.outs, kinds: c.component.kinds, template: c.handle.template };
    });
    const g = graphRecords({ components: comps, wires: W.wires });
    const conv = x => Array.isArray(x) ? x.map(conv) : (x !== null && typeof x === 'object') ? Object.keys(x).reduce((m, k) => { m[k] = conv(x[k]); return m; }, mkMap()) : x;
    return freeze(conv(g));
  });
  def('is_kind', 2, (x, k) => {
    needStr(k, 'is_kind');
    if (!(x instanceof Compartment)) return false;
    const c = W.byName.get(x.name);
    return !!(c && c.handle === x && c.component && c.component.kinds.includes(k));
  });
  def('instances', 1, (t) => {
    needStr(t, 'instances');
    if (!W.templates.has(t)) err(`instances: ${t} is not a declared template`);
    return W.comps.filter(c => c.handle.template === t).map(c => c.handle);
  });
  def('args', 0, () => argv.slice());
  def('raise', 1, msg => err(show(msg)));
  def('read_file', 1, p => {
    try { return fs.readFileSync(needStr(p, 'read_file'), 'utf8'); } catch (e) { err(`read_file: ${e.code || e.message} ${p}`); }
  });
  def('write_file', 2, (p, text) => {
    noLens('write_file');
    needStr(p, 'write_file'); needStr(text, 'write_file');
    try { fs.writeFileSync(p, text); } catch (e) { err(`write_file: ${e.code || e.message} ${p}`); }
    append('write', { path: p, bytes: Buffer.byteLength(text) });
    return null;
  });
  // ── bytes (CIE-EG §3) ──
  const needBytes = (v, who) => { if (!(v instanceof EBytes)) err(`${who} needs bytes, got ${typeOf(v)}`); return v.b; };
  const byteList = (v, acc, who) => {
    if (v instanceof EBytes) { for (const x of v.b) acc.push(x); return; }
    if (Array.isArray(v)) { for (const x of v) byteList(x, acc, who); return; }
    if (!Number.isInteger(v) || v < 0 || v > 255) err(`${who}: a byte is an int in 0..255, got ${show(v, true)}`);
    acc.push(v);
  };
  def('bytes', 1, v => {
    if (typeof v === 'string') return new EBytes(Buffer.from(v, 'utf8'));
    const acc = [];
    byteList(v, acc, 'bytes');
    return new EBytes(Buffer.from(acc));
  });
  def('byte_len', 1, v => (typeof v === 'string' ? Buffer.byteLength(v, 'utf8') : needBytes(v, 'byte_len').length));
  def('hex', 1, b => Buffer.from(needBytes(b, 'hex')).toString('hex'));
  def('from_hex', 1, s => {
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(needStr(s, 'from_hex'))) err('from_hex needs pairs of hex digits');
    return new EBytes(Buffer.from(s, 'hex'));
  });
  def('utf8', 1, b => {
    const u = needBytes(b, 'utf8');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u); }
    catch (_) {
      for (let i = 0; i <= u.length; i++) {     // CIE-EG §2.2: name the first bad byte, never produce U+FFFD
        try { new TextDecoder('utf-8', { fatal: true }).decode(u.subarray(0, i + 1)); }
        catch (e2) {
          try { new TextDecoder('utf-8', { fatal: true }).decode(u.subarray(0, i)); } catch (_) { continue; }
          let j = i; while (j > 0 && (u[j] & 0xC0) === 0x80) j--;
          err(`invalid UTF-8 at byte ${j}`);
        }
      }
      err('invalid UTF-8');
    }
  });
  // u8 u16le u32le u64le i32le i64le · u16be u32be u64be — fixed-width integers to bytes. A num or an int in range; anything else is an error.
  const fixed = (who, width, signed, big) => (n) => {
    const bits = BigInt(width * 8);
    const min = signed ? -(2n ** (bits - 1n)) : 0n;
    const max = signed ? 2n ** (bits - 1n) - 1n : 2n ** bits - 1n;
    let v;
    if (isI(n)) v = n;
    else if (Number.isSafeInteger(n)) v = BigInt(n);
    else err(`${who} needs an int in ${min}..${max}, got ${show(n, true)}`);
    if (v < min || v > max) err(`${who} needs an int in ${min}..${max}, got ${show(n, true)}`);
    let u = BigInt.asUintN(width * 8, v);
    const out = Buffer.alloc(width);
    for (let k = 0; k < width; k++) { out[big ? width - 1 - k : k] = Number(u & 0xFFn); u >>= 8n; }
    return new EBytes(out);
  };
  def('u8', 1, fixed('u8', 1, false, false));
  def('u16le', 1, fixed('u16le', 2, false, false));
  def('u32le', 1, fixed('u32le', 4, false, false));
  def('u64le', 1, fixed('u64le', 8, false, false));
  def('i32le', 1, fixed('i32le', 4, true, false));
  def('i64le', 1, fixed('i64le', 8, true, false));
  def('u16be', 1, fixed('u16be', 2, false, true));
  def('u32be', 1, fixed('u32be', 4, false, true));
  def('u64be', 1, fixed('u64be', 8, false, true));
  // read_u64be(bytes, offset) → int: the inverse of u64be, for a value that fits in 63 bits (a larger one is an error, never a wrap)
  def('read_u64be', 2, (b, off) => {
    const u = needBytes(b, 'read_u64be'); needNum(off, 'read_u64be');
    if (!Number.isInteger(off) || off < 0 || off + 8 > u.length) err(`read_u64be: offset ${show(off, true)} needs 8 bytes inside ${u.length}`);
    return fit(Buffer.from(u.subarray(off, off + 8)).readBigUInt64BE(), 'read_u64be');
  });
  def('sha256', 1, v => new EBytes(crypto.createHash('sha256').update(typeof v === 'string' ? Buffer.from(v, 'utf8') : needBytes(v, 'sha256')).digest()));
  def('read_bytes', 1, p => {
    try { return new EBytes(fs.readFileSync(needStr(p, 'read_bytes'))); } catch (e) { err(`read_bytes: ${e.code || e.message} ${p}`); }
  });
  def('write_bytes', 2, (p, b) => {
    noLens('write_bytes');
    needStr(p, 'write_bytes');
    const u = needBytes(b, 'write_bytes');
    try { fs.writeFileSync(p, u); } catch (e) { err(`write_bytes: ${e.code || e.message} ${p}`); }
    append('write', { path: p, bytes: u.length, sha256: crypto.createHash('sha256').update(u).digest('hex') });
    return null;
  });
  def('chmod_exec', 1, p => {
    noLens('chmod_exec');
    try { fs.chmodSync(needStr(p, 'chmod_exec'), 0o755); } catch (e) { err(`chmod_exec: ${e.code || e.message} ${p}`); }
    return null;
  });
  const rot64 = (x, n, left, who) => {
    const c = count64(n, who); const u = BigInt.asUintN(64, x); const k = left ? c : (64n - c) % 64n;
    return wrap64((u << k) | (u >> ((64n - k) % 64n)));
  };
  def('rotl', 2, (x, n) => { if (isI(x)) return rot64(x, n, true, 'rotl'); const w = word(x, 'rotl'); const c = count(n, 'rotl'); return ((w << c) | (w >>> ((32 - c) % 32))) >>> 0; });
  def('rotr', 2, (x, n) => { if (isI(x)) return rot64(x, n, false, 'rotr'); const w = word(x, 'rotr'); const c = count(n, 'rotr'); return ((w >>> c) | (w << ((32 - c) % 32))) >>> 0; });
  def('wrap32', 1, x => { if (!Number.isInteger(x) || !Number.isSafeInteger(x)) err(`wrap32 needs a safe int, got ${show(x, true)}`); return ((x % 4294967296) + 4294967296) % 4294967296; });
  def('shr_u', 2, (x, n) => { if (!isI(x)) err(`shr_u needs an int, got ${typeOf(x)}`); return wrap64(BigInt.asUintN(64, x) >> count64(n, 'shr_u')); });
  const wrapOp = (who, f) => def(who, 2, (a, b) => { if (!isI(a) || !isI(b)) err(`${who} needs two ints, got ${typeOf(a)} and ${typeOf(b)}`); return wrap64(f(a, b)); });
  wrapOp('wrap_add', (a, b) => a + b); wrapOp('wrap_sub', (a, b) => a - b); wrapOp('wrap_mul', (a, b) => a * b);
  def('idiv', 2, (a, b) => {
    if (isI(a) || isI(b)) {
      if (!isI(a) || !isI(b)) mixed('idiv', a, b);
      if (b === 0n) err('division by zero');
      let q = a / b; if (a % b !== 0n && (a < 0n) !== (b < 0n)) q -= 1n;
      return fit(q, 'idiv');
    }
    if (!Number.isInteger(a) || !Number.isInteger(b)) err(`idiv needs two ints, got ${typeOf(a)} ${show(a, true)} and ${typeOf(b)} ${show(b, true)}`);
    if (b === 0) err('division by zero');
    return Math.floor(a / b);
  });
  def('truthy', 2, (v, who) => rt.truth(v, needStr(who, 'truthy')));
  def('find_text', 2, (s, x) => needStr(s, 'find_text').indexOf(needStr(x, 'find_text')));
  def('repr', 1, v => show(v, true));
  rt.b = B;

  // the standard library: lang/core/prelude.eg, built — its fns become builtins (and may replace natives)
  const preludeFile = opts.prelude === false ? null : build.preludePath();
  if (preludeFile) {
    const exportsMap = require(preludeFile)(rt);
    for (const name of Object.keys(exportsMap)) if (!name.startsWith('_') && isFn(exportsMap[name])) { exportsMap[name].__eg.prelude = true; B[name] = exportsMap[name]; }
    rt.file = opts.file || '<input>';
    rt.line = 0;
  }

  // ── program drivers ──────────────────────────────────────────────────────
  function summary() {
    if (!W.unrouted.length) return;
    const counts = new Map();
    for (const n of W.unrouted) counts.set(n, (counts.get(n) || 0) + 1);
    const list = [...counts].map(([n, k]) => k > 1 ? `${n} ×${k}` : n).join(', ');
    errOut(`[emerge] ${W.unrouted.length} unrouted signal(s) logged to the ledger: ${list}\n`);
  }

  /** run a program body; returns the exit code. Errors are printed, never thrown. */
  rt.runMain = (main) => {
    try {
      main();
    } catch (e) {
      const x = rt.toError(e);
      summary();
      errOut(`error: ${x.message}\n`);
      return 1;
    }
    summary();
    if (W.ledger[W.ledger.length - 1].kind !== 'checkpoint') checkpoint();   // §4.6: a checkpoint at clean shutdown
    return 0;
  };

  rt.runTests = (main) => {
    try { main(); } catch (e) {
      errOut(`error: ${rt.toError(e).message}\n`);
      return { exit: 1, passed: 0, failed: 0 };
    }
    let passed = 0, failed = 0;
    for (const t of W.tests) {
      try {
        rt.whatif(() => { rt.line = t.line; t.body(); return null; });
        passed++;
        out(`✓ ${t.name}\n`);
      } catch (e) {
        failed++;
        out(`✗ ${t.name} — ${rt.toError(e).message}\n`);
      }
    }
    out(`${passed} passed, ${failed} failed\n`);
    return { exit: failed ? 1 : 0, passed, failed };
  };

  rt.lastHash = () => (W.ledger.length ? W.ledger[W.ledger.length - 1].hash : null);
  return rt;
}

/** builtin name → arity for the build in effect (the checker's view); recomputed when the build changes */
let arityCache = null;
function builtinArity() {
  if (arityCache && arityCache.gen === build.generation) return arityCache.map;
  const rt = createRuntime({ out: () => {}, err: () => {}, prelude: build.isSeed() ? false : undefined });
  const map = new Map(Object.keys(rt.b).map(k => [k, rt.b[k].__eg.arity]));
  arityCache = { gen: build.generation, map };
  return map;
}

/** leading run flags: --seed N · --test · --ledger <path> · -- ; the rest are the program's args() */
function parseRunArgs(argv) {
  const o = { seed: 0, test: false, ledger: null, args: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { i++; break; }
    if (a === '--seed') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n)) throw new Error(`--seed needs an integer, got ${argv[i]}`);
      o.seed = n;
    } else if (a === '--test') o.test = true;
    else if (a === '--ledger') { o.ledger = argv[++i]; if (!o.ledger) throw new Error('--ledger needs a path'); }
    else break;
  }
  o.args = argv.slice(i);
  return o;
}

function finishRun(rt, opts, code) {
  if (opts.ledger) fs.writeFileSync(opts.ledger, stringifyBig(rt.world.ledger, 2) + '\n');
  return code;
}

/** entry point of a compiled program: node prog.js [--seed N] [--test] [--ledger file] [args…] → exit code */
function runCompiled(load, { file, argv = process.argv.slice(2), out, err } = {}) {
  if (!out) process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(process.exitCode || 0); throw e; });
  let opts;
  try { opts = parseRunArgs(argv); } catch (e) { (err || (s => process.stderr.write(s)))(`error: ${e.message}\n`); return 2; }
  const rt = createRuntime({
    file, seed: opts.seed, argv: opts.args, out, err,
    loadModule: (abs, r) => require(abs.replace(/\.eg$/, '.js'))(r),
  });
  const main = () => load(rt);
  const code = opts.test ? rt.runTests(main).exit : rt.runMain(main);
  return finishRun(rt, opts, code);
}

const runtimeSignals = () => { const S = build.primitives().signals; return [S.rejected, S.gap_opened, S.promoted]; };

module.exports = { EBytes, createRuntime, runCompiled, parseRunArgs, finishRun, builtinArity, runtimeSignals, VERSION, show, eq, Compartment, EModule, isMap, isFn };
