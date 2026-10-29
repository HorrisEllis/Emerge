'use strict';
// emerge/lang/emitter.js — checked AST → CommonJS that calls the same runtime as the interpreter.
// component_id: emerge.lang.emitter · spec: emerge/lang/emerge-lang.spec (modules.emitter, rules)
// The output must behave exactly as the interpreter does: same $.at() points, same evaluation order, same runtime calls.
// Names: a local x becomes v_x; state becomes $state; builtins are $.b.name; compartments are looked up by $.comp().

const { VERSION } = require('./runtime');

const J = JSON.stringify;
const v = name => `v_${name}`;
const COMPOUND = { '+=': 'add', '-=': 'sub', '*=': 'mul', '/=': 'div' };
const BINOP = {
  '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'mod', '**': 'pow', '==': 'eq', '!=': 'neq', '..': 'range', '&': 'band', '|': 'bor', '^': 'bxor', '<<': 'shl', '>>': 'shr',
  contains: 'contains', in: 'isIn', starts_with: 'startsWith', ends_with: 'endsWith', matches: 'matches',
};

const shapeOf = sh => (sh ? { fields: sh.fields.map(f => ({ name: f.name, type: { name: f.type.name, nullable: f.type.nullable } })) } : null);


function emitProgram(program, { file, runtimeRequire }) {
  const out = [];
  let depth = 0;
  const line = (s) => out.push('  '.repeat(depth) + s);
  const at = (n) => `$.at(${n}, F);`;
  const ty = (expr, t, what) => `$.ty(${expr}, ${J(t.name)}, ${t.nullable}, ${J(what)})`;

  // ── expressions ────────────────────────────────────────────────────────────
  function ex(e) {
    switch (e.type) {
      case 'Num': return String(e.value);
      case 'Int': return `${e.value}n`;
      case 'Bool': return String(e.value);
      case 'Null': return 'null';
      case 'Str':
        return `$.str([${e.parts.map(p => (typeof p === 'string' ? J(p) : ex(p))).join(', ')}])`;
      case 'List': return `$.list([${e.items.map(ex).join(', ')}])`;
      case 'Map': return `$.map([${e.entries.map(x => `${J(x.key)}, ${ex(x.value)}`).join(', ')}])`;
      case 'Ident':
        switch (e.res) {
          case 'builtin': return `$.b[${J(e.name)}]`;
          case 'comp': return `$.comp(${J(e.name)})`;
          case 'compfn': return `$.lensFn(${J(e.comp)}, ${J(e.name)}, $state)`;
          default: return v(e.name);
        }
      case 'State': return '$state';
      case 'Member': return `$.get(${ex(e.obj)}, ${J(e.name)})`;
      case 'Index': return `$.index(${ex(e.obj)}, ${ex(e.index)})`;
      case 'Unary': return e.op === 'not' ? `$.not(${ex(e.expr)})` : e.op === '~' ? `$.bnot(${ex(e.expr)})` : `$.neg(${ex(e.expr)})`;
      case 'Logical': return `$.${e.op}(${ex(e.l)}, () => ${ex(e.r)})`;
      case 'Coalesce': return `$.coalesce(${ex(e.l)}, () => ${ex(e.r)})`;
      case 'Binary':
        if (['<', '<=', '>', '>='].includes(e.op)) return `$.cmp(${J(e.op)}, ${ex(e.l)}, ${ex(e.r)})`;
        return `$.${BINOP[e.op]}(${ex(e.l)}, ${ex(e.r)})`;
      case 'Call': return `$.call(${ex(e.callee)}, [${e.args.map(ex).join(', ')}])`;
      case 'Lambda': return fnExpr(e, false);
      case 'Spawn': return `$.spawn(${J(e.template)}, [${e.args.map(ex).join(', ')}])`;
      case 'Whatif': {
        const saved = out.length;
        depth++;
        blockBody(e.body.body, true);
        depth--;
        const body = out.splice(saved).join('\n');
        return `$.whatif(() => {\n${body}\n${'  '.repeat(depth)}})`;
      }
    }
    throw new Error(`emitter: unknown expression ${e.type}`);
  }

  /** a function as a JS expression. lens: the first JS parameter is $state */
  function fnExpr(f, lens) {
    const name = f.name || 'anonymous';
    const params = f.params.map(p => v(p.name));
    const saved = out.length;
    depth++;
    fnPrologueAndBody(f, name);
    depth--;
    const body = out.splice(saved).join('\n');
    const head = `function (${lens ? ['$state', ...params].join(', ') : params.join(', ')}) {\n${body}\n${'  '.repeat(depth)}}`;
    return lens ? head : `$.fn(${J(name)}, ${f.params.length}, ${head})`;
  }

  function fnPrologueAndBody(f, name) {
    for (const p of f.params) if (p.type) line(`${v(p.name)} = ${ty(v(p.name), p.type, `parameter ${p.name} of ${name}`)};`);
    const ctx = { ret: f.ret, fnName: name };
    blockBody(f.body.body, false, ctx);
    line(f.ret ? `return ${ty('null', f.ret, `return value of ${name}`)};` : 'return null;');
  }

  // ── statements ─────────────────────────────────────────────────────────────
  function blockBody(list, valueOfLast, ctx = {}) {
    // hoisted fn declarations: JS hoists the declaration; tag it as an Emerge fn first thing in the block
    for (const s of list) if (s.type === 'FnDecl') line(`$.fn(${J(s.name)}, ${s.params.length}, ${v(s.name)});`);
    list.forEach((s, i) => {
      if (valueOfLast && i === list.length - 1 && s.type === 'ExprStmt') {
        line(at(s.line));
        line(`return ${ex(s.expr)};`);
      } else stmt(s, ctx);
    });
    if (valueOfLast && !(list.length && list[list.length - 1].type === 'ExprStmt')) line('return null;');
  }

  function block(list, ctx) {
    depth++;
    blockBody(list, false, ctx);
    depth--;
  }

  function stmt(s, ctx) {
    if (s.type === 'FnDecl') {
      line(`function ${v(s.name)}(${s.params.map(p => v(p.name)).join(', ')}) {`);
      depth++;
      fnPrologueAndBody(s, s.name);
      depth--;
      line('}');
      return;
    }
    line(at(s.line));
    switch (s.type) {
      case 'Let': {
        const e = ex(s.expr);
        line(`let ${v(s.name)} = ${s.vtype ? ty(e, s.vtype, `"${s.name}"`) : e};`);
        return;
      }
      case 'Assign': return assign(s);
      case 'If': {
        line(`if ($.truth(${ex(s.cond)}, "if")) {`);
        block(s.then.body, ctx);
        if (s.otherwise) {
          line('} else {');
          depth++;
          if (s.otherwise.type === 'If') stmt(s.otherwise, ctx);
          else blockBody(s.otherwise.body, false, ctx);
          depth--;
        }
        line('}');
        return;
      }
      case 'While':
        line('for (;;) {');
        depth++;
        line(at(s.line));
        line(`if (!$.truth(${ex(s.cond)}, "while")) break;`);
        line('{');
        block(s.body.body, ctx);
        line('}');
        depth--;
        line('}');
        return;
      case 'For':
        if (s.b) line(`for (const [${v(s.a)}, ${v(s.b)}] of $.iter(${ex(s.iter)}, true)) {`);
        else line(`for (const ${v(s.a)} of $.iter(${ex(s.iter)}, false)) {`);
        block(s.body.body, ctx);
        line('}');
        return;
      case 'Break': line('break;'); return;
      case 'Skip': line('continue;'); return;
      case 'Return':
        if (ctx.handler) { line('return;'); return; }
        if (ctx.ret) line(`return ${ty(s.expr ? ex(s.expr) : 'null', ctx.ret, `return value of ${ctx.fnName}`)};`);
        else line(`return ${s.expr ? ex(s.expr) : 'null'};`);
        return;
      case 'Emit': line(`$.emit(${ex(s.name)}, ${s.payload ? ex(s.payload) : 'null'});`); return;
      case 'EmitOut': line(`$.emitOut(${J(s.hook)}, ${s.payload ? ex(s.payload) : 'null'});`); return;
      case 'Send': line(`$.send(${s.expr ? ex(s.expr) : s.dyn ? v(s.comp) : J(s.comp)}, ${J(s.hook)}, ${s.payload ? ex(s.payload) : 'null'});`); return;
      case 'Wire': line(`$.wire(${endExpr(s.from)}, ${endExpr(s.to)}, ${s.line});`); return;
      case 'Despawn': line(`$.despawn(${ex(s.expr)});`); return;
      case 'Record': line(`$.record(${ex(s.name)}, ${s.payload ? ex(s.payload) : 'null'});`); return;
      case 'Gap': line(`$.gap(${ex(s.msg)}, ${ex(s.pressure)}, ${s.gtype ? J(s.gtype) : 'null'});`); return;
      case 'Promote': line(`$.promote(${ex(s.value)}, ${ex(s.proof)});`); return;
      case 'Try':
        line('try {');
        block(s.body.body, ctx);
        line('} catch ($e) {');
        depth++;
        line(`const ${s.errName ? v(s.errName) : '$err'} = $.errValue($e);`);
        blockBody(s.handler.body, false, ctx);
        depth--;
        line('}');
        return;
      case 'Expect': line(`$.expect(${ex(s.cond)}, ${s.msg ? ex(s.msg) : 'null'});`); return;
      case 'ExprStmt': line(`${ex(s.expr)};`); return;
    }
    throw new Error(`emitter: unknown statement ${s.type}`);
  }

  function assign(s) {
    const t = s.target;
    if (t.type === 'Ident') {
      const rhs = s.op === '=' ? ex(s.expr) : `$.${COMPOUND[s.op]}(${v(t.name)}, ${ex(s.expr)})`;
      const vt = t.binding && t.binding.vtype;
      line(`${v(t.name)} = ${vt ? ty(rhs, vt, `"${t.name}"`) : rhs};`);
      return;
    }
    if (t.type === 'Member') {
      if (s.op === '=') line(`$.setMember(${ex(t.obj)}, ${J(t.name)}, ${ex(s.expr)});`);
      else line(`$.updMember(${ex(t.obj)}, ${J(t.name)}, ($c) => $.${COMPOUND[s.op]}($c, ${ex(s.expr)}));`);
      return;
    }
    if (s.op === '=') line(`$.setIndex(${ex(t.obj)}, ${ex(t.index)}, ${ex(s.expr)});`);
    else line(`$.updIndex(${ex(t.obj)}, ${ex(t.index)}, ($c) => $.${COMPOUND[s.op]}($c, ${ex(s.expr)}));`);
  }

  function handlerFn(params, body) {
    const saved = out.length;
    depth++;
    blockBody(body, false, { handler: true });
    depth--;
    const b = out.splice(saved).join('\n');
    return `function (${params.join(', ')}) {\n${b}\n${'  '.repeat(depth)}}`;
  }

  const endExpr = ep => (ep.signal !== undefined ? `{ signal: ${J(ep.signal)} }`
    : ep.expr ? `{ handle: ${ex(ep.expr)}, hook: ${J(ep.hook)} }`
    : ep.dyn ? `{ handle: ${v(ep.comp)}, hook: ${J(ep.hook)} }` : `{ comp: ${J(ep.comp)}, hook: ${J(ep.hook)} }`);

  function compartment(c) {
    if (c.isTemplate) {
      line(at(c.line));
      line(`$.template(${J(c.name)}, ${c.params.length}, function ($id${c.params.map(p => ', ' + v(p.name)).join('')}) {`);
      depth++;
      for (const p of c.params) if (p.type) line(`${v(p.name)} = ${ty(v(p.name), p.type, `parameter ${p.name} of ${c.name}`)};`);
      specLines(c);
      line(at(c.line));
      line(`return { name: ${J(c.name + '(')} + $id + ")", id: $id, intent: ${J(c.intent)}, state: $st, constraints: $constraints, handlers: $handlers, fns: $fns, component: $component };`);
      depth--;
      line('});');
      return;
    }
    line('{');
    depth++;
    specLines(c);
    line(at(c.line));
    line(`$.declare({ name: ${J(c.name)}, id: ${J(c.id)}, intent: ${J(c.intent)}, state: $st, constraints: $constraints, handlers: $handlers, fns: $fns, component: ${c.isComponent ? '$component' : 'null'} });`);
    depth--;
    line('}');
  }

  function specLines(c) {
    line(`const $st = $.map([${c.state.map(f => `${J(f.name)}, ($.at(${f.line}, F), ${ex(f.expr)})`).join(', ')}]);`);
    line('const $fns = Object.create(null);');
    for (const f of c.fns) line(`$fns[${J(f.name)}] = { arity: ${f.params.length}, impl: ${fnExpr(f, true)} };`);
    line('const $constraints = [');
    depth++;
    for (const k of c.constraints) {
      line(`{ name: ${J(k.name)}, ctype: ${J(k.ctype)}, cost: ${k.cost}, needs: ${J(k.needs)}, line: ${k.line}, boundary: ${!!k.boundary},`);
      line(`  check: $.constraintCheck(${J(k.name)}, ($state) => { ${at(k.line)} return ${ex(k.expr)}; }) },`);
    }
    depth--;
    line('];');
    line('const $handlers = [');
    depth++;
    for (const h of c.handlers) {
      line(`{ signal: ${J(h.signal)}, run: ${handlerFn(['$state', h.param ? v(h.param) : '$payload'], h.body.body)} },`);
    }
    depth--;
    line('];');
    if (c.isComponent) {
      line('const $component = {');
      depth++;
      line(`namespace: ${J(c.namespace)}, version: ${J(c.version)}, uuid: ${J(c.uuid)},`);
      line('ins: [');
      depth++;
      for (const h of c.ins) line(`{ name: ${J(h.name)}, shape: ${J(shapeOf(h.shape))}, run: ${handlerFn(['$state', h.param ? v(h.param) : '$payload'], h.body.body)} },`);
      depth--;
      line('],');
      line(`outs: [${c.outs.map(h => `{ name: ${J(h.name)}, shape: ${J(shapeOf(h.shape))} }`).join(', ')}],`);
      line(`kinds: ${J(c.kindsFlat || [])}, typedState: ${J(c.typedState || [])},`);
      depth--;
      line('};');
    }
  }

  // ── program ────────────────────────────────────────────────────────────────
  const hasAxioms = program.items.some(i => i.type === 'Axiom');
  line(`'use strict';`);
  line(`// generated by emerge-lang ${VERSION} from ${file} — edit the .eg, not this file`);
  line(`const F = ${J(file)};`);
  line('module.exports = function load($) {');
  depth++;
  for (const it of program.items) if (it.type === 'FnDecl') line(`$.fn(${J(it.name)}, ${it.params.length}, ${v(it.name)});`);
  for (const it of program.items) {
    switch (it.type) {
      case 'FnDecl': stmt(it, {}); continue;
      case 'Use':
        line(at(it.line));
        line(`const ${v(it.alias)} = $.use(${J(it.path)}, ${J(it.alias)}, __filename.replace(/\\.js$/, '.eg'));`);
        break;
      case 'Compartment': compartment(it); break;
      case 'Kind': continue;
      case 'On':
        line(at(it.line));
        line(`$.onTop(${J(it.signal)}, ${handlerFn([it.param ? v(it.param) : '$payload'], it.body.body)});`);
        break;
      case 'Axiom':
        line(at(it.line));
        line(`$.axiom(${J(it.name)}, ${it.line}, () => { ${at(it.line)} return ${ex(it.expr)}; });`);
        continue;
      case 'Test':
        line(at(it.line));
        line(`$.test(${J(it.name)}, ${it.line}, ${handlerFn([], it.body.body)});`);
        continue;
      default: stmt(it, {});
    }
    if (hasAxioms) line(`$.axioms(${it.line}, F);`);
  }
  const exp = program.exports.map(name => {
    const it = program.items.find(i => i.name === name && (i.type === 'FnDecl' || i.type === 'Let' || i.type === 'Compartment'));
    return `  ${J(name)}: ${it && it.type === 'Compartment' ? `$.comp(${J(name)})` : v(name)},`;
  });
  line(`return Object.assign(Object.create(null), {\n${exp.map(x => '  '.repeat(depth) + x).join('\n')}\n${'  '.repeat(depth)}});`);
  depth--;
  line('};');
  line('if (require.main === module) {');
  line(`  process.exitCode = require(${J(runtimeRequire)}).runCompiled(module.exports, { file: F });`);
  line('}');
  return out.join('\n') + '\n';
}

module.exports = { emitProgram };
