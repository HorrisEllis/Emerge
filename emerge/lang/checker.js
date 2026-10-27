'use strict';
// emerge/lang/checker.js — the static half of the language: every name resolved, every compile-time axiom enforced.
// component_id: emerge.lang.checker · spec: emerge/lang/emerge-lang.spec (axioms, compartments, whatif, testing)
//
// check(program) → { ok, errors: [{message, line, col}], warnings: [...] }
// It annotates the tree for the backends: Ident.res ∈ local | builtin | comp | module | compfn (with .comp),
// constraint.needs (the state.X names it reads), program.exports.

const { builtinArity, runtimeSignals } = require('./runtime');
const build = require('./build-loader');
const { SEMVER, shapeMismatches } = require('./components');

class Scope {
  constructor(parent, boundary = false) { this.parent = parent; this.vars = new Map(); this.boundary = boundary; }
}

const KIND_WORD = { let: 'a let', param: 'a parameter', loop: 'a loop variable', fn: 'a fn', comp: 'a compartment', module: 'a module', compfn: 'a compartment fn', err: 'an error binding' };

function arityText(a) {
  if (Array.isArray(a)) return a[1] === -1 ? `at least ${a[0]}` : a[0] === a[1] ? `${a[0]}` : `${a[0]} to ${a[1]}`;
  return String(a);
}
function arityOk(a, n) { return Array.isArray(a) ? n >= a[0] && (a[1] === -1 || n <= a[1]) : n === a; }

