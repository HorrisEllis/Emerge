'use strict';
// lib/handoff.js — how work moves from one system to another: as a file, verified before it moves, tangible at every
// step. James: "each system hands the file off to the target system, using the registry and handshake verification to
// tag the progress and success or failure of the handoff and why. then if it passes can be moved to the physical input
// folder or queue of the system that recieved the handoff." · "nothing pretends to work, and everything is tangible
// until completed."
//
// A handoff is a node file, <id>.handoff, and its state is the folder it is in:
//   sender   output/      its receipt: queued · refused (with why) · then done / failed as the receiver reports back
//   receiver input/       queued — verified and waiting
//            processing/  taken — a command is working on it
//            done/        done — with the command's result
//            failed/      failed — with why
// send() verifies before anything moves: (1) the target is in the registry — a module node, the parent, or a peer in
// config — (2) the handshake: its interaction contract is its own (id) and it accepts this kind (a command node with
// `accepts`), (3) the payload matches the target's schema for that kind when it has one. Refused = a receipt saying why,
// nothing written to the target. drain() takes what is queued, runs the command that accepts it, and reports back to the
// sender's output/. A crash leaves files in processing/; boot puts them back in input/, said in their history.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const env = require('./envelope.js');
const { atomicWrite } = require('./atomic-write.js');
const handshake = require('../contracts/handshake.js');

const DIRS = ['input', 'processing', 'done', 'failed', 'output'];
const STATE_DIR = { queued: 'input', taken: 'processing', done: 'done', failed: 'failed' };

function _dir(root, d) { const p = path.join(root, d); fs.mkdirSync(p, { recursive: true }); return p; }
function _file(dir, id) { return path.join(dir, `${id}.handoff`); }
function _read(file) { try { return env.read(file); } catch (_) { return null; } }
function _write(file, doc) { atomicWrite(file, JSON.stringify(doc, null, 2) + '\n'); return doc; }
function _step(doc, state, by, why = null) {
  const p = doc.payload;
  p.state = state; if (why) p.reason = why;
  p.history = [...(p.history || []), { ts: Date.now(), state, by, ...(why ? { why } : {}) }];
  return doc;
}
function _json(method, url, body, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const u = new URL(url); const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, timeout: timeoutMs, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: `no answer in ${timeoutMs} ms` }); });
    if (data) req.write(data); req.end();
  });
}

/** peers(ctx) -> { name: { dir } | { url } } — the registry's view of who this system can hand off to */
function peers(ctx) {
  const out = {};
  for (const m of ctx.index.list('module')) out[m.system || m.id] = { dir: path.resolve(ctx.root, m.dir), via: 'module' };
  if (ctx.config.parent) {
    const dir = path.resolve(ctx.root, ctx.config.parent);
    let name = null; try { name = JSON.parse(fs.readFileSync(path.join(dir, 'interaction-contract.json'), 'utf8')).id; } catch (_) {}
    if (name) out[name] = { dir, via: 'parent' };
  }
  for (const [name, p] of Object.entries(ctx.config.peers || {})) out[name] = { ...(p.dir ? { dir: path.resolve(ctx.root, p.dir) } : {}), ...(p.url ? { url: p.url } : {}), via: 'config' };
  return out;
}

/** what a system on disk says it is and accepts: its contract, the kinds its command nodes accept, its schemas */
function _onDisk(dir) {
  let contract = null; try { contract = JSON.parse(fs.readFileSync(path.join(dir, 'interaction-contract.json'), 'utf8')); } catch (_) {}
  const accepts = [];
  try {
    const cdir = path.join(dir, 'data', 'nodes', 'command');
    for (const f of fs.readdirSync(cdir).filter(f => f.endsWith('.command'))) {
      const d = _read(path.join(cdir, f)); const a = d && d.payload && d.payload.accepts;
      for (const k of Array.isArray(a) ? a : a ? [a] : []) accepts.push(k);
    }
  } catch (_) {}
  const schemaOf = (kind) => { try { const s = JSON.parse(fs.readFileSync(path.join(dir, 'schemas', `schema.${kind}`), 'utf8')); return s.payload || null; } catch (_) { return null; } };
  return { contract: contract ? { ...contract, accepts } : null, schemaOf };
}

