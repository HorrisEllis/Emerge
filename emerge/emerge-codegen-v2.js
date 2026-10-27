'use strict';
/**
 * emerge-codegen-v2.js — Emergence .eg → SISO-wired CommonJS module
 * UUID: emerge-codegen-v2-0-0
 *
 * v2 fixes over v1:
 *   - jaa.table.find(...) pattern correctly emitted as JS boolean expression
 *   - if/for/while blocks infer and emit closing braces from statement structure
 *   - uuid field value "uid" → _uid() in insert/update payloads
 *   - agent-ollama "on" handler body correctly scoped
 *
 * §1.1 §1.2 §2.1
 */

const { randomUUID } = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const ind   = (n, s) => s.split('\n').map(l => l.trim() ? '  '.repeat(n) + l : '').join('\n');
const slug  = s => (s || '').replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^_+/, '') || '_anon';
const jsStr = s => JSON.stringify(String(s));

function valExpr(v) {
  if (!v || v === 'null') return 'null';
  if (v === '"' || v === "'")  return '""'; // lone quote token → empty string
  if (v === '*') return "'*'"; // wildcard → string
  // listeners[*] → listeners['*']
  v = v.replace(/\[\*\]/g, "['*']");
  if (v === 'now')               return 'Date.now()';
  if (v === 'uid' || v === 'uuid') return '_uid()';
  if (v === 'true'  || v === 'false') return v;
  if (/^\d+(\.\d+)?$/.test(v))  return v;
  if (v.startsWith('"') || v.startsWith("'")) return v;
  const ta = v.match(/^now\+(\d+)$/);
  if (ta) return `Date.now() + ${ta[1]}`;
  if (/\(/.test(v)) return v.replace(/\bnow\b/g, 'Date.now()');
  // Contains a hyphen (like gap-finder) → quote it for JS string safety
  if (/-/.test(v) && !/[+*/(]/.test(v)) return JSON.stringify(v);
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// KV PAIR PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseKV(tokens) {
  // Extract k=v pairs from a flat token sequence.
  // Handles: k = v    k = "a" + b + "c"
  const pairs = [];
  const toks  = tokens.filter(t => t !== '{' && t !== '}' && t !== '[' && t !== ']');
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (toks[i + 1] === '=') {
      const k = t;
      let v = toks[i + 2] || 'null';
      let j = i + 3;
      // If value is an unclosed string literal, absorb tokens until we find the closing quote
      if ((v.startsWith('"') && !v.endsWith('"')) || (v.startsWith("'") && !v.endsWith("'"))) {
        const q = v[0];
        while (j < toks.length && !toks[j-1].endsWith(q)) {
          v += ' ' + toks[j];
          j++;
        }
        // Ensure it's properly quoted
        if (!v.endsWith(q)) v += q;
      }
      // Absorb concatenation: "a" + b + "c"
      while (j < toks.length && toks[j] === '+') {
        let nextV = toks[j + 1] || '';
        if ((nextV.startsWith('"') && !nextV.endsWith('"')) || (nextV.startsWith("'") && !nextV.endsWith("'"))) {
          const q = nextV[0];
          let k2 = j + 2;
          while (k2 < toks.length && !toks[k2-1].endsWith(q)) {
            nextV += ' ' + toks[k2];
            k2++;
          }
          if (!nextV.endsWith(q)) nextV += q;
          v += ' + ' + nextV;
          j = k2;
        } else {
          v += ' + ' + nextV;
          j += 2;
        }
      }
      pairs.push({ k, v });
      i = j;
    } else {
      i++;
    }
  }
  return pairs;
}

// ─────────────────────────────────────────────────────────────────────────────
// JAA TRANSLATORS
// ─────────────────────────────────────────────────────────────────────────────

function jaaInsert(tokens) {
  const table = (tokens[0] || 'unknown').replace(/^jaa\./, '');
  const rest  = tokens.slice(1);
  const pairs = parseKV(rest);

  const hasUuid = pairs.some(p => p.k === 'uuid' || p.k === 'id');
  const hasTs   = pairs.some(p => p.k === 'ts');

  const fields = pairs
    .map(({ k, v }) => `    ${slug(k)}: ${buildConcatExpr(v)}`)
    .join(',\n');

  const extras = [
    !hasUuid ? `    uuid: _uid()` : '',
    !hasTs   ? `    ts: Date.now()` : '',
  ].filter(Boolean).join(',\n');

  return `await _jaa.append(${jsStr(table)}, {\n${[fields, extras].filter(Boolean).join(',\n')}\n  });`;
}

function jaaUpdate(tokens) {
  const table   = (tokens[0] || 'unknown').replace(/^jaa\./, '');
  const rest    = tokens.slice(1);
  const setIdx  = rest.indexOf('set');
  const whereIdx = rest.indexOf('where');

  const setPairs = setIdx !== -1
    ? parseKV(rest.slice(setIdx + 1, whereIdx !== -1 ? whereIdx : undefined))
    : [];
  const setPatch = [...setPairs.map(({k,v}) => `${slug(k)}: ${buildConcatExpr(v)}`), `updatedAt: Date.now()`].join(', ');

  const wherePairs = whereIdx !== -1 ? parseKV(rest.slice(whereIdx + 1)) : [];
  const pred = wherePairs.length
    ? `r => ${wherePairs.map(({k,v}) => `r.${slug(k)} === ${buildConcatExpr(v)}`).join(' && ')}`
    : `() => true`;

  return `await _jaa.update(${jsStr(table)}, ${pred}, { ${setPatch} });`;
}

function jaaQuery(tokens) {
  const table    = (tokens[0] || 'unknown').replace(/^jaa\./, '');
  const rest     = tokens.slice(1);
  const whereIdx = rest.indexOf('where');
  const limitIdx = rest.indexOf('limit');

  let pred = '() => true';
  if (whereIdx !== -1) {
    const wToks = rest.slice(whereIdx + 1, limitIdx !== -1 ? limitIdx : undefined);
    pred = buildWherePred(wToks);
  }
  const limit = limitIdx !== -1 ? (parseInt(rest[limitIdx + 1], 10) || 10) : 100;
  return `(await _jaa.query(${jsStr(table)}, ${pred})).slice(0, ${limit})`;
}

function buildWherePred(tokens) {
  const src = tokens
    .filter(t => t !== '{')
    .join(' ')
    .replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\b\s*/g, '!')
    .replace(/\bnow\b/g, 'Date.now()')
    .replace(/\belapsed\b\s*>\s*(\w+)/g, '(Date.now() - r.startedAt) > $1');

  const m = src.match(/^([\w.]+)\s*(===|!==|==|!=|>=?|<=?)\s*(\S+)/);
  if (m) {
    const [, k, op, v] = m;
    const jsOp = op === '==' ? '===' : op === '!=' ? '!==' : op;
    return `r => r.${k.replace(/\./g, '?.')} ${jsOp} ${valExpr(v)}`;
  }
  return `() => true /* where: ${src} */`;
}

