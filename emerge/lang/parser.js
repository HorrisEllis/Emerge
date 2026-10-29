'use strict';
// emerge/lang/parser.js — tokens → AST. Recursive descent; expressions by precedence levels.
// component_id: emerge.lang.parser · spec: emerge/lang/emerge-lang.spec (grammar)
// The first error throws an EmergeSyntaxError naming file:line:col and what was expected.

const { lex } = require('./lexer');
const { EmergeSyntaxError } = require('./errors');

const TYPES = new Set(['int', 'float', 'num', 'string', 'bool', 'list', 'map', 'bytes', 'fn', 'any']);
const build = require('./build-loader');
// constraint type words come from primitives.eg (constraint_types)
const isCtype = (w) => Object.prototype.hasOwnProperty.call(build.primitives().constraint_types, w);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=']);
const COMPARE_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const COMPARE_KWS = new Set(['contains', 'starts_with', 'ends_with', 'matches', 'in']);

function describe(tok) {
  if (tok.t === 'EOF') return 'end of file';
  if (tok.t === 'NL') return 'end of line';
  if (tok.t === 'STR') return 'a string';
  if (tok.t === 'NUM') return `number ${tok.v}`;
  if (tok.t === 'INT') return `int ${tok.v}i`;
  return `"${tok.v}"`;
}

class Parser {
  constructor(tokens, file) {
    this.toks = tokens;
    this.i = 0;
    this.file = file;
  }

  // ── token helpers ──────────────────────────────────────────────────────────
  peek(o = 0) { return this.toks[Math.min(this.i + o, this.toks.length - 1)]; }
  next() { const t = this.toks[this.i]; if (this.i < this.toks.length - 1) this.i++; return t; }
  is(t, v) { const k = this.peek(); return k.t === t && (v === undefined || k.v === v); }
  isOp(v) { return this.is('OP', v); }
  isKw(v) { return this.is('KW', v); }
  isWord(v) { return this.is('IDENT', v); }
  err(msg, tok = this.peek()) { throw new EmergeSyntaxError(msg, this.file, tok.line, tok.col); }
  expectOp(v, what) { if (!this.isOp(v)) this.err(`expected "${v}"${what ? ' ' + what : ''}, found ${describe(this.peek())}`); return this.next(); }
  expectKw(v, what) { if (!this.isKw(v)) this.err(`expected "${v}"${what ? ' ' + what : ''}, found ${describe(this.peek())}`); return this.next(); }
  expectIdent(what) { if (!this.is('IDENT')) this.err(`expected ${what}, found ${describe(this.peek())}`); return this.next(); }
  skipNL() { while (this.is('NL') || this.isOp(';')) this.next(); }
  node(type, tok, props) { return Object.assign({ type, line: tok.line, col: tok.col }, props); }

  endStmt() {
    if (this.is('NL') || this.isOp(';')) { this.skipNL(); return; }
    if (this.isOp('}') || this.is('EOF')) return;
    this.err(`expected end of statement, found ${describe(this.peek())}`);
  }

  /** else on the same line, or on the next line after the closing brace */
  peekElse() {
    let k = 0;
    while (this.peek(k).t === 'NL') k++;
    if (this.peek(k).t === 'KW' && this.peek(k).v === 'else') { this.i += k; return true; }
    return false;
  }

  // ── program ────────────────────────────────────────────────────────────────
  parseProgram() {
    const start = this.peek();
    const items = [];
    this.skipNL();
    while (!this.is('EOF')) {
      items.push(this.parseItem());
      this.endStmt();
    }
    return this.node('Program', start, { items, file: this.file });
  }

