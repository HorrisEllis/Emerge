'use strict';
// lib/boundary.js — the system holds only its own folder. James, 2026-10-17: "each system is soveriegn and self contained." ·
// "all system relevant files should stay with the system." Every relative require() in this system's own files is resolved;
// one that lands outside the folder is named, and the heartbeat reports it as a problem. Other systems are reached through
// their contract (routes, the CLI, handoffs), never by requiring their files. A module under modules/ is its own system and
// is checked by its own boundary; node_modules and data/ hold no code of the system's.
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', 'data', 'modules', 'input', 'processing', 'done', 'failed', 'output']);
const REQ = /(?:\b_?require|\bimport)\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g;

// codeOnly(src) — the source with template-literal text and comments blanked (spaces; newlines kept, so every offset is the real
// one). A code generator writes require('../x') into the text it emits; that text is not this file's code (EAS1a, 2026-10-31: found
// laying Emerge out). ${...} inside a template is code and stays. Returns null when a template, comment, string or regex never
// ends; the caller then scans the raw source, so nothing is hidden.
const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
function codeOnly(src) {
  const out = src.split('');
  const blank = (i) => { if (i < out.length && out[i] !== '\n') out[i] = ' '; };
  const holes = [];          // the brace depth at each ${ we are inside, innermost last
  let depth = 0, prev = '', i = 0;
  const n = src.length;
  const text = () => {       // template text from i: blanked up to the closing backtick or the next ${
    for (;;) {
      if (i >= n) return false;
      if (src[i] === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === '`') { i++; return true; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; holes.push(depth); return true; }
      blank(i++);
    }
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') blank(i++); continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return null; while (i < e + 2) blank(i++); continue; }
    if (c === '/' && (REGEX_AFTER.has(prev) || prev === 'kw')) {
      let cls = false; i++;
      while (i < n && (cls || src[i] !== '/')) {
        if (src[i] === '\n') return null;
        if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
        i++;
      }
      if (i >= n) return null;
      i++; prev = 'val'; continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) { if (src[i] === '\n') return null; if (src[i] === '\\') i++; i++; }
      if (i >= n) return null;
      i++; prev = 'val'; continue;
    }
    if (c === '`') { i++; if (!text()) return null; prev = 'val'; continue; }
    if (c === '}' && holes.length && holes[holes.length - 1] === depth) { holes.pop(); i++; if (!text()) return null; prev = 'val'; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (/[\w$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
      prev = /^(return|typeof|case|in|of|void|delete|throw|yield|await)$/.test(src.slice(i, j)) ? 'kw' : 'val';
      i = j; continue;
    }
    if (!/\s/.test(c)) prev = (c === ')' || c === ']') ? 'val' : c;
    i++;
  }
  return holes.length ? null : out.join('');
}

function _files(dir, out) {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) _files(p, out); else if (/\.(c|m)?js$/.test(e.name)) out.push(p);
  }
  return out;
}

/** outside(root) → [{ file, requires }] — every require that leaves this system's folder */
function outside(root) {
  const base = path.resolve(root);
  const out = [];
  for (const f of _files(base, [])) {
    let src = ''; try { src = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    const code = codeOnly(src);
    for (const m of (code === null ? src : code).matchAll(REQ)) {
      const to = path.resolve(path.dirname(f), m[1] || m[2]);
      if (to !== base && !to.startsWith(base + path.sep)) out.push({ file: path.relative(base, f).split(path.sep).join('/'), requires: m[1] || m[2] });
    }
  }
  return out;
}

module.exports = { outside, codeOnly };