/** verify(ctx, { to, kind, payload }) -> { ok, problems, peer, contract } — nothing moves until this passes */
async function verify(ctx, { to, kind, payload }) {
  const problems = [];
  const peer = peers(ctx)[to];
  if (!peer) return { ok: false, problems: [`${to} is not in this system's registry (no module node, parent or peer by that name)`], peer: null };
  if (!kind) problems.push('a handoff needs a kind');
  let contract = null, schema = null;
  if (peer.dir) {
    const d = _onDisk(peer.dir);
    contract = d.contract; schema = kind ? d.schemaOf(kind) : null;
    if (!contract) problems.push(`${to} has no interaction contract at ${peer.dir}`);
  } else {
    const r = await _json('GET', `${peer.url.replace(/\/$/, '')}/contract`);
    if (r.status !== 200 || !r.json) problems.push(`${to}'s contract did not answer (${r.error || `status ${r.status}`})`); else contract = r.json;
  }
  if (contract) {
    const hs = handshake.verify(contract, { id: to });
    problems.push(...hs.problems);
    if (kind && !(contract.accepts || []).includes(kind)) problems.push(`${to} accepts no "${kind}" — no command node declares accepts: ${kind}`);
  }
  if (payload === undefined || payload === null || typeof payload !== 'object') problems.push('the payload must be an object');
  else if (schema) problems.push(...env.validate({ type: kind, id: '(payload)', uuid: '-', payload }, schema));
  return { ok: !problems.length, problems, peer, contract };
}