// Build a JS expression that may contain + concatenation
function buildConcatExpr(src) {
  if (!src) return 'undefined';
  if (!src.includes(' + ')) return valExpr(src);
  // Has concatenation — split carefully
  const parts = src.split(' + ').map(p => p.trim());
  return parts.map(p => valExpr(p)).join(' + ');
}

// Fix: in parseKV, detect broken string literals (value starts with " but doesn't end with ")
// and absorb next tokens until closing quote

// ─────────────────────────────────────────────────────────────────────────────
// jaa.table.find(key = val key2 = val2) PATTERN
// In the flat token stream this appears as:
//   "jaa.table.find(key"  "="  "val"  "key2"  "="  "val2)"
// We need to detect this and emit a proper JS boolean expression.
// ─────────────────────────────────────────────────────────────────────────────

function isJaaFind(tokens) {
  return tokens[0] && tokens[0].match(/^jaa\.\w+\.find\(/);
}

function buildJaaFind(tokens) {
  // tokens[0] = "jaa.table.find(firstKey"  tokens ends with "lastVal)"
  const raw  = tokens.join(' ');
  // Extract table
  const tableM = raw.match(/^jaa\.(\w+)\.find\(/);
  const table  = tableM ? tableM[1] : 'unknown';

  // Extract key=val pairs from the find args
  // Strip the jaa.table.find( prefix and trailing )
  const argsRaw = raw
    .replace(/^jaa\.\w+\.find\(/, '')
    .replace(/\)\s*$/, '');

  // The args look like: path = "modules/" + mod.name type = stale_module
  const argToks = argsRaw.split(/\s+/);
  const pairs   = parseKV(argToks);

  const pred = pairs.length
    ? pairs.map(({k,v}) => `r.${slug(k)} === ${buildConcatExpr(v)}`).join(' && ')
    : 'true';

  return `_jaa?.querySync?.(${jsStr(table)}, r => ${pred})?.length > 0`;
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK-DEPTH TRACKER
// Since the kernel strips all braces, we track logical nesting depth:
// - `for`, `while`, `if` open a block (depth++)
// - `record` at depth > 0 + next token is a new block-opener → close previous blocks
// We use a simple heuristic: after `record`, if next statement opens a new block
// at the SAME or OUTER level, close with }.
// More reliably: track that for/while/if each need one closing }.
// ─────────────────────────────────────────────────────────────────────────────

// BLOCK_OPENERS open a new scope that needs a closing }
const BLOCK_OPENERS = new Set(['for', 'while', 'if']);

// Split flat token array into logical statements (each starting with a known head)
const STMT_HEADS = new Set([
  'record','emit','insert','update','query','output','input',
  'for','while','if','break','skip','gap','wait',
  'stream','GET','POST','PATCH','DELETE','PUT',
  'on','route','component','interval','state','invariant','jaa',
  'reads','writes','sources',
]);

function splitStatements(tokens) {
  const stmts = [];
  let cur = [];
  for (const t of tokens.filter(t => t !== '{' && t !== '}')) {
    if (STMT_HEADS.has(t) && cur.length) {
      stmts.push(cur);
      cur = [t];
    } else {
      cur.push(t);
    }
  }
  if (cur.length) stmts.push(cur);
  return stmts;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATEMENT TRANSLATOR
// ─────────────────────────────────────────────────────────────────────────────

function translateStmt(toks, ctx) {
  if (!toks?.length) return null;
  const head = toks[0];
  const rest  = toks.slice(1);

  switch (head) {

    case 'record':
      return `await _record(${jsStr(ctx.scope || 'unknown')}, {});`;

    case 'emit': {
      const evType = (rest[0] || '').replace(/"/g, '');
      const pairs  = parseKV(rest.slice(1));
      const payload = pairs.length
        ? `{ ${pairs.map(({k,v}) => `${slug(k)}: ${buildConcatExpr(v)}`).join(', ')} }`
        : '{}';
      return `_stream.emit(new _Event(${jsStr(evType)}, ${payload}));`;
    }

    case 'insert':
      return jaaInsert(rest);

    case 'update':
      return jaaUpdate(rest);

    case 'query': {
      const varName = ctx.queryVar || '_rows';
      return `const ${varName} = ${jaaQuery(rest)};`;
    }

    case 'output': {
      const clean = rest.filter(t => !['json','sse','stream','live_tail','counts','interaction_contract','record'].includes(t));
      if (!clean.length) return `// output stub`;
      const pairs = parseKV(clean);
      if (pairs.length) {
        return `_out = { ${pairs.map(({k,v}) => `${slug(k)}: ${buildConcatExpr(v)}`).join(', ')} };`;
      }
      return `_out = ${valExpr(clean[0])};`;
    }

    case 'input': {
      const varName = slug(rest[0] || 'input');
      return `const ${varName} = event?.data ?? {};`;
    }

    case 'gap': {
      const name     = (rest[0] || 'unknown').replace(/"/g, '');
      const pairs    = parseKV(rest.slice(1));
      const pressure = pairs.find(p => p.k === 'pressure')?.v || '0.8';
      return [
        `await _jaa?.append('gaps', { uuid: _uid(), path: ${jsStr(name)}, type: 'gap',`,
        `  pressure: ${pressure}, status: 'open', source: ${jsStr(ctx.moduleId || 'unknown')}, ts: Date.now() });`,
        `_stream.emit(new _Event('gap.opened', { name: ${jsStr(name)}, pressure: ${pressure} }));`,
      ].join('\n');
    }

    case 'wait': {
      const ms = parseInt(rest[0], 10) || 1000;
      return `await new Promise(r => setTimeout(r, ${ms}));`;
    }

    case 'break':  return 'break;';
    case 'skip':   return 'continue;';

    case 'if': {
      // Detect: if not jaa.table.find(...)
      if (rest[0] === 'not' && isJaaFind(rest.slice(1))) {
        const expr = buildJaaFind(rest.slice(1));
        return `if (!(${expr})) {`;
      }
      // Detect: if get again (optimistic re-read for locking)
      if (rest[0] === 'get' && rest[1] === 'again') {
        const field = rest[2] || 'claimedBy';
        const op    = rest[3] || '!==';
        const val   = rest[4] || 'MODULE_ID';
        return `if (true /* re-read: ${field} ${op} ${val} — implement optimistic lock */) {`;
      }
      const condToks = rest.filter(t => t !== '{');
      return `if (${buildCondition(condToks)}) {`;
    }

    case 'for': {
      if (rest[0] === 'each') {
        const itemVar  = slug(rest[1] || 'item');
        const inIdx    = rest.indexOf('in');
        const whereIdx = rest.indexOf('where');
        const srcTok   = inIdx !== -1 && rest[inIdx + 1] ? rest[inIdx + 1] : 'items';
        let source;
        if (srcTok.startsWith('jaa.')) {
          source = jaaQuery([srcTok, ...(whereIdx !== -1 ? ['where', ...rest.slice(whereIdx + 1)] : [])]);
        } else {
          source = valExpr(srcTok);
        }
        return `for (const ${itemVar} of (${source} || [])) {`;
      }
      return `/* ⚠ for: unrecognised */`;
    }

    case 'while': {
      const condToks = rest.filter(t => t !== '{');
      // Emergence shorthand: "while X dispatch Y" → complete inline loop (no depth tracking)
      const dispatchIdx = condToks.indexOf('dispatch');
      if (dispatchIdx !== -1) {
        const cond = buildCondition(condToks.slice(0, dispatchIdx));
        const arg  = condToks[dispatchIdx + 1] || 'item';
        // Return as object-wrapped so BLOCK_OPENERS doesn't count it (head is 'while' but loop is complete)
        return `{ // while-dispatch
  const _wdItem = ${valExpr(arg)};
  let _wd = 0;
  while (${cond} && _wd++ < 10000) {
    _stream.emit(new _Event('dispatch', { item: _wdItem }));
  }
}`;
      }
      return `while (${buildCondition(condToks)}) {`;
    }

    case 'stream':
    case 'GET': case 'POST': case 'PATCH': case 'DELETE': case 'PUT': {
      const method = head === 'stream' ? (rest[0] || 'POST') : head;
      const url    = head === 'stream' ? (rest[1] || '') : (rest[0] || '');
      return `// HTTP ${method} ${url}\n// const _resp = await _http?.(${jsStr(method)}, ${jsStr(url)}, {});`;
    }

    case 'sources': {
      // sources = group_by_source(jaa.failures.tail(50))
      if (rest[0] === '=') {
        return `const sources = ${valExpr(rest[1] || 'null')};`;
      }
      return null;
    }

    default: {
      if (toks[1] === '=') {
        const lhs = slug(head);
        const rhs = toks.slice(2).join(' ');
        return `let ${lhs} = ${buildConcatExpr(rhs)};`;
      }
      if (toks[1] === '+=') {
        return `${slug(head)} += ${buildConcatExpr(toks.slice(2).join(' '))};`;
      }
      // Skip pure declaration tokens
      if (['id','uuid','intent','reads','writes','url','version',
           'stale_ms','stuck_ms','recurring_n','port','bind','number','protocol',
           'phases','tension_engine','snr_weights','prescriptions','modules'].includes(head)) {
        return null;
      }
      return `/* ⚠ GAP: ${toks.join(' ')} */`;
    }
  }
}

function buildCondition(tokens) {
  // Strip trailing method calls that leaked out of the condition (e.g. sub.fn(event))
  const condToks = [];
  for (const t of tokens) {
    if (/^\w[\w.]*\(/.test(t) && condToks.length > 0) break; // method call after condition → stop
    condToks.push(t);
  }
  return condToks
    .join(' ')
    .replace(/\bnot\s+/g, '!')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .replace(/\btimeout\b/g, '_timedOut')
    .replace(/\bnow\b/g, 'Date.now()')
    .replace(/==[^=]/g, m => '===' + m.slice(2))
    .replace(/!=[^=]/g, m => '!==' + m.slice(2))
    .replace(/\s*===\s*\*\*/g, " === '**'")
    .replace(/\s*!==\s*\*\*/g, " !== '**'")
    .replace(/(\w+)\s+exists\b/g, '/* exists: $1 */ $1 !== undefined && $1 !== null')
    || 'true';
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK TRANSLATOR — with automatic closing brace injection
// ─────────────────────────────────────────────────────────────────────────────

function translateBlock(tokens, ctx) {
  const SKIP_DECL = new Set(['id','uuid','intent','reads','writes','url','version',
    'stale_ms','stuck_ms','recurring_n','port','bind','number','protocol',
    'phases','tension_engine','snr_weights','prescriptions','modules',
    'component','interval','state','invariant','jaa']);

  const clean  = tokens.filter(t => t !== '{' && t !== '}');
  const stmts  = splitStatements(clean);
  const lines  = [];
  let depth    = 0;  // tracks open blocks needing closing }

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    const head = stmt[0];

    // Skip declarations
    if (SKIP_DECL.has(head) && stmt[1] === '=') continue;
    if (SKIP_DECL.has(head) && stmt.length === 1) continue;

    // Before emitting, close any open blocks if we're transitioning from
    // a deeper scope back to a peer statement.
    // Heuristic: 'record' at depth > 0 followed by a for/while/if at same peer
    // level → close the current block after record.
    // Simpler: track depth per for/while/if and close after the last statement
    // within that logical group.
    // We use: after 'record', peek ahead. If next stmt is 'for'/'while'/'if',
    // we're likely at the end of the current if/for block → close.
    if (head === 'record' && depth > 0) {
      const nextHead = stmts[i + 1]?.[0];
      if (nextHead === 'for' || nextHead === 'while' || nextHead === 'if' || !nextHead) {
        const js = translateStmt(stmt, ctx);
        if (js) lines.push(js);
        // Close open blocks
        while (depth > 0) {
          lines.push('}');
          depth--;
        }
        continue;
      }
    }

    const js = translateStmt(stmt, ctx);
    if (!js) continue;

    lines.push(js);

    // Track depth
    if (BLOCK_OPENERS.has(head) && !js.trimEnd().endsWith('}')) {
      depth++;
    }
  }

  // Close any remaining open blocks
  while (depth > 0) {
    lines.push('}');
    depth--;
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// BODY STRUCTURE PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseBody(tokens, moduleId) {
  const result = {
    onHandlers: [],
    routes:     [],
    intervals:  [],
    state:      null,
    jaaTables:  [],
  };

  // Find component blocks
  const components = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] === 'component') {
      const name     = (tokens[i+1] || '').replace(/"/g, '');
      const bodyStart = i + 2;
      let bodyEnd    = tokens.length;
      for (let j = bodyStart; j < tokens.length; j++) {
        if (tokens[j] === 'component') { bodyEnd = j; break; }
      }
      components.push({ name, body: tokens.slice(bodyStart, bodyEnd) });
      i = bodyEnd;
    } else {
      i++;
    }
  }
  if (!components.length) components.push({ name: 'main', body: tokens });

  for (const { name: compName, body: compBody } of components) {
    // Extract interval
    let intervalMs = null;
    for (let j = 0; j < compBody.length; j++) {
      if (compBody[j] === 'interval' && compBody[j+1] === '=') {
        intervalMs = parseInt(compBody[j+2], 10) || null;
        break;
      }
    }

    // Extract state block
    const stateIdx = compBody.indexOf('state');
    if (stateIdx !== -1) {
      const statePairs = extractStatePairs(compBody, stateIdx + 1);
      result.state = genStateObj(statePairs);
    }

    // Walk component body for on/route handlers and polling body
    const pollingBody = [];
    let j = 0;
    while (j < compBody.length) {
      const t = compBody[j];

      if (t === 'on') {
        const handlerName = compBody[j+1] || 'unknown';
        const bodyStart   = j + 2;
        let   bodyEnd     = compBody.length;
        for (let k = bodyStart; k < compBody.length; k++) {
          if (compBody[k] === 'on' || compBody[k] === 'route') { bodyEnd = k; break; }
        }
        result.onHandlers.push({ name: handlerName, body: compBody.slice(bodyStart, bodyEnd) });
        j = bodyEnd;
        continue;
      }

      if (t === 'route') {
        const method    = compBody[j+1] || 'GET';
        const routePath = compBody[j+2] || '/';
        const bodyStart = j + 3;
        let   bodyEnd   = compBody.length;
        for (let k = bodyStart; k < compBody.length; k++) {
          if (compBody[k] === 'route' || compBody[k] === 'on') { bodyEnd = k; break; }
        }
        result.routes.push({ method, path: routePath, body: compBody.slice(bodyStart, bodyEnd) });
        j = bodyEnd;
        continue;
      }

      // Skip known declarations
      if (['interval','state','invariant','id','uuid','intent','version'].includes(t) && compBody[j+1] === '=') {
        j += 3;
        continue;
      }
      if (['interval','state'].includes(t)) { j++; continue; }

      pollingBody.push(t);
      j++;
    }

    if (intervalMs && pollingBody.length) {
      result.intervals.push({ ms: intervalMs, body: pollingBody, compName });
    }
  }

  // Extract top-level jaa tables
  const jaaIdx = tokens.indexOf('jaa');
  if (jaaIdx !== -1) {
    let tableIdx = tokens.indexOf('tables', jaaIdx);
    if (tableIdx !== -1) {
      let ti = tableIdx + 2;
      while (ti < tokens.length && !['component','on','route'].includes(tokens[ti])) {
        const v = tokens[ti];
        if (v !== '{' && v !== '}' && v !== '=' && v !== 'tables' && v !== 'backend' && v !== 'jsonl') {
          result.jaaTables.push(v);
        }
        ti++;
      }
    }
  }

  return result;
}

function extractStatePairs(tokens, startIdx) {
  const pairs = [];
  let i = startIdx;
  // skip until {
  while (i < tokens.length && tokens[i] !== '{') i++;
  i++; // skip {
  while (i < tokens.length && tokens[i] !== '}') {
    if (tokens[i+1] === '=') {
      pairs.push({ k: tokens[i], v: tokens[i+2] || 'null' });
      i += 3;
    } else i++;
  }
  return pairs;
}

function genStateObj(pairs) {
  if (!pairs.length) return null;
  const entries = pairs.map(({k, v}) => {
    const rm = v?.match(/^Ring\((\d+)\)$/);
    if (rm) return `  ${slug(k)}: { _buf: [], _max: ${rm[1]}, push(x) { this._buf.push(x); if (this._buf.length > this._max) this._buf.shift(); }, last(n) { return this._buf.slice(-n); }, all() { return [...this._buf]; } }`;
    if (v === 'Map') return `  ${slug(k)}: new Map()`;
    if (v === '[]')  return `  ${slug(k)}: []`;
    return `  ${slug(k)}: ${valExpr(v)}`;
  });
  return `const _state = {\n${entries.join(',\n')}\n};`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CODE GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

function genOnHandler(name, bodyTokens, moduleId) {
  const ctx   = { scope: name, moduleId, queryVar: 'pending' };
  const lines = translateBlock(bodyTokens, ctx);
  const body  = lines.join('\n') || '// no-op';
  return `_stream.register(new _Gate(${jsStr(name)}, async (event, _s) => {
    try {
${ind(3, body)}
    } catch (_err) {
      _stream.emit(new _Event('error', { handler: ${jsStr(name)}, error: _err.message }));
      await _record(${jsStr(name + '.error')}, { error: _err.message });
    }
  }));`;
}

function genRoute(method, routePath, bodyTokens, moduleId) {
  const ctx   = { scope: `${method} ${routePath}`, moduleId, queryVar: '_rows' };
  const lines = translateBlock(bodyTokens, ctx);
  const body  = lines.join('\n') || '// no-op';
  return `_routes.push({ method: ${jsStr(method.toLowerCase())}, path: ${jsStr(routePath)},
    handler: async (req, res, next) => {
      let _out;
      try {
${ind(4, body)}
        if (_out !== undefined) res.json({ ok: true, data: _out });
        else res.json({ ok: true });
      } catch (_err) {
        _stream.emit(new _Event('error', { route: ${jsStr(routePath)}, error: _err.message }));
        next(_err);
      }
    }
  });`;
}

function genInterval(ms, bodyTokens, compName, moduleId) {
  const ctx   = { scope: `${compName}.poll`, moduleId, queryVar: 'pending' };
  const lines = translateBlock(bodyTokens, ctx);
  const body  = lines.join('\n') || '// no-op';
  return `_timers.push(setInterval(async () => {
    try {
${ind(3, body)}
    } catch (_err) {
      _stream.emit(new _Event('error', { component: ${jsStr(compName)}, error: _err.message }));
      await _record(${jsStr(compName + '.poll.error')}, { error: _err.message });
    }
  }, ${ms}));`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARTMENT ASSEMBLER
// ─────────────────────────────────────────────────────────────────────────────

function generateCompartment(comp) {
  const name   = comp.name || comp.fields?.id || 'unnamed';
  const id     = comp.fields?.id     || name;
  const uuid   = comp.fields?.uuid   || `${slug(name)}-generated`;
  const intent = comp.fields?.intent || '';
  const port   = comp.fields?.port   || comp.fields?.number || null;
  const modId  = slug(name);

  const struct = parseBody(comp.body || [], modId);
  const out    = [];

  out.push(`'use strict';`);
  out.push(`/**`);
  out.push(` * ${name}.js — generated by emerge-codegen v2.0.0`);
  out.push(` * UUID:   ${uuid}`);
  out.push(` * Intent: ${intent}`);
  out.push(` * §1.1 §1.2 §2.1`);
  out.push(` */`);
  out.push(``);
  out.push(`const { Event: _Event, Gate: _Gate, Stream: _Stream } = require('../siso');`);
  out.push(`const { randomUUID: _uid } = require('crypto');`);
  out.push(``);
  out.push(`const MODULE_ID     = ${jsStr(id)};`);
  out.push(`const MODULE_UUID   = ${jsStr(uuid)};`);
  out.push(`const MODULE_INTENT = ${jsStr(intent)};`);
  if (port) out.push(`const MODULE_PORT   = ${port};`);
  out.push(``);

  if (struct.state) { out.push(`// ── State ─────────────────────────────────────────`); out.push(struct.state); out.push(``); }
  if (struct.jaaTables.length) { out.push(`const JAA_TABLES = ${JSON.stringify(struct.jaaTables)};`); out.push(``); }

  out.push(`let _bus = null, _stream = null, _jaa = null, _running = false;`);
  out.push(`const _timers = [], _routes = [];`);
  out.push(``);
  out.push(`async function _record(type, payload = {}) {`);
  out.push(`  if (!_jaa) return;`);
  out.push(`  try { await _jaa.append('event_log', { uuid: _uid(), type: \`${modId}.\${type}\`, source: MODULE_ID, payload, ts: Date.now() }); }`);
  out.push(`  catch (_e) { /* §1.2 */ }`);
  out.push(`}`);
  out.push(``);
  out.push(`async function init(cfg = {}) {`);
  out.push(`  if (_running) return { ok: true, module: MODULE_ID };`);
  out.push(`  _bus    = cfg.bus    || null;`);
  out.push(`  _jaa    = cfg.jaa    || cfg.store || null;`);
  out.push(`  _stream = _bus ? _bus.stream(MODULE_ID) : new _Stream();`);
  out.push(``);

  for (const { name: hn, body } of struct.onHandlers) {
    out.push(`  ` + genOnHandler(hn, body, modId).split('\n').join('\n  '));
    out.push(``);
  }

  if (struct.routes.length) {
    for (const { method, path: rp, body } of struct.routes) {
      out.push(`  ` + genRoute(method, rp, body, modId).split('\n').join('\n  '));
      out.push(``);
    }
    out.push(`  if (cfg.app) { for (const r of _routes) cfg.app[r.method](r.path, r.handler); }`);
    out.push(``);
  }

  for (const { ms, body, compName } of struct.intervals) {
    out.push(`  ` + genInterval(ms, body, compName, modId).split('\n').join('\n  '));
    out.push(``);
  }

  out.push(`  _running = true;`);
  out.push(`  _stream.emit(new _Event(\`\${MODULE_ID}.booted\`, { uuid: MODULE_UUID, intent: MODULE_INTENT }));`);
  out.push(`  await _record('boot', { uuid: MODULE_UUID });`);
  out.push(`  return { ok: true, module: MODULE_ID };`);
  out.push(`}`);
  out.push(``);
  out.push(`async function stop() {`);
  out.push(`  for (const t of _timers) clearInterval(t);`);
  out.push(`  _timers.length = 0;`);
  out.push(`  _running = false;`);
  out.push(`  _stream?.emit(new _Event(\`\${MODULE_ID}.stopped\`, {}));`);
  out.push(`  await _record('stop', {});`);
  out.push(`}`);
  out.push(``);
  out.push(`async function handle(eventType, data = {}) {`);
  out.push(`  if (!_stream) throw new Error(\`${modId}: call init() first\`);`);
  out.push(`  _stream.emit(new _Event(eventType, data));`);
  out.push(`}`);
  out.push(``);
  out.push(`function health() { return { ok: _running, module: MODULE_ID, uuid: MODULE_UUID, ts: Date.now() }; }`);
  out.push(``);
  out.push(`module.exports = {`);
  out.push(`  init, stop, handle, health,`);
  out.push(`  get stream() { return _stream; },`);
  out.push(`  MODULE_ID, MODULE_UUID,`);
  if (struct.jaaTables.length) out.push(`  JAA_TABLES,`);
  out.push(`};`);

  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE GENERATOR + CLI  (same as v1)
// ─────────────────────────────────────────────────────────────────────────────

function generateFile(ir, sourceName) {
  if (!ir.compartments.length) return [{ filename: sourceName.replace(/\.eg$/, '.js'), content: `'use strict';\nmodule.exports = {};\n` }];
  const outputs = ir.compartments.map(comp => {
    const name = comp.name || comp.fields?.id || 'unnamed';
    return { filename: `${slug(name)}.js`, content: generateCompartment(comp) };
  });
  if (outputs.length > 1) {
    const idx = outputs.map(o => `const ${o.filename.replace('.js','')} = require('./${o.filename.replace('.js','')}');\n`).join('')
      + `\nmodule.exports = {\n${outputs.map(o => `  ${o.filename.replace('.js','')},`).join('\n')}\n};\n`;
    outputs.push({ filename: 'index.js', content: idx });
  }
  return outputs;
}

module.exports = { generateFile, generateCompartment };

if (require.main === module) {
  const fs = require('fs'), path = require('path');
  const kp = [path.join(__dirname,'emerge-kernel.js'), path.join(__dirname, '..', '..', 'emerge-kernel.js')].find(p=>fs.existsSync(p));
  if (!kp) { console.error('[codegen] emerge-kernel.js not found'); process.exit(1); }
  const kernel = require(kp);
  const sp = [path.join(__dirname,'emerge.spec'), path.join(path.dirname(kp),'emerge.spec')].find(p=>fs.existsSync(p));
  if (sp) kernel.loadSpec(sp);

  const [,,cmd,arg2,arg3] = process.argv;
  if (!cmd) { console.log('Usage: node emerge-codegen-v2.js <file.eg> [outDir]\n       node emerge-codegen-v2.js --watch <dir> [outDir]'); process.exit(0); }

  if (cmd === '--watch') {
    const wd = arg2||'.', od = arg3||path.join(wd,'compiled');
    fs.mkdirSync(od,{recursive:true});
    console.log(`[codegen] watching ${wd} → ${od}`);
    walkEg(wd).forEach(fp=>compileFile(kernel,fp,od));
    fs.watch(wd,{recursive:true},(_,fn)=>{ if(fn?.endsWith('.eg')){ const fp=path.join(wd,fn); if(fs.existsSync(fp)) setTimeout(()=>compileFile(kernel,fp,od),50); }});
    return;
  }
  compileFile(kernel, cmd, arg2||path.dirname(cmd));
}

function compileFile(kernel, inputFile, outputDir) {
  const fs=require('fs'),path=require('path');
  const src=fs.readFileSync(inputFile,'utf8'), name=path.basename(inputFile);
  const {ir,valid,gaps,snr}=kernel.compile(src,name);
  const gapStr=gaps.length?` ⚠ ${gaps.length} gap(s)`:'';
  console.log(`[codegen] ${name} — SNR ${(snr*100).toFixed(1)}% valid=${valid}${gapStr}`);
  gaps.forEach(g=>console.warn(`  [${g.type}] ${g.message}`));
  fs.mkdirSync(outputDir,{recursive:true});
  generateFile(ir,name).forEach(({filename,content})=>{
    const dest=path.join(outputDir,filename);
    fs.writeFileSync(dest,content,'utf8');
    console.log(`[codegen] → ${dest}`);
  });
}

function walkEg(dir){
  const fs=require('fs'),path=require('path'),out=[];
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,e.name);
    if(e.isDirectory()) out.push(...walkEg(full));
    else if(e.name.endsWith('.eg')) out.push(full);
  }
  return out;
}