  parseItem() {
    const t = this.peek();
    // kind is contextual: kind Name { … } or kind Name is …
    if (t.t === 'IDENT' && t.v === 'kind' && this.peek(1).t === 'IDENT' &&
        ((this.peek(2).t === 'OP' && this.peek(2).v === '{') || (this.peek(2).t === 'IDENT' && this.peek(2).v === 'is'))) {
      return this.parseKind();
    }
    if (t.t === 'KW') {
      switch (t.v) {
        case 'use': return this.parseUse();
        case 'compartment': case 'component': case 'template': return this.parseCompartment();
        case 'axiom': return this.parseAxiom();
        case 'test': return this.parseTest();
        case 'on': return this.parseOn();
      }
    }
    return this.parseStmt(true);
  }

  parseUse() {
    const t = this.next();
    if (!this.is('STR') || this.peek().v === null) this.err('expected a plain string path after use');
    const path = this.next().v;
    this.expectKw('as', 'after the module path');
    const alias = this.expectIdent('a module name after as').v;
    return this.node('Use', t, { path, alias });
  }

  /** compartment and component share one body grammar; a component adds identity fields, boundary and hooks */
  parseCompartment() {
    const t = this.next();
    const kind = t.v; // 'compartment' | 'component' | 'template'
    const isTemplate = kind === 'template';
    const isComponent = kind === 'component' || isTemplate;
    const name = this.expectIdent(`a ${kind} name`).v;
    const c = this.node('Compartment', t, {
      name, kind, isComponent, isTemplate, id: null, intent: null, namespace: null, version: null, uuid: null,
      state: [], constraints: [], handlers: [], fns: [], ins: [], outs: [], idTok: null, params: [], kinds: [],
    });
    if (isTemplate) c.params = this.parseParams();
    if (isComponent && this.isWord('is')) c.kinds = this.parseIsList();
    const IDENTITY = isTemplate ? ['intent', 'namespace', 'version'] : isComponent ? ['id', 'intent', 'namespace', 'version', 'uuid'] : ['id', 'intent'];
    this.expectOp('{', `to open the ${kind}`);
    this.skipNL();
    while (!this.isOp('}')) {
      const m = this.peek();
      if (isTemplate && m.t === 'IDENT' && (m.v === 'id' || m.v === 'uuid') && this.peek(1).t === 'OP' && this.peek(1).v === '=') {
        this.err(`a template's ${m.v} is given per instance — spawn ${name}("an.id", …)`);
      }
      if (m.t === 'IDENT' && IDENTITY.includes(m.v) && this.peek(1).t === 'OP' && this.peek(1).v === '=') {
        const key = this.next().v;
        this.expectOp('=', `after ${key}`);
        if (!this.is('STR') || this.peek().v === null) this.err(`${key} must be a plain string`);
        if (c[key] !== null) this.err(`${key} is declared twice`, m);
        c[key] = this.next().v;
        if (key === 'id') c.idTok = m;
      } else if (this.isKw('state')) {
        this.next();
        if (c.stateDeclared) this.err('state is declared twice', m);
        c.stateDeclared = true;
        this.expectOp('{', 'to open state');
        this.skipNL();
        while (!this.isOp('}')) {
          const f = this.expectIdent('a state field name');
          this.expectOp(':', 'after the field name');
          this.skipNL();
          c.state.push({ name: f.v, expr: this.parseExpr(), line: f.line, col: f.col });
          this.skipNL();
          if (this.isOp(',')) { this.next(); this.skipNL(); } else break;
        }
        this.skipNL();
        this.expectOp('}', 'to close state');
      } else if (this.isKw('constraint') || this.isKw('invariant') || (isComponent && this.isWord('boundary'))) {
        const kw = this.next().v;
        const cname = this.expectIdent(`a ${kw} name`).v;
        let ctype = 'hard', cost = null;   // null: the type's default_cost from primitives.eg
        if (kw === 'constraint') {
          if (this.is('IDENT') && this.peek().v !== 'cost' && isCtype(this.peek().v)) ctype = this.next().v;
          if (this.isWord('cost')) {
            this.next();
            if (!this.is('NUM')) this.err('expected a number after cost');
            cost = this.next().v;
          }
        }
        this.expectOp('{', `to open the ${kw} expression`);
        this.skipNL();
        const expr = this.parseExpr();
        this.skipNL();
        this.expectOp('}', `to close the ${kw} expression`);
        c.constraints.push({ name: cname, ctype, cost, expr, boundary: kw === 'boundary', line: m.line, col: m.col });
      } else if (this.isKw('on')) {
        if (isComponent) this.err('a component listens through in hooks — write in <hook>(param) { … } and wire signals to it');
        c.handlers.push(this.parseOn());
      } else if (isComponent && this.isKw('in')) {
        c.ins.push(this.parseInHook());
      } else if (isComponent && this.isWord('out')) {
        this.next();
        const h = this.expectIdent('an out hook name');
        let shape = null;
        if (this.isOp(':')) { this.next(); shape = this.parseShape(); }
        c.outs.push({ name: h.v, shape, line: h.line, col: h.col });
      } else if (this.isKw('fn')) {
        c.fns.push(this.parseFnDecl());
      } else {
        this.err(isComponent
          ? `a ${kind} holds id, namespace, version, uuid, intent, state, constraint, invariant, boundary, in, out and fn — found ${describe(m)}`
          : `a compartment holds id, intent, state, constraint, invariant, on and fn — found ${describe(m)}`);
      }
      this.endStmt();
    }
    this.expectOp('}', `to close the ${kind}`);
    return c;
  }