/** send(ctx, { to, kind, payload }) -> the receipt (queued or refused, with why) */
async function send(ctx, { to, kind, payload } = {}) {
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (_) { /* refused below */ } }
  const id = `${ctx.system}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const v = await verify(ctx, { to, kind, payload });
  const doc = { envelope: 1, uuid: crypto.randomUUID(), type: 'handoff', id, system: ctx.system, summary: `${kind || '?'} from ${ctx.system} to ${to}`,
    payload: { from: ctx.system, to, kind: kind || null, payload: payload == null ? null : payload, replyTo: { dir: ctx.root, ...(ctx.config.url ? { url: ctx.config.url } : {}) }, state: 'proposed', history: [] } };
  _step(doc, 'verifying', ctx.system);
  if (!v.ok) {
    _step(doc, 'refused', ctx.system, v.problems.join('; '));
    _write(_file(_dir(ctx.root, 'output'), id), doc);
    ctx.bus.emit(`${ctx.system}.handoff.refused`, { id, to, kind, why: v.problems });
    return doc.payload && { id, ...doc.payload };
  }
  _step(doc, 'queued', ctx.system);
  if (v.peer.dir) _write(_file(_dir(v.peer.dir, 'input'), id), doc);
  else {
    const r = await _json('POST', `${v.peer.url.replace(/\/$/, '')}/handoff`, doc);
    if (r.status !== 200) _step(doc, 'refused', ctx.system, `${to} did not take it: ${(r.json && r.json.error) || r.error || `status ${r.status}`}`);
  }
  _write(_file(_dir(ctx.root, 'output'), id), doc);
  ctx.bus.emit(`${ctx.system}.handoff.${doc.payload.state}`, { id, to, kind });
  return { id, ...doc.payload };
}

/** accept(ctx, doc) — a handoff arriving over HTTP lands in input/, exactly as a file would */
function accept(ctx, doc) {
  if (!doc || doc.type !== 'handoff' || !doc.id || !doc.payload) throw Object.assign(new Error('not a handoff node'), { status: 400 });
  if (doc.payload.to !== ctx.system) throw Object.assign(new Error(`this is ${ctx.system}, the handoff is for ${doc.payload.to}`), { status: 409 });
  _write(_file(_dir(ctx.root, 'input'), doc.id), doc);
  return { ok: true, id: doc.id, state: 'queued' };
}

/** receipt(ctx, doc) — the receiver's report on a handoff this system sent: its output/ receipt takes the new state */
function receipt(ctx, doc) {
  if (!doc || doc.type !== 'handoff' || !doc.id) throw Object.assign(new Error('not a handoff node'), { status: 400 });
  _write(_file(_dir(ctx.root, 'output'), doc.id), doc);
  ctx.bus.emit(`${ctx.system}.handoff.reported`, { id: doc.id, state: doc.payload.state, reason: doc.payload.reason || null });
  return { ok: true };
}

async function _report(ctx, doc) {
  const r = doc.payload.replyTo || {};
  try {
    if (r.dir && fs.existsSync(r.dir)) _write(_file(_dir(r.dir, 'output'), doc.id), doc);
    else if (r.url) await _json('POST', `${r.url.replace(/\/$/, '')}/handoff/receipt`, doc);
  } catch (_) { /* the receiver's own folders still say what happened */ }
}

/** recover(ctx) — a crash left work in processing/: back to input/, said in its history */
function recover(ctx) {
  const pdir = _dir(ctx.root, 'processing'), back = [];
  for (const f of fs.readdirSync(pdir).filter(f => f.endsWith('.handoff'))) {
    const doc = _read(path.join(pdir, f)); if (!doc) continue;
    _step(doc, 'queued', ctx.system, 'found in processing/ at boot — the work it was in did not finish; queued again');
    _write(_file(_dir(ctx.root, 'input'), doc.id), doc); fs.unlinkSync(path.join(pdir, f)); back.push(doc.id);
  }
  return back;
}

/** drain(ctx) — take each queued handoff, run the command that accepts its kind, move it to done/ or failed/ */
async function drain(ctx) {
  const commands = require('./commands.js');
  const idir = _dir(ctx.root, 'input'), out = [];
  for (const f of fs.readdirSync(idir).filter(f => f.endsWith('.handoff')).sort()) {
    const doc = _read(path.join(idir, f)); if (!doc) continue;
    const taken = _file(_dir(ctx.root, 'processing'), doc.id);
    _write(taken, _step(doc, 'taken', ctx.system)); fs.unlinkSync(path.join(idir, f));
    ctx.bus.emit(`${ctx.system}.handoff.taken`, { id: doc.id, from: doc.payload.from, kind: doc.payload.kind });
    const cmd = ctx.index.list('command').find(c => (Array.isArray(c.accepts) ? c.accepts : [c.accepts]).includes(doc.payload.kind));
    let state = 'done', why = null;
    if (!cmd) { state = 'failed'; why = `no command here accepts "${doc.payload.kind}"`; }
    else {
      try { doc.payload.result = await commands.run(ctx, cmd.id, { ...(doc.payload.payload || {}), handoff: { id: doc.id, from: doc.payload.from, kind: doc.payload.kind } }); }
      catch (e) { state = 'failed'; why = e.message; }
    }
    _step(doc, state, ctx.system, why);
    _write(_file(_dir(ctx.root, STATE_DIR[state]), doc.id), doc); fs.unlinkSync(taken);
    ctx.bus.emit(`${ctx.system}.handoff.${state}`, { id: doc.id, from: doc.payload.from, kind: doc.payload.kind, ...(why ? { why } : {}) });
    await _report(ctx, doc);
    out.push({ id: doc.id, state, ...(why ? { why } : {}) });
  }
  return out;
}

/** handoffs(args, ctx) — every handoff here, by folder; a sent one queued longer than stallMs is stalled */
function handoffs(args = {}, ctx) {
  const stallMs = Number(args.stallMs || (ctx.config.handoff && ctx.config.handoff.stallMs) || 600000);
  const out = { system: ctx.system };
  for (const d of DIRS) {
    let files = []; try { files = fs.readdirSync(path.join(ctx.root, d)).filter(f => f.endsWith('.handoff')); } catch (_) {}
    out[d] = files.map(f => _read(path.join(ctx.root, d, f))).filter(Boolean).map(doc => ({ id: doc.id, from: doc.payload.from, to: doc.payload.to, kind: doc.payload.kind, state: doc.payload.state, reason: doc.payload.reason || null, at: (doc.payload.history || []).slice(-1)[0]?.ts || null }))
      .sort((a, b) => (b.at || 0) - (a.at || 0));
  }
  out.stalled = out.output.filter(h => h.state === 'queued' && h.at && Date.now() - h.at > stallMs).map(h => h.id);
  out.peers = Object.fromEntries(Object.entries(peers(ctx)).map(([k, v]) => [k, v.via]));
  return out;
}

/** start(ctx) — recover, then drain input/ on an interval; stop() ends it */
function start(ctx, { pollMs = (ctx.config.handoff && ctx.config.handoff.pollMs) || 1000 } = {}) {
  const back = recover(ctx);
  if (back.length) ctx.bus.emit(`${ctx.system}.handoff.recovered`, { ids: back });
  let busy = false;
  const timer = setInterval(async () => { if (busy) return; busy = true; try { await drain(ctx); } catch (e) { ctx.bus.emit(`${ctx.system}.handoff.drain_failed`, { error: e.message }); } finally { busy = false; } }, pollMs);
  if (timer.unref) timer.unref();
  return { stop: () => clearInterval(timer) };
}

/** the command handler: node cli.js handoff --to <system> --kind <kind> --payload '{…}' (commands call (args, ctx)) */
function handoff(args = {}, ctx) { return send(ctx, args); }

module.exports = { DIRS, peers, verify, send, accept, receipt, drain, recover, handoffs, handoff, start };