function check(program) {
  const errors = [], warnings = [];
  const E = (node, message) => errors.push({ message, line: node.line, col: node.col });
  const Wn = (node, message) => warnings.push({ message, line: node.line, col: node.col });
  const P = build.primitives();
  const BUILTIN_ARITY = { has: n => builtinArity().has(n), get: n => builtinArity().get(n) };
  /** a rule whose severity lives in primitives.eg (diagnostics) */
  const D = (rule, node, message) => {
    const sev = P.diagnostics[rule];
    if (sev === 'error') E(node, message);
    else if (sev === 'warning') Wn(node, message);
    else if (sev !== 'off') E(node, `primitives.diagnostics.${rule} is ${JSON.stringify(sev)} — it must be "error", "warning" or "off"`);
  };

  const emits = [];      // literal signal names emitted
  const componentsByName = new Map(program.items.filter(i => i.type === 'Compartment' && i.isComponent && !i.isTemplate).map(c => [c.name, c]));
  const templatesByName = new Map(program.items.filter(i => i.type === 'Compartment' && i.isTemplate).map(c => [c.name, c]));
  const kindsByName = new Map();
  const fed = new Set();     // "Comp.hook" in hooks that something sends or wires into
  const wiredOut = new Set(); // "Comp.hook" out hooks with a wire
  const wireKeys = new Set();
  const flatCache = new Map();
  const patterns = [];   // handler patterns
  const compIds = new Map();

  function declare(scope, name, binding, node) {
    if (scope.vars.has(name)) { E(node, `"${name}" is already declared in this scope (line ${scope.vars.get(name).line})`); return; }
    scope.vars.set(name, Object.assign({ name, line: node.line }, binding));
  }
  function resolve(scope, name) {
    for (let s = scope; s; s = s.parent) if (s.vars.has(name)) return { b: s.vars.get(name), scope: s };
    return null;
  }
  function crossesBoundary(from, to) {
    for (let s = from; s && s !== to; s = s.parent) if (s.boundary) return true;
    return false;
  }

  // ── expressions ────────────────────────────────────────────────────────────
  function expr(e, scope, ctx) {
    switch (e.type) {
      case 'Num': case 'Bool': case 'Null': return;
      case 'Str': for (const p of e.parts) if (typeof p !== 'string') expr(p, scope, ctx); return;
      case 'List': for (const x of e.items) expr(x, scope, ctx); return;
      case 'Map': for (const x of e.entries) expr(x.value, scope, ctx); return;
      case 'Ident': {
        const r = resolve(scope, e.name);
        if (r) {
          const k = r.b.kind;
          if (k === 'template') { E(e, `${e.name} is a template — make an instance with spawn ${e.name}("an.id", …)`); return; }
          if (k === 'kind') { E(e, `${e.name} is a kind, not a value — test it with is_kind(x, "${e.name}")`); return; }
          e.res = k === 'comp' ? 'comp' : k === 'module' ? 'module' : k === 'compfn' ? 'compfn' : 'local';
          if (k === 'compfn') e.comp = r.b.comp;
          e.binding = r.b;
          return;
        }
        if (BUILTIN_ARITY.has(e.name)) { e.res = 'builtin'; return; }
        E(e, `"${e.name}" is not defined`);
        return;
      }
      case 'State':
        if (!ctx.stateMode) E(e, 'state is only available inside a compartment\'s handlers, fns and constraints');
        return;
      case 'Member':
        if (e.obj.type === 'State') {
          expr(e.obj, scope, ctx);
          if (ctx.comp && !ctx.comp.state.some(f => f.name === e.name)) E(e, `compartment ${ctx.comp.name} has no state field "${e.name}"`);
          return;
        }
        expr(e.obj, scope, ctx);
        return;
      case 'Index':
        if (e.obj.type === 'State') E(e, 'state fields are named — write state.field, not state[...]');
        expr(e.obj, scope, ctx); expr(e.index, scope, ctx);
        return;
      case 'Unary': expr(e.expr, scope, ctx); return;
      case 'Binary': case 'Logical': case 'Coalesce': expr(e.l, scope, ctx); expr(e.r, scope, ctx); return;
      case 'Call': {
        expr(e.callee, scope, ctx);
        for (const a of e.args) expr(a, scope, ctx);
        const c = e.callee;
        if (c.type === 'Ident') {
          let arity = null, label = c.name;
          if (c.res === 'builtin') arity = BUILTIN_ARITY.get(c.name);
          else if (c.binding && (c.binding.kind === 'fn' || c.binding.kind === 'compfn')) arity = c.binding.arity;
          if (arity !== null && arity !== undefined && !arityOk(arity, e.args.length)) {
            E(e, `${label} takes ${arityText(arity)} argument(s), got ${e.args.length}`);
          }
        }
        return;
      }
      case 'Lambda': fnBody(e, scope, ctx, 'lambda'); return;
      case 'Spawn': {
        if (ctx.lens || ctx.inHandler) E(e, 'spawn changes the world, not a transition — it is not allowed in handlers, in hooks or lenses');
        const r = resolve(scope, e.template);
        const t = templatesByName.get(e.template);
        if (!t || !r || r.b.kind !== 'template') E(e, r ? `${e.template} is not a template` : `"${e.template}" is not defined`);
        else if (e.args.length !== t.params.length + 1) E(e, `spawn ${e.template} takes an id and ${t.params.length} argument(s) — got ${e.args.length} in all`);
        for (const a of e.args) expr(a, scope, ctx);
        return;
      }
      case 'Whatif': {
        const s = new Scope(scope, true);
        stmts(e.body.body, s, { ...ctx, whatifDirect: true, loop: false });
        return;
      }
    }
    E(e, `internal: unknown expression ${e.type}`);
  }

  function fnBody(f, scope, ctx, kind) {
    const s = new Scope(scope);
    for (const p of f.params) declare(s, p.name, { kind: 'param' }, p);
    stmts(f.body.body, s, { ...ctx, fn: kind, loop: false, whatifDirect: false });
  }

  // ── assignment targets ─────────────────────────────────────────────────────
  function target(t, scope, ctx) {
    if (t.type === 'Ident') {
      expr(t, scope, ctx);
      const r = resolve(scope, t.name);
      if (!r) return;
      if (r.b.kind !== 'var') { E(t, `"${t.name}" is ${KIND_WORD[r.b.kind] || r.b.kind} — only a var can be assigned`); return; }
      if (crossesBoundary(scope, r.scope)) E(t, `"${t.name}" is declared outside this whatif/test — a branch cannot write outside itself`);
      return;
    }
    // Member / Index: find the root
    let root = t;
    while (root.type === 'Member' || root.type === 'Index') {
      if (root.type === 'Index') expr(root.index, scope, ctx);
      root = root.obj;
    }
    if (root.type === 'State') {
      if (ctx.stateMode !== 'rw' || ctx.lens) { E(t, ctx.stateMode ? 'state is read-only here — only on handlers change state' : 'state is only available inside a compartment'); return; }
      if (ctx.inWhatifTree) { E(t, 'a whatif branch cannot write state outside itself'); return; }
      const first = (() => { let n = t; while (n.obj.type !== 'State') n = n.obj; return n; })();
      if (first.type === 'Index') { E(first, 'state fields are named — write state.field, not state[...]'); return; }
      if (!ctx.comp.state.some(f => f.name === first.name)) E(first, `compartment ${ctx.comp.name} has no state field "${first.name}"`);
      return;
    }
    if (root.type === 'Ident') {
      expr(root, scope, ctx);
      const r = resolve(scope, root.name);
      if (!r) return;
      if (r.b.kind !== 'var') { E(root, `"${root.name}" is ${KIND_WORD[r.b.kind] || r.b.kind} — change contents through a var`); return; }
      if (crossesBoundary(scope, r.scope)) E(root, `"${root.name}" is declared outside this whatif/test — a branch cannot write outside itself`);
      return;
    }
    E(t, 'assignment needs a variable, a field of a var, or state.field');
  }

  // ── statements ─────────────────────────────────────────────────────────────
  function hoist(list, scope) {
    for (const s of list) if (s.type === 'FnDecl') declare(scope, s.name, { kind: 'fn', arity: s.params.length }, s);
  }

  function stmts(list, scope, ctx) {
    hoist(list, scope);
    const deferred = [];
    for (const s of list) stmt(s, scope, ctx, deferred);
    for (const d of deferred) d();
  }

  function stmt(s, scope, ctx, deferred) {
    switch (s.type) {
      case 'Let':
        expr(s.expr, scope, ctx);
        declare(scope, s.name, { kind: s.kind, vtype: s.vtype, template: s.kind === 'let' && s.expr.type === 'Spawn' ? templatesByName.get(s.expr.template) || null : null }, s);
        return;
      case 'FnDecl': {
        const c = { ...ctx };
        deferred.push(() => fnBody(s, scope, c, 'fn'));
        return;
      }
      case 'Assign':
        expr(s.expr, scope, ctx);
        target(s.target, scope, { ...ctx, inWhatifTree: ctx.inWhatifTree || ctx.whatifDirect });
        return;
      case 'If':
        expr(s.cond, scope, ctx);
        stmts(s.then.body, new Scope(scope), ctx);
        if (s.otherwise) {
          if (s.otherwise.type === 'If') stmt(s.otherwise, scope, ctx, deferred);
          else stmts(s.otherwise.body, new Scope(scope), ctx);
        }
        return;
      case 'While':
        expr(s.cond, scope, ctx);
        stmts(s.body.body, new Scope(scope), { ...ctx, loop: true });
        return;
      case 'For': {
        expr(s.iter, scope, ctx);
        const fs = new Scope(scope);
        declare(fs, s.a, { kind: 'loop' }, s);
        if (s.b) declare(fs, s.b, { kind: 'loop' }, s);
        stmts(s.body.body, fs, { ...ctx, loop: true });
        return;
      }
      case 'Break': case 'Skip':
        if (!ctx.loop) E(s, `${s.type === 'Break' ? 'break' : 'skip'} outside a loop`);
        return;
      case 'Return':
        if (ctx.whatifDirect) { E(s, 'return cannot leave a whatif branch — its value is its last expression'); return; }
        if (ctx.fn === 'fn' || ctx.fn === 'lambda' || ctx.fn === 'lens') { if (s.expr) expr(s.expr, scope, ctx); return; }
        if (ctx.fn === 'handler' || ctx.fn === 'test') { if (s.expr) E(s, `a ${ctx.fn} returns nothing — use a bare return`); return; }
        E(s, 'return outside a function');
        return;
      case 'EmitOut': {
        if (ctx.lens) E(s, 'emit out is not allowed in a lens');
        else if (!(ctx.comp && ctx.comp.isComponent && ctx.stateMode === 'rw')) E(s, 'emit out is only possible inside a component\'s in hook');
        else if (!ctx.comp.outs.some(h => h.name === s.hook)) E(s, `component ${ctx.comp.name} has no out hook "${s.hook}" — declare out ${s.hook}`);
        if (s.payload) expr(s.payload, scope, ctx);
        return;
      }
      case 'Send': {
        if (ctx.lens) E(s, 'send is not allowed in a lens');
        const ep = { comp: s.comp, expr: s.expr, hook: s.hook, line: s.line, col: s.col };
        const h = endpoint(ep, 'in', scope, 'send', ctx);
        s.dyn = !!ep.dyn;
        if (h !== undefined && !ep.dyn) fed.add(`${s.comp}.${s.hook}`);
        if (s.payload) expr(s.payload, scope, ctx);
        return;
      }
      case 'Wire':
        if (ctx.lens || ctx.inHandler) E(s, 'wire changes the world, not a transition — it is not allowed in handlers, in hooks or lenses');
        wire(s, scope, ctx);
        return;
      case 'Despawn':
        if (ctx.lens || ctx.inHandler) E(s, 'despawn changes the world, not a transition — it is not allowed in handlers, in hooks or lenses');
        expr(s.expr, scope, ctx);
        return;
      case 'Emit': case 'Record':
        if (ctx.lens) E(s, `${s.type.toLowerCase()} is not allowed in a lens — compartment fns and constraints only read`);
        if (s.type === 'Emit' && ctx.comp && ctx.comp.isComponent) E(s, `a component speaks through its out hooks — write emit out <hook> { … } and wire it`);
        expr(s.name, scope, ctx);
        if (s.payload) expr(s.payload, scope, ctx);
        if (s.type === 'Emit' && s.name.type === 'Str' && s.name.parts.length === 1 && typeof s.name.parts[0] === 'string') {
          emits.push({ name: s.name.parts[0], node: s });
        }
        return;
      case 'Gap':
        if (ctx.lens) E(s, 'gap is not allowed in a lens — compartment fns and constraints only read');
        expr(s.msg, scope, ctx);
        expr(s.pressure, scope, ctx);
        if (s.pressure.type === 'Num' && (s.pressure.value < P.gaps.pressure_min || s.pressure.value > P.gaps.pressure_max)) D('GAP_IS_FIRST_CLASS', s.pressure, `GAP_IS_FIRST_CLASS: pressure is in [${P.gaps.pressure_min}, ${P.gaps.pressure_max}]`);
        if (s.gtype && !P.gaps.types.includes(s.gtype)) D('GAP_IS_FIRST_CLASS', s.gtypeTok, `gap type "${s.gtype}" is not one of ${P.gaps.types.join(', ')}`);
        return;
      case 'Promote':
        if (ctx.lens) E(s, 'promote is not allowed in a lens');
        expr(s.value, scope, ctx); expr(s.proof, scope, ctx);
        return;
      case 'Try': {
        stmts(s.body.body, new Scope(scope), ctx);
        if (!s.handler.body.length) D('NO_SILENT_DROP', s, 'NO_SILENT_DROP: try\'s else block is empty — handle the failure, log it, or let it propagate');
        const hs = new Scope(scope);
        if (s.errName) declare(hs, s.errName, { kind: 'err' }, s);
        stmts(s.handler.body, hs, ctx);
        return;
      }
      case 'Expect':
        expr(s.cond, scope, ctx);
        if (s.msg) expr(s.msg, scope, ctx);
        return;
      case 'ExprStmt': expr(s.expr, scope, ctx); return;
    }
    E(s, `internal: unknown statement ${s.type}`);
  }

  // ── program ────────────────────────────────────────────────────────────────
  const top = new Scope(null);
  const topCtx = { fn: null, comp: null, stateMode: null, lens: false, loop: false, whatifDirect: false };
  program.hasUse = program.items.some(i => i.type === 'Use');
  program.exports = [];

  // hoist: fns, compartments, modules
  for (const it of program.items) {
    if (it.type === 'FnDecl') declare(top, it.name, { kind: 'fn', arity: it.params.length }, it);
    else if (it.type === 'Compartment') declare(top, it.name, { kind: it.isTemplate ? 'template' : 'comp' }, it);
    else if (it.type === 'Kind') { declare(top, it.name, { kind: 'kind' }, it); kindsByName.set(it.name, it); }
    else if (it.type === 'Use') declare(top, it.alias, { kind: 'module' }, it);
  }

  const deferred = [];
  const tests = [];
  for (const it of program.items) {
    switch (it.type) {
      case 'Use': break;
      case 'FnDecl':
        program.exports.push(it.name);
        deferred.push(() => fnBody(it, top, topCtx, 'fn'));
        break;
      case 'Compartment': {
        if (!it.isTemplate) program.exports.push(it.name);
        compartment(it, deferred);
        break;
      }
      case 'Kind': flatKind(it.name, []); break;
      case 'On':
        patterns.push(it.signal);
        deferred.push(() => {
          const s = new Scope(top);
          if (it.param) declare(s, it.param, { kind: 'param' }, it);
          stmts(it.body.body, s, { ...topCtx, fn: 'handler', inHandler: true });
        });
        break;
      case 'Axiom':
        expr(it.expr, top, { ...topCtx, fn: 'axiom', lens: true });
        break;
      case 'Test':
        tests.push(it);
        break;
      default:
        stmt(it, top, topCtx, deferred);
        if (it.type === 'Let') program.exports.push(it.name);
    }
  }
  for (const d of deferred) d();
  for (const t of tests) stmts(t.body.body, new Scope(top, true), { ...topCtx, fn: 'test' });

  /** a wire or send end → the hook (static), null (a signal, or an instance only known at run time), undefined (error) */
  function endpoint(ep, want, scope, verb = 'wire', ctx = topCtx) {
    if (ep.signal !== undefined) return null;
    if (ep.expr) { expr(ep.expr, scope, ctx); ep.dyn = true; return null; }  // known at run time
    const r = resolve(scope, ep.comp);
    if (!r) { E(ep, `"${ep.comp}" is not defined`); return undefined; }
    let c;
    if (r.b.kind === 'comp') {
      c = componentsByName.get(ep.comp);
      if (!c) { E(ep, `${ep.comp} is not a component — only components have hooks`); return undefined; }
    } else if (r.b.kind === 'template' || r.b.kind === 'kind' || r.b.kind === 'fn' || r.b.kind === 'module') {
      E(ep, r.b.kind === 'template' ? `${ep.comp} is a template — wire an instance: let x = spawn ${ep.comp}(…)` : `${ep.comp} is not a component — only components have hooks`);
      return undefined;
    } else {
      ep.dyn = true;              // a variable: the instance is known at run time
      ep.binding = r.b;
      if (!r.b.template) return null;
      c = r.b.template;            // bound directly by spawn: check against its template
    }
    const list = want === 'out' ? c.outs : c.ins;
    const h = list.find(x => x.name === ep.hook);
    if (!h) {
      const other = (want === 'out' ? c.ins : c.outs).some(x => x.name === ep.hook);
      E(ep, other ? `${ep.comp}.${ep.hook} is an ${want === 'out' ? 'in' : 'out'} hook — ${verb === 'send' ? 'send feeds in hooks' : 'a wire runs out → in'}` : `${c.isTemplate ? 'template' : 'component'} ${c.name} has no ${want} hook "${ep.hook}"`);
      return undefined;
    }
    return h;
  }
  function wire(w, scope, ctx) {
    if (w.from.signal !== undefined && w.to.signal !== undefined) { E(w, 'a wire joins at least one hook — signal to signal is an on handler'); return; }
    const from = endpoint(w.from, 'out', scope, 'wire', ctx);
    const to = endpoint(w.to, 'in', scope, 'wire', ctx);
    if (from === undefined || to === undefined) return;
    const key = `${w.from.signal !== undefined ? '"' + w.from.signal + '"' : w.from.comp + '.' + w.from.hook}->${w.to.signal !== undefined ? '"' + w.to.signal + '"' : w.to.comp + '.' + w.to.hook}`;
    if (!w.from.dyn && !w.to.dyn) {
      if (wireKeys.has(key)) { E(w, `wire ${key} is declared twice`); return; }
      wireKeys.add(key);
    }
    if (from && to) {
      const bad = shapeMismatches(from.shape, to.shape);
      if (bad.length) E(w, `seam mismatch on ${key}: ${bad.join('; ')}`);
    }
    if (w.from.signal === undefined) { if (!w.from.dyn) wiredOut.add(`${w.from.comp}.${w.from.hook}`); }
    else patterns.push(w.from.signal);
    if (w.to.signal === undefined && !w.to.dyn) fed.add(`${w.to.comp}.${w.to.hook}`);
  }

  // ── kinds: flatten inheritance, then check conformance ──
  function flatKind(name, stack) {
    if (flatCache.has(name)) return flatCache.get(name);
    const k = kindsByName.get(name);
    if (!k) return null;
    if (stack.includes(name)) { E(k, `kind ${name} inherits from itself: ${[...stack, name].join(' → ')}`); return null; }
    const flat = { names: [name], requires: new Set(), ins: new Map(), outs: new Map(), state: new Map(), boundaryCount: null, fns: new Map() };
    for (const p of k.parents) {
      if (!kindsByName.has(p.name)) { E(p, `kind ${name} is ${p.name}, which is not a kind`); continue; }
      const pf = flatKind(p.name, [...stack, name]);
      if (!pf) continue;
      for (const n of pf.names) if (!flat.names.includes(n)) flat.names.push(n);
      pf.requires.forEach(x => flat.requires.add(x));
      for (const [key, v] of pf.ins) flat.ins.set(key, v);
      for (const [key, v] of pf.outs) flat.outs.set(key, v);
      for (const [key, v] of pf.state) flat.state.set(key, v);
      for (const [key, v] of pf.fns) flat.fns.set(key, v);
      if (pf.boundaryCount) flat.boundaryCount = pf.boundaryCount;
    }
    const seen = new Set();
    const dup = (n, node) => { if (seen.has(n)) E(node, `kind ${name} declares "${n}" twice`); seen.add(n); };
    k.requires.forEach(x => flat.requires.add(x));
    for (const h of k.ins) { dup(h.name, h); flat.ins.set(h.name, { ...h, kind: name }); }
    for (const h of k.outs) { dup(h.name, h); flat.outs.set(h.name, { ...h, kind: name }); }
    for (const f of k.state) flat.state.set(f.name, { type: f.type, kind: name });
    for (const f of k.fns) flat.fns.set(f.name, { arity: f.arity, kind: name });
    if (k.boundaryCount) flat.boundaryCount = { ...k.boundaryCount, kind: name };
    for (const n of flat.ins.keys()) if (flat.outs.has(n)) E(k, `kind ${name} requires "${n}" as both an in and an out hook`);
    flatCache.set(name, flat);
    return flat;
  }

  function conform(c) {
    c.kindsFlat = [];
    c.typedState = [];
    const what = c.isTemplate ? 'template' : 'component';
    for (const ref of c.kinds) {
      if (!kindsByName.has(ref.name)) { E(ref, `${ref.name} is not a kind`); continue; }
      const flat = flatKind(ref.name, []);
      if (!flat) continue;
      const bad = (msg) => E(ref, `${what} ${c.name} does not conform to kind ${ref.name}: ${msg}`);
      for (const f of flat.requires) {
        if (c.isTemplate && f === 'id') continue;
        if (c.isTemplate && f === 'uuid') { bad('it requires uuid, and a template cannot declare one (each instance derives its own)'); continue; }
        if (!c[f]) bad(`it requires ${f}`);
      }
      for (const [n, req] of flat.ins) {
        const h = c.ins.find(x => x.name === n);
        if (!h) { bad(c.outs.some(x => x.name === n) ? `"${n}" must be an in hook, not out` : `missing in hook "${n}"`); continue; }
        if (req.shape && h.shape) { const m = shapeMismatches(req.shape, h.shape); if (m.length) bad(`in hook "${n}" does not accept the kind's shape: ${m.join('; ')}`); }
      }
      for (const [n, req] of flat.outs) {
        const h = c.outs.find(x => x.name === n);
        if (!h) { bad(c.ins.some(x => x.name === n) ? `"${n}" must be an out hook, not in` : `missing out hook "${n}"`); continue; }
        if (req.shape) {
          if (!h.shape) { bad(`out hook "${n}" must declare a shape the kind can check`); continue; }
          const m = shapeMismatches(h.shape, req.shape);
          if (m.length) bad(`out hook "${n}" does not fit the kind's shape: ${m.join('; ')}`);
        }
      }
      for (const [n, req] of flat.state) {
        if (!c.state.some(f => f.name === n)) bad(`missing state field "${n}" (${req.type.name}${req.type.nullable ? '?' : ''})`);
        else if (!c.typedState.some(x => x.name === n)) c.typedState.push({ name: n, type: { name: req.type.name, nullable: req.type.nullable }, kind: req.kind });
      }
      if (flat.boundaryCount) {
        const nb = c.constraints.filter(k => k.boundary).length;
        if (nb < flat.boundaryCount.lo || nb > flat.boundaryCount.hi) bad(`it needs ${flat.boundaryCount.lo === flat.boundaryCount.hi ? flat.boundaryCount.lo : `${flat.boundaryCount.lo} to ${flat.boundaryCount.hi}`} boundary invariant(s), has ${nb}`);
      }
      for (const [n, req] of flat.fns) {
        const f = c.fns.find(x => x.name === n);
        if (!f) bad(`missing fn ${n}`);
        else if (f.params.length !== req.arity) bad(`fn ${n} takes ${f.params.length} argument(s), the kind says ${req.arity}`);
      }
      for (const n of flat.names) if (!c.kindsFlat.includes(n)) c.kindsFlat.push(n);
    }
  }

  function compartment(c, deferredList) {
    const kind = c.isTemplate ? 'template' : c.isComponent ? 'component' : 'compartment';
    if (!c.isTemplate) {
      if (!c.id) D('EXECUTION_IS_TRACEABLE', c, `EXECUTION_IS_TRACEABLE: ${kind} ${c.name} declares no id — add id = "..."`);
      else if (compIds.has(c.id)) E(c.idTok, `${kind} id "${c.id}" is already used by ${compIds.get(c.id)}`);
      else compIds.set(c.id, c.name);
    }
    if (c.isComponent) {
      if (!c.namespace) D('EXECUTION_IS_TRACEABLE', c, `EXECUTION_IS_TRACEABLE: ${kind} ${c.name} declares no namespace — add namespace = "..."`);
      if (!c.version) D('EXECUTION_IS_TRACEABLE', c, `EXECUTION_IS_TRACEABLE: ${kind} ${c.name} declares no version — add version = "1.0.0"`);
      else if (!SEMVER.test(c.version)) E(c, `${kind} ${c.name}: version "${c.version}" is not semver (major.minor.patch)`);
      conform(c);
      const nb = c.constraints.filter(k => k.boundary).length;
      if (nb > P.components.boundary_max) E(c, `component ${c.name} declares ${nb} boundary invariants — a boundary is 1 to ${P.components.boundary_max} identity-defining invariants`);
      const hooks = new Set();
      for (const h of [...c.ins.map(x => ({ ...x, line: x.line })), ...c.outs]) {
        if (hooks.has(h.name)) E(h, `hook "${h.name}" is declared twice in ${c.name}`);
        hooks.add(h.name);
      }
    }

    // a template's parameters are visible everywhere inside it
    const tscope = new Scope(top);
    for (const p of c.params) declare(tscope, p.name, { kind: 'param' }, p);
    const seen = new Set();
    for (const f of c.state) {
      if (seen.has(f.name)) E(f, `state field "${f.name}" is declared twice`);
      seen.add(f.name);
      expr(f.expr, tscope, topCtx);
    }
    const cscope = new Scope(tscope);
    for (const f of c.fns) declare(cscope, f.name, { kind: 'compfn', comp: c.name, arity: f.params.length }, f);

    const cnames = new Set();
    for (const k of c.constraints) {
      if (cnames.has(k.name)) E(k, `constraint "${k.name}" is declared twice in ${c.name}`);
      cnames.add(k.name);
      expr(k.expr, cscope, { ...topCtx, fn: 'constraint', comp: c, stateMode: 'r', lens: true });
      const needs = new Set();
      (function walk(n) {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (n.type === 'Member' && n.obj && n.obj.type === 'State') needs.add(n.name);
        for (const key of Object.keys(n)) if (key !== 'binding') walk(n[key]);
      })(k.expr);
      k.needs = [...needs];
      const readsParam = c.params.length && (function walk(n) {
        if (!n || typeof n !== 'object') return false;
        if (Array.isArray(n)) return n.some(walk);
        if (n.type === 'Ident' && c.params.some(p => p.name === n.name)) return true;
        return Object.keys(n).some(key => key !== 'binding' && walk(n[key]));
      })(k.expr);
      if (!k.needs.length && !readsParam) D('unused_constraint', k, `constraint ${k.name} reads no state field — it constrains nothing`);
    }

    const sigs = new Set();
    for (const h of c.handlers) {
      if (sigs.has(h.signal)) E(h, `${c.name} already handles "${h.signal}"`);
      sigs.add(h.signal);
      patterns.push(h.signal);
      deferredList.push(() => {
        const s = new Scope(cscope);
        if (h.param) declare(s, h.param, { kind: 'param' }, h);
        stmts(h.body.body, s, { ...topCtx, fn: 'handler', comp: c, stateMode: 'rw', inHandler: true });
      });
    }
    for (const f of c.fns) {
      deferredList.push(() => fnBody(f, cscope, { ...topCtx, comp: c, stateMode: 'r', lens: true }, 'lens'));
    }
    for (const h of c.ins) {
      deferredList.push(() => {
        const s = new Scope(cscope);
        if (h.param) declare(s, h.param, { kind: 'param' }, h);
        stmts(h.body.body, s, { ...topCtx, fn: 'handler', comp: c, stateMode: 'rw', inHandler: true });
      });
    }
  }

  // SIGNAL_MUST_ROUTE_OR_LOG — only provable when the whole program is in this file
  if (!program.hasUse) {
    for (const c of componentsByName.values()) {
      for (const h of c.outs) if (!wiredOut.has(`${c.name}.${h.name}`)) D('SIGNAL_MUST_ROUTE_OR_LOG', h, `SIGNAL_MUST_ROUTE_OR_LOG: out hook ${c.name}.${h.name} has no wire — what it sends will be logged as unrouted`);
      for (const h of c.ins) if (!fed.has(`${c.name}.${h.name}`)) D('SIGNAL_MUST_ROUTE_OR_LOG', { line: h.nameLine, col: h.nameCol }, `in hook ${c.name}.${h.name} is never fed — no wire or send reaches it`);
    }
    const matchesAny = n => runtimeSignals().includes(n) || patterns.some(p => p.endsWith('*') ? n.startsWith(p.slice(0, -1)) : p === n);
    for (const em of emits) {
      if (!matchesAny(em.name)) D('SIGNAL_MUST_ROUTE_OR_LOG', em.node, `SIGNAL_MUST_ROUTE_OR_LOG: no handler matches "${em.name}" — it will be logged as unrouted`);
    }
  }

  errors.sort((a, b) => a.line - b.line || a.col - b.col);
  warnings.sort((a, b) => a.line - b.line || a.col - b.col);
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { check };
