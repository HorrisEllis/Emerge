'use strict';
// lib/modules.js — a system's modules are systems: the same skeleton, one level down. James: "nexus is recursive, builds
// itself, using itself. the same architecture on every level." · "each module in nexus is a system with its own modules."
//
// The system carries its own template (template/nexus-system.template.json — every skeleton file, placeholders written
// [[key]] so laying out the system did not fill them). newModule() lays that template out again under modules/<slug>/:
// a whole system — registry, contract, nodes, schemas, bus, ledger, handoff folders, its own copy of the template, so it
// can nest further. The parent learns of it by one node, data/nodes/module/<slug>.module (its dir, its contract hash);
// nothing else in the parent changes. The child knows its parent by config.parent. They meet only through the contract
// and handoffs (lib/handoff.js): a child is a peer the parent can hand work to, and the parent is one the child can.
// boot(name) starts a child in this process (a module needs no port of its own until it is given one).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('./envelope.js');
const { atomicWrite } = require('./atomic-write.js');
const handshake = require('../contracts/handshake.js');

const TEMPLATE = path.join('template', 'nexus-system.template.json');

function slugOf(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48); }

function template(root) {
  const file = path.join(root, TEMPLATE);
  if (!fs.existsSync(file)) throw Object.assign(new Error(`no ${TEMPLATE} — this system cannot lay out a module`), { status: 409 });
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** fill(text, vars) — [[key]] → its value; an unknown key is left as it is (said by the caller's check) */
function fill(text, vars) { return String(text).replace(/\[\[(\w+)\]\]/g, (m, k) => (k in vars ? String(vars[k]) : m)); }

/** newModule(args, ctx) — node cli.js module --name "Audio Engine" --description "…" */
function newModule(args = {}, ctx) {
  const name = String(args.name || '').trim();
  const slug = slugOf(name);
  if (!slug) throw Object.assign(new Error('a module needs a name'), { status: 400 });
  if (slug === ctx.system) throw Object.assign(new Error(`a module cannot share its parent's name (${slug})`), { status: 409 });
  const rel = path.join('modules', slug);
  const dir = path.join(ctx.root, rel);
  if (fs.existsSync(path.join(dir, 'registry-components.js'))) throw Object.assign(new Error(`module ${slug} already exists at ${rel}`), { status: 409 });
  const t = template(ctx.root);
  const vars = { name, NAME: name, projectName: name, instanceName: name, slug, SLUG: slug.toUpperCase().replace(/-/g, '_'),
    uuid8: crypto.randomBytes(4).toString('hex'), description: String(args.description || name).replace(/["\\\r\n]+/g, ' ').slice(0, 240) };
  const written = [];
  for (const f of t.files) {
    const p = fill(f.path, vars);
    if (p.split(/[\\/]/).includes('..')) continue;
    atomicWrite(path.join(dir, p), fill(f.content, vars));
    written.push(p);
  }
  // the template travels whole and unfilled, so the module can lay out modules of its own
  atomicWrite(path.join(dir, TEMPLATE), JSON.stringify(t, null, 2) + '\n');
  // the child knows its parent; it has no port until one is given (it runs in its parent's process)
  const cfgFile = path.join(dir, `${slug}.config.json`);
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  atomicWrite(cfgFile, JSON.stringify({ ...cfg, port: null, parent: path.relative(dir, ctx.root) || '..' }, null, 2) + '\n');
  for (const d of ['input', 'processing', 'done', 'failed', 'output']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const contract = JSON.parse(fs.readFileSync(path.join(dir, 'interaction-contract.json'), 'utf8'));
  const node = env.write(ctx.root, 'module', slug, { system: slug, dir: rel.split(path.sep).join('/'), mode: 'library', contractHash: handshake.hash(contract), files: written.length },
    { system: ctx.system, summary: `${name} — a module of ${ctx.system}, itself a system` });
  ctx.listener.sync();
  ctx.bus.emit(`${ctx.system}.module.created`, { module: slug, dir: node.payload.dir, files: written.length });
  return { module: slug, dir: node.payload.dir, files: written.length, contract: contract.id };
}

/** modules(args, ctx) — each module: its contract checked against the hash it was registered with, its own modules */
function modules(args = {}, ctx) {
  return { system: ctx.system, modules: ctx.index.list('module').map((m) => {
    const dir = path.resolve(ctx.root, m.dir);
    let contract = null; try { contract = JSON.parse(fs.readFileSync(path.join(dir, 'interaction-contract.json'), 'utf8')); } catch (_) {}
    const hs = contract ? handshake.verify(contract, { id: m.system, hash: m.contractHash }) : { ok: false, problems: [`no contract at ${m.dir}`] };
    let nested = 0; try { nested = fs.readdirSync(path.join(dir, 'data', 'nodes', 'module')).filter(f => f.endsWith('.module')).length; } catch (_) {}
    return { id: m.id, system: m.system, dir: m.dir, mode: m.mode, verified: hs.ok, problems: hs.problems, modules: nested };
  }) };
}

/** boot(ctx, slug) — start a module in this process, with its own code (its lib/system.js), never the parent's */
function boot(ctx, slug, opts = {}) {
  const m = ctx.index.get('module', slug);
  if (!m) throw Object.assign(new Error(`no module ${slug}`), { status: 404 });
  const dir = path.resolve(ctx.root, m.dir);
  return require(path.join(dir, 'lib', 'system.js')).boot({ root: dir, ...opts });
}

module.exports = { TEMPLATE, slugOf, fill, template, newModule, modules, boot };
