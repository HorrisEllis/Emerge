'use strict';
// emerge/lang/lexer.js — source → tokens.
// component_id: emerge.lang.lexer · spec: emerge/lang/emerge-lang.spec (modules.lexer, grammar.terminators)
//
// Token: { t, v, line, col }   t ∈ NUM STR IDENT KW OP NL EOF
// STR tokens carry `parts`: an array of plain strings and token arrays (one per {interpolation}).
// NEWLINE is a token (statements end at it) except inside ( ) and [ ], where it is whitespace.

const { EmergeSyntaxError } = require('./errors');

const KEYWORDS = new Set([
  'use', 'as', 'fn', 'compartment', 'component', 'template', 'spawn', 'despawn', 'wire', 'send', 'state', 'constraint', 'invariant', 'on', 'axiom', 'test',
  'let', 'var', 'if', 'else', 'while', 'for', 'in', 'break', 'skip', 'return',
  'emit', 'with', 'record', 'gap', 'promote', 'try', 'expect', 'whatif',
  'true', 'false', 'null', 'and', 'or', 'not',
  'contains', 'starts_with', 'ends_with', 'matches',
]);

// longest first
const OPS = ['->', '**', '..', '|>', '??', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=',
  '(', ')', '[', ']', '{', '}', ',', '.', ':', ';', '=', '<', '>', '+', '-', '*', '/', '%', '?'];

const ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '{': '{', '}': '}', '0': '\0' };

function lex(src, file = '<input>', startLine = 1, startCol = 1) {
  const toks = [];
  let i = 0, line = startLine, col = startCol;
  let depth = 0; // ( and [ nesting — newlines inside are whitespace
  const err = (msg, l = line, c = col) => { throw new EmergeSyntaxError(msg, file, l, c); };
  const push = (t, v, l, c, extra) => toks.push(Object.assign({ t, v, line: l, col: c }, extra));
  const adv = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') { line++; col = 1; } else col++;
      i++;
    }
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\n') {
      if (depth === 0 && toks.length && toks[toks.length - 1].t !== 'NL') push('NL', '\n', line, col);
      adv(); continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { adv(); continue; }

    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') adv(); continue; }
    if (ch === '/' && src[i + 1] === '*') {
      const l = line, c = col;
      adv(2);
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) adv();
      if (i >= src.length) err('unterminated /* comment', l, c);
      adv(2); continue;
    }

    if (/[0-9]/.test(ch)) {
      const l = line, c = col, s = i;
      while (/[0-9_]/.test(src[i] || '')) adv();
      // a '.' followed by a digit is a fraction; '..' is the range operator
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) { adv(); while (/[0-9_]/.test(src[i] || '')) adv(); }
      if ((src[i] === 'e' || src[i] === 'E') && /[0-9+-]/.test(src[i + 1] || '')) {
        adv(); if (src[i] === '+' || src[i] === '-') adv();
        if (!/[0-9]/.test(src[i] || '')) err('malformed exponent');
        while (/[0-9]/.test(src[i] || '')) adv();
      }
      const text = src.slice(s, i).replace(/_/g, '');
      if (/[A-Za-z_]/.test(src[i] || '')) err(`malformed number "${src.slice(s, i + 1)}"`, l, c);
      push('NUM', Number(text), l, c);
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const l = line, c = col, s = i;
      while (/[A-Za-z0-9_]/.test(src[i] || '')) adv();
      const word = src.slice(s, i);
      push(KEYWORDS.has(word) ? 'KW' : 'IDENT', word, l, c);
      continue;
    }

    if (ch === '"') {
      const l = line, c = col;
      adv();
      const parts = [];
      let buf = '';
      for (;;) {
        if (i >= src.length || src[i] === '\n') err('unterminated string', l, c);
        const d = src[i];
        if (d === '"') { adv(); break; }
        if (d === '\\') {
          const e = src[i + 1];
          if (!(e in ESCAPES)) err(`unknown escape \\${e === undefined ? '' : e}`);
          buf += ESCAPES[e]; adv(2); continue;
        }
        if (d === '{') {
          // interpolation: find the matching } (skipping nested strings), lex the inside as tokens
          if (buf) { parts.push(buf); buf = ''; }
          const el = line, ec = col + 1;
          adv();
          const s = i;
          let lvl = 1;
          while (i < src.length && lvl > 0) {
            const x = src[i];
            if (x === '\n') err('unterminated interpolation', el, ec - 1);
            if (x === '"') { // skip a nested string
              adv();
              while (i < src.length && src[i] !== '"') { if (src[i] === '\\') adv(); if (src[i] === '\n') err('unterminated string', el, ec); adv(); }
              adv(); continue;
            }
            if (x === '{') lvl++;
            else if (x === '}') { lvl--; if (lvl === 0) break; }
            adv();
          }
          if (lvl !== 0) err('unterminated interpolation', el, ec - 1);
          const inner = src.slice(s, i);
          if (!inner.trim()) err('empty interpolation {} — write \\{ for a literal brace', el, ec - 1);
          const sub = lex(inner, file, el, ec).filter(t => t.t !== 'NL');
          parts.push(sub);
          adv(); // the closing }
          continue;
        }
        if (d === '}') err('unmatched } in string — write \\} for a literal brace');
        buf += d; adv();
      }
      if (buf || !parts.length) parts.push(buf);
      const plain = parts.every(p => typeof p === 'string');
      push('STR', plain ? parts.join('') : null, l, c, { parts });
      continue;
    }

    const op = OPS.find(o => src.startsWith(o, i));
    if (op) {
      const l = line, c = col;
      if (op === '(' || op === '[') depth++;
      if (op === ')' || op === ']') depth = Math.max(0, depth - 1);
      push('OP', op, l, c);
      adv(op.length);
      continue;
    }

    err(`unexpected character "${ch}"`);
  }
  if (toks.length && toks[toks.length - 1].t !== 'NL') push('NL', '\n', line, col);
  push('EOF', null, line, col);
  return toks;
}

module.exports = { lex, KEYWORDS };
