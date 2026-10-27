'use strict';
// emerge/lang/interpreter.js — walks a checked AST against the runtime.
// component_id: emerge.lang.interpreter · spec: emerge/lang/emerge-lang.spec (modules.interpreter)
// Every operator, builtin and world operation is the runtime's — this file only decides evaluation order, which
// matches the order the emitter's JavaScript evaluates in (left to right, operands before operators).

const STATE = '%state';

class Ctrl {}
class ReturnSig extends Ctrl { constructor(v) { super(); this.value = v; } }
const BREAK = new (class Break extends Ctrl {})();
const SKIP = new (class Skip extends Ctrl {})();

const UNINIT = Symbol('uninitialized');

class Env {
  constructor(parent) { this.parent = parent; this.vars = new Map(); }
  define(name, value) { this.vars.set(name, { value }); }
  reserve(name) { if (!this.vars.has(name)) this.vars.set(name, { value: UNINIT }); }
  find(name) { for (let e = this; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name); return null; }
}

const COMPOUND = { '+=': 'add', '-=': 'sub', '*=': 'mul', '/=': 'div' };

function createInterpreter(rt, file) {
  const $ = rt;
  const at = (line) => $.at(line, file);

  function lookup(env, name) {
    const slot = env.find(name);
    if (!slot) $.error(`"${name}" is not defined`);
    if (slot.value === UNINIT) $.error(`"${name}" is used before its declaration ran`);
    return slot.value;
  }
  function assignVar(env, name, value) {
    const slot = env.find(name);
    if (!slot) $.error(`"${name}" is not defined`);
    if (slot.value === UNINIT) $.error(`"${name}" is used before its declaration ran`);
    slot.value = value;
  }

  // ── expressions ────────────────────────────────────────────────────────────
  function ev(e, env) {
    switch (e.type) {
      case 'Num': return e.value;
      case 'Bool': return e.value;
      case 'Null': return null;
      case 'Str': return $.str(e.parts.map(p => (typeof p === 'string' ? p : ev(p, env))));
      case 'List': return $.list(e.items.map(x => ev(x, env)));
      case 'Map': {
        const pairs = [];
        for (const x of e.entries) { pairs.push(x.key); pairs.push(ev(x.value, env)); }
        return $.map(pairs);
      }
      case 'Ident':
        switch (e.res) {
          case 'builtin': return $.b[e.name];
          case 'comp': return $.comp(e.name);
          case 'compfn': return $.lensFn(e.comp, e.name, lookup(env, STATE));
          default: return lookup(env, e.name);
        }
      case 'State': return lookup(env, STATE);
      case 'Member': return $.get(ev(e.obj, env), e.name);
      case 'Index': { const o = ev(e.obj, env); return $.index(o, ev(e.index, env)); }
      case 'Unary': {
        const v = ev(e.expr, env);
        return e.op === 'not' ? $.not(v) : e.op === '~' ? $.bnot(v) : $.neg(v);
      }
      case 'Logical': {
        const l = ev(e.l, env);
        return e.op === 'and' ? $.and(l, () => ev(e.r, env)) : $.or(l, () => ev(e.r, env));
      }
      case 'Coalesce': return $.coalesce(ev(e.l, env), () => ev(e.r, env));
      case 'Binary': {
        const l = ev(e.l, env);
        const r = ev(e.r, env);
        return binop(e.op, l, r);
      }
      case 'Call': {
        const f = ev(e.callee, env);
        const args = e.args.map(a => ev(a, env));
        return $.call(f, args);
      }
      case 'Lambda': return makeFn(e, env, null);
      case 'Spawn': return $.spawn(e.template, e.args.map(a => ev(a, env)));
      case 'Whatif': return $.whatif(() => block(e.body.body, new Env(env), true));
    }
    $.error(`internal: unknown expression ${e.type}`);
  }

  function binop(op, l, r) {
    switch (op) {
      case '+': return $.add(l, r);
      case '-': return $.sub(l, r);
      case '*': return $.mul(l, r);
      case '/': return $.div(l, r);
      case '%': return $.mod(l, r);
      case '**': return $.pow(l, r);
      case '==': return $.eq(l, r);
      case '!=': return $.neq(l, r);
      case '<': case '<=': case '>': case '>=': return $.cmp(op, l, r);
      case '..': return $.range(l, r);
      case '&': return $.band(l, r);
      case '|': return $.bor(l, r);
      case '^': return $.bxor(l, r);
      case '<<': return $.shl(l, r);
      case '>>': return $.shr(l, r);
      case 'contains': return $.contains(l, r);
      case 'in': return $.isIn(l, r);
      case 'starts_with': return $.startsWith(l, r);
      case 'ends_with': return $.endsWith(l, r);
      case 'matches': return $.matches(l, r);
    }
    $.error(`internal: unknown operator ${op}`);
  }

  // ── functions ──────────────────────────────────────────────────────────────
  /** makeFn(node, closure, withState) — withState: null for plain fns; for lens fns the impl takes the view first */
  function makeFn(f, closure, lensOf) {
    const name = f.name || 'anonymous';
    const impl = (stateView, args) => {
      const env = new Env(closure);
      if (lensOf) env.define(STATE, stateView);
      f.params.forEach((p, i) => {
        const v = p.type ? $.ty(args[i], p.type.name, p.type.nullable, `parameter ${p.name} of ${name}`) : args[i];
        env.define(p.name, v);
      });
      let result = null;
      try {
        block(f.body.body, env, false);
      } catch (x) {
        if (x instanceof ReturnSig) result = x.value;
        else throw x;
      }
      if (f.ret) result = $.ty(result, f.ret.name, f.ret.nullable, `return value of ${name}`);
      return result;
    };
    if (lensOf) return { arity: f.params.length, impl: (view, ...args) => impl(view, args) };
    return $.fn(name, f.params.length, (...args) => impl(null, args));
  }

  // ── statements ─────────────────────────────────────────────────────────────
  /** runs a statement list in env (already created by the caller). valueOfLast: whatif — the last ExprStmt's value */
  function block(list, env, valueOfLast) {
    for (const s of list) {
      if (s.type === 'Let') env.reserve(s.name);
      else if (s.type === 'FnDecl') env.define(s.name, makeFn(s, env, null));
    }
    let last = null;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (valueOfLast && i === list.length - 1 && s.type === 'ExprStmt') {
        at(s.line);
        last = ev(s.expr, env);
      } else exec(s, env);
    }
    return last;
  }

  function exec(s, env) {
    if (s.type === 'FnDecl') return; // hoisted by block()
    at(s.line);
    switch (s.type) {
      case 'Let': {
        let v = ev(s.expr, env);
        if (s.vtype) v = $.ty(v, s.vtype.name, s.vtype.nullable, `"${s.name}"`);
        env.vars.set(s.name, { value: v });
        return;
      }
      case 'Assign': return assign(s, env);
      case 'If': {
        if ($.truth(ev(s.cond, env), 'if')) block(s.then.body, new Env(env), false);
        else if (s.otherwise) {
          if (s.otherwise.type === 'If') exec(s.otherwise, env);
          else block(s.otherwise.body, new Env(env), false);
        }
        return;
      }
      case 'While':
        for (;;) {
          at(s.line);
          if (!$.truth(ev(s.cond, env), 'while')) break;
          try { block(s.body.body, new Env(env), false); }
          catch (x) { if (x === BREAK) break; if (x === SKIP) continue; throw x; }
        }
        return;
      case 'For': {
        const items = $.iter(ev(s.iter, env), !!s.b);
        for (const it of items) {
          const fe = new Env(env);
          if (s.b) { fe.define(s.a, it[0]); fe.define(s.b, it[1]); } else fe.define(s.a, it);
          try { block(s.body.body, fe, false); }
          catch (x) { if (x === BREAK) break; if (x === SKIP) continue; throw x; }
        }
        return;
      }
      case 'Break': throw BREAK;
      case 'Skip': throw SKIP;
      case 'Return': throw new ReturnSig(s.expr ? ev(s.expr, env) : null);
      case 'Emit': { const n = ev(s.name, env); $.emit(n, s.payload ? ev(s.payload, env) : null); return; }
      case 'EmitOut': $.emitOut(s.hook, s.payload ? ev(s.payload, env) : null); return;
      case 'Send': { const target = s.expr ? ev(s.expr, env) : s.dyn ? lookup(env, s.comp) : s.comp; $.send(target, s.hook, s.payload ? ev(s.payload, env) : null); return; }
      case 'Wire': { const a = endpoint(s.from, env); const b = endpoint(s.to, env); $.wire(a, b, s.line); return; }
      case 'Despawn': $.despawn(ev(s.expr, env)); return;
      case 'Record': { const n = ev(s.name, env); $.record(n, s.payload ? ev(s.payload, env) : null); return; }
      case 'Gap': { const m = ev(s.msg, env); $.gap(m, ev(s.pressure, env), s.gtype); return; }
      case 'Promote': { const v = ev(s.value, env); $.promote(v, ev(s.proof, env)); return; }
      case 'Try':
        try {
          block(s.body.body, new Env(env), false);
        } catch (x) {
          if (x instanceof Ctrl) throw x;
          const he = new Env(env);
          const val = $.errValue(x);
          if (s.errName) he.define(s.errName, val);
          block(s.handler.body, he, false);
        }
        return;
      case 'Expect': { const c = ev(s.cond, env); $.expect(c, s.msg ? ev(s.msg, env) : null); return; }
      case 'ExprStmt': ev(s.expr, env); return;
    }
    $.error(`internal: unknown statement ${s.type}`);
  }

  function assign(s, env) {
    const t = s.target;
    if (t.type === 'Ident') {
      let v;
      if (s.op === '=') v = ev(s.expr, env);
      else { const cur = lookup(env, t.name); v = $[COMPOUND[s.op]](cur, ev(s.expr, env)); }
      const vt = t.binding && t.binding.vtype;
      if (vt) v = $.ty(v, vt.name, vt.nullable, `"${t.name}"`);
      assignVar(env, t.name, v);
      return;
    }
    if (t.type === 'Member') {
      const o = ev(t.obj, env);
      if (s.op === '=') $.setMember(o, t.name, ev(s.expr, env));
      else $.updMember(o, t.name, cur => $[COMPOUND[s.op]](cur, ev(s.expr, env)));
      return;
    }
    const o = ev(t.obj, env);
    const i = ev(t.index, env);
    if (s.op === '=') $.setIndex(o, i, ev(s.expr, env));
    else $.updIndex(o, i, cur => $[COMPOUND[s.op]](cur, ev(s.expr, env)));
  }

  // ── program ────────────────────────────────────────────────────────────────
  /** builds the declare() spec of a compartment, component or template instance; ends at the declaration's line */
  function buildSpec(c, env, id, name) {
    const pairs = [];
    for (const f of c.state) { at(f.line); pairs.push(f.name); pairs.push(ev(f.expr, env)); }
    const state = $.map(pairs);
    const cenv = new Env(env);
    const fns = Object.create(null);
    for (const f of c.fns) fns[f.name] = makeFn(f, cenv, c.name);
    const constraints = c.constraints.map(k => ({
      name: k.name, ctype: k.ctype, cost: k.cost, needs: k.needs, line: k.line, boundary: !!k.boundary,
      check: $.constraintCheck(k.name, (view) => {
        const ke = new Env(cenv);
        ke.define(STATE, view);
        at(k.line);
        return ev(k.expr, ke);
      }),
    }));
    const handlers = c.handlers.map(h => ({
      signal: h.signal,
      run: (working, payload) => {
        const he = new Env(cenv);
        he.define(STATE, working);
        if (h.param) he.define(h.param, payload);
        try { block(h.body.body, he, false); }
        catch (x) { if (!(x instanceof ReturnSig)) throw x; }
      },
    }));
    let component = null;
    if (c.isComponent) {
      component = {
        namespace: c.namespace, version: c.version, uuid: c.uuid,
        ins: c.ins.map(h => ({
          name: h.name, shape: h.shape,
          run: (working, payload) => {
            const he = new Env(cenv);
            he.define(STATE, working);
            if (h.param) he.define(h.param, payload);
            try { block(h.body.body, he, false); }
            catch (x) { if (!(x instanceof ReturnSig)) throw x; }
          },
        })),
        outs: c.outs.map(h => ({ name: h.name, shape: h.shape })),
        kinds: c.kindsFlat || [], typedState: c.typedState || [],
      };
    }
    at(c.line);
    return { name, id, intent: c.intent, state, constraints, handlers, fns, component };
  }

  function compartment(c, env) {
    if (!c.isTemplate) { $.declare(buildSpec(c, env, c.id, c.name)); return; }
    at(c.line);
    $.template(c.name, c.params.length, (id, ...args) => {
      const tenv = new Env(env);
      c.params.forEach((p, i) => {
        tenv.define(p.name, p.type ? $.ty(args[i], p.type.name, p.type.nullable, `parameter ${p.name} of ${c.name}`) : args[i]);
      });
      return buildSpec(c, tenv, id, `${c.name}(${id})`);
    });
  }

  function endpoint(ep, env) {
    if (ep.signal !== undefined) return { signal: ep.signal };
    if (ep.expr) return { handle: ev(ep.expr, env), hook: ep.hook };
    if (ep.dyn) return { handle: lookup(env, ep.comp), hook: ep.hook };
    return { comp: ep.comp, hook: ep.hook };
  }

  /** run a whole program; returns the top-level Env (the module's exports live there) */
  function runProgram(program, absPath) {
    const env = new Env(null);
    runItems(program.items, env, absPath, program.items.some(i => i.type === 'Axiom'));
    return env;
  }

  /** runs top-level items into env — the REPL calls this with one persistent env */
  function runItems(items, env, absPath, hasAxioms) {
    for (const it of items) {
      if (it.type === 'Let') env.reserve(it.name);
      else if (it.type === 'Use') env.reserve(it.alias);
      else if (it.type === 'FnDecl') env.define(it.name, makeFn(it, env, null));
    }
    for (const it of items) {
      switch (it.type) {
        case 'FnDecl': continue;
        case 'Use': at(it.line); env.define(it.alias, $.use(it.path, it.alias, absPath)); break;
        case 'Compartment': compartment(it, env); break;
        case 'Kind': continue;
        case 'On':
          at(it.line);
          $.onTop(it.signal, (payload) => {
            const he = new Env(env);
            if (it.param) he.define(it.param, payload);
            try { block(it.body.body, he, false); }
            catch (x) { if (!(x instanceof ReturnSig)) throw x; }
          });
          break;
        case 'Axiom':
          at(it.line);
          $.axiom(it.name, it.line, () => { at(it.line); return ev(it.expr, env); });
          continue;
        case 'Test':
          at(it.line);
          $.test(it.name, it.line, () => {
            try { block(it.body.body, new Env(env), false); }
            catch (x) { if (!(x instanceof ReturnSig)) throw x; }
          });
          continue;
        default: exec(it, env);
      }
      if (hasAxioms) $.axioms(it.line, file);
    }
    return env;
  }

  function exportsOf(program, env) {
    const m = Object.create(null);
    for (const name of program.exports) {
      const it = program.items.find(i => (i.name === name) && (i.type === 'FnDecl' || i.type === 'Let' || i.type === 'Compartment'));
      if (it && it.type === 'Compartment') m[name] = $.comp(name);
      else m[name] = env.find(name).value;
    }
    return m;
  }

  const evalExpr = (e, env) => ev(e, env);
  const newEnv = () => new Env(null);
  return { runProgram, runItems, exportsOf, evalExpr, newEnv };
}

module.exports = { createInterpreter };