  /** { field: type, … } — a hook's payload contract */
  parseShape() {
    const t = this.expectOp('{', 'to open a shape { field: type, … }');
    const fields = [];
    const seen = new Set();
    this.skipNL();
    while (!this.isOp('}')) {
      const f = this.peek();
      if (f.t !== 'IDENT' && f.t !== 'KW') this.err(`expected a field name in the shape, found ${describe(f)}`);
      this.next();
      if (seen.has(f.v)) this.err(`shape field "${f.v}" appears twice`, f);
      seen.add(f.v);
      this.expectOp(':', 'after the shape field');
      fields.push({ name: f.v, type: this.parseType() });
      this.skipNL();
      if (this.isOp(',')) { this.next(); this.skipNL(); } else break;
    }
    this.skipNL();
    this.expectOp('}', 'to close the shape');
    return { fields, line: t.line, col: t.col };
  }

  parseInHook() {
    const t = this.next();
    const h = this.expectIdent('an in hook name');
    let param = null, shape = null;
    if (this.isOp('(')) {
      this.next();
      param = this.expectIdent('a parameter name for the hook payload').v;
      if (this.isOp(':')) { this.next(); shape = this.parseShape(); }
      this.expectOp(')');
    }
    const body = this.parseBlock();
    return this.node('InHook', t, { name: h.v, param, shape, body, nameLine: h.line, nameCol: h.col });
  }

  /** "signal" | Component.hook | <any expression giving an instance>.hook */
  parseEndpoint() {
    const t = this.peek();
    if (t.t === 'STR' && t.v !== null) { this.next(); return { signal: t.v, line: t.line, col: t.col }; }
    if (t.t === 'IDENT' && this.peek(1).t === 'OP' && this.peek(1).v === '.' && this.peek(2).t === 'IDENT' &&
        !(this.peek(3).t === 'OP' && ['.', '[', '('].includes(this.peek(3).v))) {
      this.next(); this.next();
      const h = this.next();
      return { comp: t.v, hook: h.v, line: t.line, col: t.col };
    }
    if (t.t === 'IDENT' || (t.t === 'OP' && t.v === '(')) {
      const e = this.parsePostfix();
      if (e.type !== 'Member') this.err('expected Component.hook or instance.hook as a wire end', t);
      return { expr: e.obj, hook: e.name, line: t.line, col: t.col };
    }
    this.err(`expected Component.hook or a "signal" as a wire end, found ${describe(t)}`);
  }

