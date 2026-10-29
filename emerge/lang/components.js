'use strict';
// emerge/lang/components.js — components as loom records: identity, hooks, wires, shapes.
// component_id: emerge.lang.components · spec: emerge/lang/emerge-lang.spec (components)
//
// One definition of how a component, its hooks and its wires become records, used by the runtime (components()
// builtin) and by `eg components` (static export). Record shapes follow emerge/schemas/schema.component, schema.hook
// and schema.wire; validateRecords() reads the required fields from those files, so if the schemas move the export
// fails loudly instead of drifting.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const build = require('./build-loader');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/** deterministic: the same namespace/id/version always gives the same uuid */
const componentUuid = (namespace, id, version) => `emerge-component-${sha(`${namespace}/${id}@${version}`).slice(0, 24)}`;
const hookId = (componentId, hook) => `${componentId}.${hook}`;
const endpointId = (ep, idOf) => (ep.signal !== undefined ? `signal:${ep.signal}` : hookId(idOf(ep.comp), ep.hook));

/** shape {fields:[{name,type:{name,nullable}}]} → { field: "num?" } */
const shapeText = (shape) => {
  if (!shape) return null;
  const m = {};
  for (const f of shape.fields) m[f.name] = f.type.name + (f.type.nullable ? '?' : '');
  return m;
};

// a field of type `to` accepts a value declared as `from`
function typeAccepts(to, from) {
  if (!from.nullable || to.nullable || to.name === 'any') { /* nullability ok */ } else return false;
  if (to.name === 'any') return true;
  const num = n => n === 'num' || n === 'float';
  if (num(to.name)) return num(from.name);          // int is its own type: no implicit int → float
  return to.name === from.name;
}

/** compile-time seam check for an out → in wire. Returns a list of mismatch messages (empty: compatible). */
function shapeMismatches(outShape, inShape) {
  if (!outShape || !inShape) return [];
  const msgs = [];
  const outF = new Map(outShape.fields.map(f => [f.name, f.type]));
  const inF = new Map(inShape.fields.map(f => [f.name, f.type]));
  for (const [name, t] of inF) {
    if (!outF.has(name)) { if (!t.nullable && t.name !== 'any') msgs.push(`the in hook needs "${name}", the out hook never sends it`); continue; }
    const o = outF.get(name);
    if (!typeAccepts(t, o)) msgs.push(`"${name}" is ${o.name}${o.nullable ? '?' : ''} on the out side but ${t.name}${t.nullable ? '?' : ''} on the in side`);
  }
  for (const name of outF.keys()) if (!inF.has(name)) msgs.push(`the out hook sends "${name}", which the in hook does not accept`);
  return msgs;
}

/**
 * graphRecords({ components: [{ id, namespace, name, version, uuid?, intent, boundary: [names], ins: [{name, shape}], outs }],
 *                wires: [{ from, to }] })  →  { components, hooks, wires }
 */
function graphRecords(graph) {
  const byName = new Map(graph.components.map(c => [c.name, c]));
  const idOf = (name) => byName.get(name).id;
  const components = graph.components.map(c => ({
    id: c.id, namespace: c.namespace, name: c.name, version: c.version,
    uuid: c.uuid || componentUuid(c.namespace, c.id, c.version),
    uuid_derived: !c.uuid,
    boundary: c.boundary.slice(),
    intent: c.intent || null,
    kinds: (c.kinds || []).slice(),
    template: c.template || null,
  }));
  const hooks = [];
  for (const c of graph.components) {
    for (const [direction, list] of [['in', c.ins], ['out', c.outs]]) {
      for (const h of list) {
        const id = hookId(c.id, h.name);
        hooks.push({ id, component_id: c.id, name: h.name, type: build.primitives().components.hook_type, direction, uuid: `emerge-hook-${sha(id).slice(0, 24)}`, shape: shapeText(h.shape) });
      }
    }
  }
  const wires = graph.wires.map(w => {
    const from = endpointId(w.from, idOf), to = endpointId(w.to, idOf);
    const id = `${from}->${to}`;
    return { id, from_hook_id: from, to_hook_id: to, uuid: `emerge-wire-${sha(id).slice(0, 24)}`,
      ...(w.from.signal !== undefined || w.to.signal !== undefined ? { signal_endpoint: true } : {}) };
  });
  return { components, hooks, wires };
}

