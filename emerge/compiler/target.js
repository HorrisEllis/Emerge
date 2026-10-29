'use strict';
/**
 * compiler/target.js — what a spec is built in, and what is already built.
 * UUID: spec-compiler-target-v1-0000-2026-1028-jamesbrooks-001
 * Version: 1.0.0
 *
 * §2026-10-28 — written so a spec can tell the compiler two things it could not before:
 *
 *   1. The target language. meta.language_stack: [emerge] (or meta.target_runtime: [emerge.exe]) makes T0/T1 emit .eg
 *      and .test.eg files and makes T2 ask for Emerge. Before this, every spec became TypeScript (package.json,
 *      tsconfig.json, src/modules/*.ts), which for cie-eg.spec contradicts its own section 0: no JavaScript in the
 *      finished system. Specs without the field are unchanged: TypeScript, as before.
 *
 *   2. Build state, per module: build: { state: built | partial | not_built, blocked_by: [decision ids], file, next }.
 *      built → DONE (never re-emitted, never sent to a model). blocked_by non-empty → DEFERRED (waits for the named
 *      decisions). Modules without a build field are decided by readiness alone, as before.
 *
 * Zero dependencies. Zero LLM calls (§CC-002).
 */

const path = require('path');

const EMERGE_NAMES = new Set(['emerge', 'eg', 'emerge.exe']);

function isEmergeTarget(meta = {}) {
  const list = [...(meta.language_stack ?? []), ...(meta.target_runtime ?? [])].map(s => String(s).toLowerCase());
  return list.some(s => EMERGE_NAMES.has(s));
}

function language(meta = {}) {
  return isEmergeTarget(meta) ? 'emerge' : 'typescript';
}

/** build state of a module as declared in the spec, or null when the spec says nothing. */
function buildOf(mod = {}) {
  const b = mod.build;
  if (!b || typeof b !== 'object') return null;
  const state = ['built', 'partial', 'not_built'].includes(b.state) ? b.state : 'not_built';
  const blocked_by = Array.isArray(b.blocked_by) ? b.blocked_by.map(String) : [];
  return { state, blocked_by, file: b.file ?? null, test: b.test ?? null, next: b.next ?? null, existing: b.existing ?? [] };
}

/**
 * buildDecision(mod) → null | { tier: 'DONE' | 'DEFERRED', reason }
 * null means: no build gate, decide by readiness.
 */
function buildDecision(mod = {}) {
  const b = buildOf(mod);
  if (!b) return null;
  if (b.state === 'built') return { tier: 'DONE', reason: 'already built' + (b.existing.length ? ' (' + b.existing.join(', ') + ')' : '') };
  if (b.blocked_by.length) return { tier: 'DEFERRED', reason: 'waits for decision ' + b.blocked_by.join(', '), blocked_by: b.blocked_by };
  return null;
}

/** Where a module's implementation and tests live, for the spec's target language. Paths are relative to outputDir. */
function modulePaths(mod = {}, meta = {}) {
  const name = mod.name ?? mod.id;
  if (isEmergeTarget(meta)) {
    const b = buildOf(mod) ?? {};
    const impl = b.file ?? path.join(name, name + '.eg');
    const test = b.test ?? impl.replace(/\.eg$/, '.test.eg');
    return { lang: 'emerge', impl, test };
  }
  return { lang: 'typescript', impl: path.join('src', 'modules', name, name + '.ts'), test: path.join('src', 'modules', name, name + '.test.ts') };
}

/** The Emerge syntax a model needs to write one module. Kept short: syntax, not the whole language guide. */
const EMERGE_CARD = [
  'Emerge (.eg) syntax:',
  'fn name(a: int, s: string, xs: list): map { ... }      fn name(x: num): bool = <expression>',
  'types: int (literal 42i, 0xFFi), num (literal 1.5, 0xFF), string, bool, bytes, list, map, any; a trailing ? makes it optional',
  'let x = 1   var y = 0   y = 2   y += 1      if c { } else if d { } else { }      while c { }      for i in 0..n { }  (end excluded)',
  'return v   break   skip      and or not      == != < <= > >=      + - * / %   (idiv(a, b) for int division)',
  'bits: & | ^ ~ << >>, shr_u, rotl, rotr      lists: [1, 2]  xs[i]  len(xs)  push(xs, v) returns a new list',
  'maps: { ok: true }  m.ok  has(m, "k")      text: len(s), str(x), int("12"), num("1.5")      no implicit int/num mixing',
  'raise("message") fails loudly      gap "message" pressure 0.7 type structural   records a gap on the ledger',
  'record "kind" { field: value }   writes a ledger entry      sha256(bytes), bytes(list), read_bytes(path), write_bytes(path, b)',
  'test "name" { expect cond, "message" }      no semicolons, no classes, no imports beyond: use "file.eg" as name',
].join('\n');

module.exports = { isEmergeTarget, language, buildOf, buildDecision, modulePaths, EMERGE_CARD, MODULE_ID: 'spec-compiler-target', VERSION: '1.0.0' };