  parseIsList() {
    this.next(); // is
    const list = [];
    do {
      const k = this.expectIdent('a kind name');
      list.push({ name: k.v, line: k.line, col: k.col });
    } while (this.isOp(',') && this.next());
    return list;
  }

  parseKind() {
    const t = this.next();
    const name = this.expectIdent('a kind name').v;
    const k = this.node('Kind', t, { name, parents: [], requires: [], ins: [], outs: [], state: [], boundaryCount: null, fns: [] });
    if (this.isWord('is')) k.parents = this.parseIsList();
    this.expectOp('{', 'to open the kind');
    this.skipNL();
    while (!this.isOp('}')) {
      const m = this.peek();
      if (this.isWord('require')) {
        this.next();
        do {
          const f = this.expectIdent('an identity field to require');
          if (!['id', 'namespace', 'version', 'intent', 'uuid'].includes(f.v)) this.err(`require names identity fields: id, namespace, version, intent, uuid — not "${f.v}"`, f);
          k.requires.push(f.v);
        } while (this.isOp(',') && this.next());
      } else if (this.isKw('in')) {
        this.next();
        const h = this.expectIdent('an in hook name');
        let shape = null;
        if (this.isOp('(')) {
          this.next();
          this.expectIdent('a parameter name');
          if (this.isOp(':')) { this.next(); shape = this.parseShape(); }
          this.expectOp(')');
        }
        k.ins.push({ name: h.v, shape, line: h.line, col: h.col });
      } else if (this.isWord('out')) {
        this.next();
        const h = this.expectIdent('an out hook name');
        let shape = null;
        if (this.isOp(':')) { this.next(); shape = this.parseShape(); }
        k.outs.push({ name: h.v, shape, line: h.line, col: h.col });
      } else if (this.isKw('state')) {
        this.next();
        const sh = this.parseShape();
        for (const f of sh.fields) k.state.push({ ...f, line: m.line, col: m.col });
      } else if (this.isWord('boundary_count')) {
        this.next();
        if (!this.is('NUM')) this.err('expected a number after boundary_count');
        const lo = this.next().v;
        let hi = lo;
        if (this.isOp('..')) { this.next(); if (!this.is('NUM')) this.err('expected a number after ..'); hi = this.next().v; }
        if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || hi < lo || hi > 5) this.err('boundary_count is a range inside 0..5', m);
        k.boundaryCount = { lo, hi, line: m.line, col: m.col };
      } else if (this.isKw('fn')) {
        this.next();
        const f = this.expectIdent('a fn name');
        k.fns.push({ name: f.v, arity: this.parseParams().length, line: f.line, col: f.col });
      } else {
        this.err(`a kind holds require, in, out, state, boundary_count and fn — found ${describe(m)}`);
      }
      this.endStmt();
    }
    this.expectOp('}', 'to close the kind');
    return k;
  }

  parseWire() {
    const t = this.next();
    const from = this.parseEndpoint();
    this.expectOp('->', 'between the two ends of a wire');
    const to = this.parseEndpoint();
    return this.node('Wire', t, { from, to });
  }

  parseOn() {
    const t = this.next();
    if (!this.is('STR') || this.peek().v === null) this.err('expected a plain string signal name after on');
    const signal = this.next().v;
    let param = null;
    if (this.isOp('(')) {
      this.next();
      param = this.expectIdent('a parameter name for the signal payload').v;
      this.expectOp(')');
    }
    const body = this.parseBlock();
    return this.node('On', t, { signal, param, body });
  }

  parseAxiom() {
    const t = this.next();
    const name = this.expectIdent('an axiom name').v;
    this.expectOp('{', 'to open the axiom expression');
    this.skipNL();
    const expr = this.parseExpr();
    this.skipNL();
    this.expectOp('}', 'to close the axiom expression');
    return this.node('Axiom', t, { name, expr });
  }

  parseTest() {
    const t = this.next();
    if (!this.is('STR') || this.peek().v === null) this.err('expected a plain string test name');
    const name = this.next().v;
    return this.node('Test', t, { name, body: this.parseBlock() });
  }

  parseType() {
    const t = this.peek();
    let name;
    if (t.t === 'IDENT' && TYPES.has(t.v)) name = this.next().v;
    else if (t.t === 'KW' && t.v === 'fn') name = this.next().v;
    else this.err(`expected a type (${[...TYPES].join(', ')}), found ${describe(t)}`);
    let nullable = false;
    if (this.isOp('?')) { this.next(); nullable = true; }
    return { name, nullable };
  }

  parseParams() {
    this.expectOp('(', 'to open the parameter list');
    const params = [];
    const seen = new Set();
    while (!this.isOp(')')) {
      const p = this.expectIdent('a parameter name');
      if (seen.has(p.v)) this.err(`parameter "${p.v}" is declared twice`, p);
      seen.add(p.v);
      let type = null;
      if (this.isOp(':')) { this.next(); type = this.parseType(); }
      params.push({ name: p.v, type, line: p.line, col: p.col });
      if (this.isOp(',')) this.next(); else break;
    }
    this.expectOp(')', 'to close the parameter list');
    return params;
  }

  parseFnRest(t, name) {
    const params = this.parseParams();
    let ret = null;
    if (this.isOp(':')) { this.next(); ret = this.parseType(); }
    let body;
    if (this.isOp('=')) {
      const eq = this.next();
      this.skipNL();
      const expr = this.parseExpr();
      body = this.node('Block', eq, { body: [this.node('Return', eq, { expr })] });
    } else {
      body = this.parseBlock();
    }
    return { name, params, ret, body };
  }

  parseFnDecl() {
    const t = this.next();
    const name = this.expectIdent('a function name').v;
    return this.node('FnDecl', t, this.parseFnRest(t, name));
  }

  parseBlock() {
    const t = this.expectOp('{', 'to open a block');
    const body = [];
    this.skipNL();
    while (!this.isOp('}')) {
      if (this.is('EOF')) this.err('unterminated block — missing "}"', t);
      body.push(this.parseStmt(false));
      this.endStmt();
    }
    this.next();
    return this.node('Block', t, { body });
  }

  // ── statements ─────────────────────────────────────────────────────────────
  parseStmt(topLevel) {
    const t = this.peek();
    if (t.t === 'KW') {
      switch (t.v) {
        case 'let': case 'var': {
          this.next();
          const name = this.expectIdent(`a variable name after ${t.v}`).v;
          let vtype = null;
          if (this.isOp(':')) { this.next(); vtype = this.parseType(); }
          this.expectOp('=', `— ${t.v} needs a value`);
          this.skipNL();
          return this.node('Let', t, { kind: t.v, name, vtype, expr: this.parseExpr() });
        }
        case 'fn':
          if (this.peek(1).t === 'IDENT') return this.parseFnDecl();
          break;
        case 'if': return this.parseIf();
        case 'while': {
          this.next();
          const cond = this.parseExpr();
          return this.node('While', t, { cond, body: this.parseBlock() });
        }
        case 'for': {
          this.next();
          if (this.isWord('each')) this.next();
          const a = this.expectIdent('a loop variable').v;
          let b = null;
          if (this.isOp(',')) { this.next(); b = this.expectIdent('a second loop variable').v; }
          this.expectKw('in', 'in a for loop');
          const iter = this.parseExpr();
          return this.node('For', t, { a, b, iter, body: this.parseBlock() });
        }
        case 'break': this.next(); return this.node('Break', t, {});
        case 'skip': this.next(); return this.node('Skip', t, {});
        case 'return': {
          this.next();
          const ends = this.is('NL') || this.isOp(';') || this.isOp('}') || this.is('EOF');
          return this.node('Return', t, { expr: ends ? null : this.parseExpr() });
        }
        case 'wire': return this.parseWire();
        case 'despawn': this.next(); return this.node('Despawn', t, { expr: this.parseExpr() });
        case 'send': {
          this.next();
          const to = this.parseEndpoint();
          if (to.signal !== undefined) this.err('send goes to Component.hook — to raise a signal use emit', t);
          let payload = null;
          if (this.isOp('{')) payload = this.parsePrimary();
          else if (this.isKw('with')) { this.next(); payload = this.parseExpr(); }
          return this.node('Send', t, { comp: to.comp, expr: to.expr, hook: to.hook, payload });
        }
        case 'emit': case 'record': {
          this.next();
          if (t.v === 'emit' && this.isWord('out') && this.peek(1).t === 'IDENT') {
            this.next();
            const h = this.next();
            let payload = null;
            if (this.isOp('{')) payload = this.parsePrimary();
            else if (this.isKw('with')) { this.next(); payload = this.parseExpr(); }
            return this.node('EmitOut', t, { hook: h.v, payload, hookLine: h.line, hookCol: h.col });
          }
          const name = this.parseExpr();
          let payload = null;
          if (this.isOp('{')) payload = this.parsePrimary();
          else if (this.isKw('with')) { this.next(); payload = this.parseExpr(); }
          return this.node(t.v === 'emit' ? 'Emit' : 'Record', t, { name, payload });
        }
        case 'gap': {
          this.next();
          const msg = this.parseExpr();
          if (!this.isWord('pressure')) this.err('GAP_IS_FIRST_CLASS: a gap declares its pressure — gap <message> pressure <0..1> [type <kind>]');
          this.next();
          const pressure = this.parseExpr();
          let gtype = null, gtypeTok = null;
          if (this.isWord('type')) { this.next(); gtypeTok = this.peek(); gtype = this.expectIdent('a gap type').v; }
          return this.node('Gap', t, { msg, pressure, gtype, gtypeTok });
        }
        case 'promote': {
          this.next();
          const value = this.parseExpr();
          if (!this.isKw('with') || !(this.peek(1).t === 'IDENT' && this.peek(1).v === 'proof')) {
            this.err('PROOF_REQUIRED_FOR_PROMOTION: promote <value> with proof <bool expr>');
          }
          this.next(); this.next();
          return this.node('Promote', t, { value, proof: this.parseExpr() });
        }
        case 'try': {
          this.next();
          const body = this.parseBlock();
          if (!this.peekElse()) this.err('NO_SILENT_DROP: try needs an else block that handles the failure');
          this.next();
          let errName = null;
          if (this.is('IDENT')) errName = this.next().v;
          const handler = this.parseBlock();
          return this.node('Try', t, { body, errName, handler });
        }
        case 'expect': {
          this.next();
          const cond = this.parseExpr();
          let msg = null;
          if (this.isOp(',')) { this.next(); msg = this.parseExpr(); }
          return this.node('Expect', t, { cond, msg });
        }
        case 'use': case 'compartment': case 'component': case 'template': case 'axiom': case 'test': case 'on':
          if (!topLevel) this.err(`${t.v} is only allowed at the top level of a file`);
          break;
      }
    }
    const expr = this.parseExpr();
    if (this.is('OP') && ASSIGN_OPS.has(this.peek().v)) {
      const op = this.next();
      if (!['Ident', 'Member', 'Index'].includes(expr.type)) this.err('this cannot be assigned to', op);
      this.skipNL();
      return this.node('Assign', op, { target: expr, op: op.v, expr: this.parseExpr() });
    }
    return this.node('ExprStmt', t, { expr });
  }

  parseIf() {
    const t = this.next();
    const cond = this.parseExpr();
    const then = this.parseBlock();
    let otherwise = null;
    if (this.peekElse()) {
      this.next();
      if (this.isKw('if')) otherwise = this.parseIf();
      else otherwise = this.parseBlock();
    }
    return this.node('If', t, { cond, then, otherwise });
  }

  // ── expressions ────────────────────────────────────────────────────────────
  parseExpr() { return this.parsePipe(); }

  parsePipe() {
    let l = this.parseCoalesce();
    for (;;) {
      // a pipe may lead the next line
      let k = 0;
      while (this.peek(k).t === 'NL') k++;
      if (!(this.peek(k).t === 'OP' && this.peek(k).v === '|>')) break;
      this.i += k;
      const op = this.next();
      this.skipNL();
      const r = this.parseCoalesce();
      if (r.type === 'Call') l = this.node('Call', op, { callee: r.callee, args: [l, ...r.args], pipe: true });
      else l = this.node('Call', op, { callee: r, args: [l], pipe: true });
    }
    return l;
  }

  binaryLevel(nextFn, ops, nodeType = 'Binary') {
    let l = nextFn();
    while (this.is('OP') && ops.includes(this.peek().v) || (this.is('KW') && ops.includes(this.peek().v))) {
      const op = this.next();
      this.skipNL();
      l = this.node(nodeType, op, { op: op.v, l, r: nextFn() });
    }
    return l;
  }

  parseCoalesce() { return this.binaryLevel(() => this.parseOr(), ['??'], 'Coalesce'); }
  parseOr() { return this.binaryLevel(() => this.parseAnd(), ['or'], 'Logical'); }
  parseAnd() { return this.binaryLevel(() => this.parseNot(), ['and'], 'Logical'); }

  parseNot() {
    if (this.isKw('not')) {
      const t = this.next();
      return this.node('Unary', t, { op: 'not', expr: this.parseNot() });
    }
    return this.parseCompare();
  }

  parseCompare() {
    const l = this.parseRange();
    const k = this.peek();
    if ((k.t === 'OP' && COMPARE_OPS.has(k.v)) || (k.t === 'KW' && COMPARE_KWS.has(k.v))) {
      const op = this.next();
      this.skipNL();
      const r = this.parseRange();
      const n = this.peek();
      if ((n.t === 'OP' && COMPARE_OPS.has(n.v)) || (n.t === 'KW' && COMPARE_KWS.has(n.v))) {
        this.err('comparisons do not chain — write a < b and b < c', n);
      }
      return this.node('Binary', op, { op: op.v, l, r });
    }
    return l;
  }

  parseRange() {
    const l = this.parseBitOr();
    if (this.isOp('..')) {
      const op = this.next();
      return this.node('Binary', op, { op: '..', l, r: this.parseBitOr() });
    }
    return l;
  }

  // bit operators (Python's order): | below ^ below & below << >>, all above comparison and .. and below + -
  parseBitOr() { return this.binaryLevel(() => this.parseBitXor(), ['|']); }
  parseBitXor() { return this.binaryLevel(() => this.parseBitAnd(), ['^']); }
  parseBitAnd() { return this.binaryLevel(() => this.parseShift(), ['&']); }
  parseShift() { return this.binaryLevel(() => this.parseAdd(), ['<<', '>>']); }
  parseAdd() { return this.binaryLevel(() => this.parseMul(), ['+', '-']); }
  parseMul() { return this.binaryLevel(() => this.parseUnary(), ['*', '/', '%']); }

  parseUnary() {
    if (this.isOp('-') || this.isOp('~')) {
      const t = this.next();
      return this.node('Unary', t, { op: t.v, expr: this.parseUnary() });
    }
    return this.parsePow();
  }

  parsePow() {
    const l = this.parsePostfix();
    if (this.isOp('**')) {
      const op = this.next();
      this.skipNL();
      return this.node('Binary', op, { op: '**', l, r: this.parseUnary() });
    }
    return l;
  }

  parsePostfix() {
    let e = this.parsePrimary();
    for (;;) {
      if (this.isOp('(')) {
        const t = this.next();
        const args = [];
        while (!this.isOp(')')) {
          args.push(this.parseExpr());
          if (this.isOp(',')) this.next(); else break;
        }
        this.expectOp(')', 'to close the call');
        e = this.node('Call', t, { callee: e, args });
      } else if (this.isOp('.')) {
        const t = this.next();
        const k = this.peek();
        if (k.t !== 'IDENT' && k.t !== 'KW') this.err(`expected a member name after ".", found ${describe(k)}`);
        this.next();
        e = this.node('Member', t, { obj: e, name: k.v });
      } else if (this.isOp('[')) {
        const t = this.next();
        const index = this.parseExpr();
        this.expectOp(']', 'to close the index');
        e = this.node('Index', t, { obj: e, index });
      } else break;
    }
    return e;
  }

  parsePrimary() {
    const t = this.peek();
    switch (t.t) {
      case 'NUM': this.next(); return this.node('Num', t, { value: t.v });
      case 'INT': this.next(); return this.node('Int', t, { value: t.v });
      case 'STR': {
        this.next();
        const parts = t.parts.map(p => {
          if (typeof p === 'string') return p;
          const sub = new Parser(p, this.file);
          const e = sub.parseExpr();
          if (!sub.is('EOF')) sub.err(`unexpected ${describe(sub.peek())} in interpolation`);
          return e;
        });
        return this.node('Str', t, { parts });
      }
      case 'IDENT': this.next(); return this.node('Ident', t, { name: t.v });
      case 'KW':
        switch (t.v) {
          case 'true': case 'false': this.next(); return this.node('Bool', t, { value: t.v === 'true' });
          case 'null': this.next(); return this.node('Null', t, {});
          case 'state': this.next(); return this.node('State', t, {});
          case 'fn': {
            this.next();
            return this.node('Lambda', t, this.parseFnRest(t, null));
          }
          case 'whatif': {
            this.next();
            return this.node('Whatif', t, { body: this.parseBlock() });
          }
          case 'spawn': {
            this.next();
            const tpl = this.expectIdent('a template name after spawn');
            this.expectOp('(', `— spawn ${tpl.v}("an.id", …)`);
            const args = [];
            while (!this.isOp(')')) {
              args.push(this.parseExpr());
              if (this.isOp(',')) this.next(); else break;
            }
            this.expectOp(')', 'to close spawn');
            return this.node('Spawn', t, { template: tpl.v, args });
          }
        }
        break;
      case 'OP':
        if (t.v === '(') {
          this.next();
          const e = this.parseExpr();
          this.expectOp(')', 'to close the parenthesis');
          return e;
        }
        if (t.v === '[') {
          this.next();
          const items = [];
          while (!this.isOp(']')) {
            items.push(this.parseExpr());
            if (this.isOp(',')) this.next(); else break;
          }
          this.expectOp(']', 'to close the list');
          return this.node('List', t, { items });
        }
        if (t.v === '{') {
          this.next();
          this.skipNL();
          const entries = [];
          const seen = new Set();
          while (!this.isOp('}')) {
            const k = this.peek();
            let key;
            if (k.t === 'IDENT' || k.t === 'KW') key = k.v;
            else if (k.t === 'STR' && k.v !== null) key = k.v;
            else this.err(`expected a map key, found ${describe(k)}`);
            if (seen.has(key)) this.err(`map key "${key}" appears twice`, k);
            seen.add(key);
            this.next();
            this.expectOp(':', 'after the map key');
            this.skipNL();
            entries.push({ key, value: this.parseExpr() });
            this.skipNL();
            if (this.isOp(',')) { this.next(); this.skipNL(); } else break;
          }
          this.skipNL();
          this.expectOp('}', 'to close the map');
          return this.node('Map', t, { entries });
        }
        break;
    }
    this.err(`expected an expression, found ${describe(t)}`);
  }
}

function parse(src, file = '<input>') {
  const p = new Parser(lex(src, file), file);
  return p.parseProgram();
}

module.exports = { parse, Parser, TYPES };