/** the static graph of a checked program: what `eg components` exports */
function graphOfProgram(program) {
  const components = program.items.filter(i => i.type === 'Compartment' && i.isComponent && !i.isTemplate).map(c => ({
    id: c.id, namespace: c.namespace, name: c.name, version: c.version, uuid: c.uuid, intent: c.intent, kinds: c.kindsFlat || [],
    boundary: c.constraints.filter(k => k.boundary).map(k => k.name),
    ins: c.ins.map(h => ({ name: h.name, shape: h.shape })),
    outs: c.outs.map(h => ({ name: h.name, shape: h.shape })),
  }));
  // only wires whose ends are both known statically (a top-level wire between declared components or signals)
  const isStatic = e => e.signal !== undefined || components.some(c => c.name === e.comp);
  const wires = program.items.filter(i => i.type === 'Wire' && isStatic(i.from) && isStatic(i.to)).map(w => ({ from: w.from, to: w.to }));
  const g = graphRecords({ components, wires });
  // not loom records: the schemas (kinds) and the factories (templates) that make components at run time
  g.kinds = program.items.filter(i => i.type === 'Kind').map(k => ({
    name: k.name, is: k.parents.map(p => p.name), require: k.requires.slice(),
    in: k.ins.map(h => ({ name: h.name, shape: shapeText(h.shape) })), out: k.outs.map(h => ({ name: h.name, shape: shapeText(h.shape) })),
    state: Object.fromEntries(k.state.map(f => [f.name, f.type.name + (f.type.nullable ? '?' : '')])),
    boundary_count: k.boundaryCount ? [k.boundaryCount.lo, k.boundaryCount.hi] : null,
    fns: k.fns.map(f => ({ name: f.name, arity: f.arity })),
  }));
  g.templates = program.items.filter(i => i.type === 'Compartment' && i.isTemplate).map(t => ({
    name: t.name, namespace: t.namespace, version: t.version, params: t.params.map(p => p.name), kinds: t.kindsFlat || [],
    boundary: t.constraints.filter(k => k.boundary).map(k => k.name),
    in: t.ins.map(h => ({ name: h.name, shape: shapeText(h.shape) })), out: t.outs.map(h => ({ name: h.name, shape: shapeText(h.shape) })),
  }));
  return g;
}

/** required fields of emerge/schemas/schema.<type>, read from the schema file itself */
function requiredFields(type, schemasDir = path.join(__dirname, '..', 'schemas')) {
  const file = path.join(schemasDir, `schema.${type}`);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex(l => /^\s{2}fields:\s*$/.test(l));
  if (start === -1) throw new Error(`${file}: no fields: block`);
  const req = [];
  let current = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && !/^\s{4}/.test(l)) break;
    const f = /^\s{4}([A-Za-z_][A-Za-z0-9_]*):\s*$/.exec(l);
    if (f) { current = f[1]; continue; }
    if (current && /^\s{6}required:\s*true\s*$/.test(l)) req.push(current);
  }
  if (!req.length) throw new Error(`${file}: found no required fields — the schema format changed; update requiredFields()`);
  return req;
}

/** every record carries every required field as a non-empty string → [] ; otherwise a list of problems */
function validateRecords(records, schemasDir) {
  const problems = [];
  for (const [type, list] of [['component', records.components], ['hook', records.hooks], ['wire', records.wires]]) {
    const req = requiredFields(type, schemasDir);
    for (const r of list) {
      for (const k of req) if (typeof r[k] !== 'string' || !r[k]) problems.push(`${type} ${r.id || '?'}: required field "${k}" is missing`);
    }
    if (type === 'hook') for (const r of list) if (!['in', 'out', 'bidirectional'].includes(r.direction)) problems.push(`hook ${r.id}: direction "${r.direction}"`);
  }
  const hookIds = new Set(records.hooks.map(h => h.id));
  for (const w of records.wires) {
    for (const end of [w.from_hook_id, w.to_hook_id]) if (!end.startsWith('signal:') && !hookIds.has(end)) problems.push(`wire ${w.id}: ${end} is not a hook`);
  }
  return problems;
}

module.exports = { SEMVER, componentUuid, hookId, graphRecords, graphOfProgram, shapeMismatches, shapeText, typeAccepts, requiredFields, validateRecords };
