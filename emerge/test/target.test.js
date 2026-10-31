'use strict';
/**
 * target.test.js — §2026-10-28 compiler changes for the Nexus handoff of cie-eg.spec
 *
 *   1. kg-builder scores schemas before modules (no false BLOCKED from schema_refs)
 *   2. a schema can confirm it is complete (complete: true, every field typed)
 *   3. the tier contract reads the build plan: built → DONE, blocked_by → DEFERRED
 *   4. an Emerge-target spec emits .eg and .test.eg only; every stub passes the Emerge checker
 *   5. generated files may be regenerated; files without the mark are never overwritten
 *   6. exports named like builtins or keywords are not emitted as stubs (and say why)
 *   7. a spec without language or build fields behaves as before (TypeScript)
 *   8. T2 prompts and output paths follow the target language; hand-written files get a proposal beside them
 *   9. compile() returns parsedSpec, so T2 sees the spec
 *  10. cie-eg.spec itself: the expected run / defer / skip buckets
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { build } = require('../compiler/kg-builder');
const { decideTier, decideAll } = require('../compiler/tier-contract');
const { isEmergeTarget, buildDecision, modulePaths } = require('../compiler/target');
const { emitT0, emitT1, normalizeSpec } = require('../compiler/emit');
const { GENERATED_MARK } = require('../compiler/emit-emerge');
const t2 = require('../compiler/t2-gate');
const lang = require('../lang');

let p = 0, f = 0;
const jobs = [];
function test(label, fn) {
  const run = async () => {
    try { await fn(); p++; process.stdout.write('.'); }
    catch (e) { f++; console.log('\nFAIL [' + label + ']: ' + e.message); }
  };
  jobs.push(run);
}
function assert(v, msg) { if (!v) throw new Error(msg ?? 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(msg ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'target-test-'));
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

const SCHEMA = { id: 'Rec', name: 'Rec', description: 'a record', fields: { a: { type: 'int' }, b: { type: 'string' } } };
const MOD = (over = {}) => ({
  id: 'MOD-A', name: 'alpha', description: 'does a thing',
  exports: ['make(x: int) → map', 'len(s) → int', 'record(kind: string) → bool', 'hook in insert { row }'],
  gate_pipeline: ['G-1: x → y'], behavioral_contracts: ['same input, same output'], error_paths: ['bad x → gap'],
  ...over,
});
const egSpec = (mods, schemas = []) => normalizeSpec({ meta: { name: 'demo', version: '1.0.0', language_stack: ['emerge'] }, modules: mods, schemas });

// ── 1–2. scoring ─────────────────────────────────────────────────────────────
test('schemas are scored before the modules that reference them', () => {
  const spec = normalizeSpec({ meta: {}, modules: [MOD({ schema_refs: ['Rec'] })], schemas: [{ ...SCHEMA, fields: { a: 'int', b: 'int', c: 'int', d: 'int' } }] });
  const g = build(spec, { logLevel: 'SILENT' }).graph;
  const n = g.getNodeByName('alpha');
  eq(n.effectiveSpecDepth, 0.7, 'module reads the schema depth (0.7 for 4 fields), not 0.0');
  assert(decideTier(n).tier !== 'BLOCKED', 'no false cycle');
});
test('complete: true with every field typed makes a small schema FULL', () => {
  const spec = normalizeSpec({ meta: {}, modules: [MOD({ schema_refs: ['Rec'] })], schemas: [{ ...SCHEMA, complete: true }] });
  const g = build(spec, { logLevel: 'SILENT' }).graph;
  eq(g.getNode('Rec').specDepth, 1, 'confirmed schema is FULL');
  eq(decideTier(g.getNodeByName('alpha')).tier, 'T2');
});
test('complete: true does not count when a field has no type', () => {
  const spec = normalizeSpec({ meta: {}, modules: [], schemas: [{ ...SCHEMA, complete: true, fields: { a: { type: 'int' }, b: {} } }] });
  assert(build(spec, { logLevel: 'SILENT' }).graph.getNode('Rec').specDepth < 1);
});

// ── 3. build plan ────────────────────────────────────────────────────────────
test('built → DONE, blocked_by → DEFERRED, otherwise readiness decides', () => {
  const spec = egSpec([
    MOD({ id: 'M1', name: 'one', build: { state: 'built', existing: ['x.js'] } }),
    MOD({ id: 'M2', name: 'two', build: { state: 'not_built', blocked_by: ['D3'] } }),
    MOD({ id: 'M3', name: 'three', build: { state: 'partial' } }),
    MOD({ id: 'M4', name: 'four' }),
  ]);
  const g = build(spec, { logLevel: 'SILENT' }).graph;
  eq(decideTier(g.getNodeByName('one')).tier, 'DONE');
  const d2 = decideTier(g.getNodeByName('two'));
  eq(d2.tier, 'DEFERRED'); assert(d2.reason.includes('D3'));
  eq(decideTier(g.getNodeByName('three')).tier, 'T2');
  eq(decideTier(g.getNodeByName('four')).tier, 'T2');
  const all = decideAll(g);
  eq(all.done.length, 1); eq(all.deferred.length, 1);
  eq(buildDecision({}), null, 'no build field → no build decision');
});

// ── 4–6. Emerge emission ─────────────────────────────────────────────────────
test('Emerge target: .eg files only, every file passes the checker', async () => {
  const out = tmp();
  const spec = egSpec([MOD({ build: { state: 'not_built', file: 'lib/alpha.eg' } })], [SCHEMA]);
  const g = build(spec, { logLevel: 'SILENT' }).graph;
  await emitT0(spec, out); const r = await emitT1(spec, g, out);
  const files = walk(out).map(x => path.relative(out, x).split(path.sep).join('/')).sort();
  eq(JSON.stringify(files), JSON.stringify(['lib/alpha.eg', 'lib/alpha.test.eg']));
  for (const x of files) {
    const src = fs.readFileSync(path.join(out, x), 'utf8');
    assert(src.startsWith(GENERATED_MARK), x + ' carries the mark');
    const c = lang.compileSource(src, path.basename(x));
    eq(c.errors.length, 0, x + ': ' + (c.errors[0] && c.errors[0].message));
  }
  eq(r.language, 'emerge');
  const impl = fs.readFileSync(path.join(out, 'lib/alpha.eg'), 'utf8');
  assert(/fn make\(x: int\): map \{\n  raise\(/.test(impl), 'stub raises, with types kept');
  assert(!/^fn len\b/m.test(impl) && impl.includes('already a builtin (len)'), 'builtin not redefined, reason given');
  assert(!/^fn record\b/m.test(impl) && impl.includes('record(kind: string) → bool   — not emitted'), 'keyword-named export refused with reason');
  assert(impl.includes('hook in insert { row }'), 'non-function export kept as a comment');
});
test('generated files are regenerated; hand-written files are never overwritten', async () => {
  const out = tmp();
  const spec = egSpec([MOD({ build: { state: 'partial', file: 'alpha.eg' } })]);
  const g = build(spec, { logLevel: 'SILENT' }).graph;
  await emitT0(spec, out);
  const r1 = await emitT1(spec, g, out);
  assert(r1.emitted.includes('alpha.eg'), 'T1 replaces the T0 file (both generated)');
  fs.writeFileSync(path.join(out, 'alpha.eg'), 'fn make(x: int): map { return { x: x } }\n');
  const r2 = await emitT1(spec, g, out);
  assert(r2.skipped.some(s => s.name === 'alpha.eg' && s.reason === 'exists_not_generated'));
  eq(fs.readFileSync(path.join(out, 'alpha.eg'), 'utf8'), 'fn make(x: int): map { return { x: x } }\n');
});
test('DONE and DEFERRED modules emit nothing', async () => {
  const out = tmp();
  const spec = egSpec([MOD({ id: 'M1', name: 'one', build: { state: 'built' } }), MOD({ id: 'M2', name: 'two', build: { blocked_by: ['D1'] } })]);
  const r0 = await emitT0(spec, out);
  eq(r0.emitted.length, 0); eq(r0.skipped.length, 2);
});

// ── 7. unchanged behaviour for TypeScript specs ──────────────────────────────
test('a spec with no language or build fields still emits TypeScript', async () => {
  const out = tmp();
  const spec = normalizeSpec({ meta: { name: 'ts', version: '1.0.0' }, modules: [MOD()], schemas: [SCHEMA] });
  const r = await emitT0(spec, out);
  assert(r.emitted.includes('package.json') && r.emitted.includes('tsconfig.json'));
  assert(r.emitted.includes(path.join('src', 'modules', 'alpha', 'alpha.ts')));
  eq(isEmergeTarget(spec.meta), false);
  eq(modulePaths(MOD(), {}).impl, path.join('src', 'modules', 'alpha', 'alpha.ts'));
});

// ── 8. T2 ────────────────────────────────────────────────────────────────────
test('T2 prompt asks for Emerge and carries the spec entries as text', () => {
  const spec = egSpec([MOD()]);
  const prompt = t2.buildNodePrompt({ name: 'alpha' }, spec, GENERATED_MARK + '\nfn make(x: int) { raise("x") }', '/tmp');
  assert(prompt.includes('Return ONLY valid Emerge (.eg)'));
  assert(prompt.includes('make(x: int) → map'), 'string exports shown as written, not undefined()');
  assert(prompt.includes('G-1: x → y') && prompt.includes('same input, same output'));
  assert(prompt.includes('```eg'));
});
test('T2 prompt for a TypeScript spec is unchanged in language', () => {
  const spec = normalizeSpec({ meta: { name: 'ts' }, modules: [MOD()] });
  assert(t2.buildNodePrompt({ name: 'alpha' }, spec, '', '/tmp').includes('Return ONLY valid JavaScript/TypeScript'));
});

// ── 9–10. pipeline on cie-eg.spec ────────────────────────────────────────────
test('compile(cie-eg.spec): parsedSpec returned, buckets as planned, .eg only', async () => {
  const { compile } = require('../compiler/pipeline');
  const out = tmp();
  const r = await compile(path.join(__dirname, '..', 'spec', 'cie-eg.spec'), out, { skipCortex: true, skipIdearium: true, tier: 1 });
  assert(r.ok, 'compiled'); assert(r.parsedSpec && r.parsedSpec.meta.name === 'cie-eg', 'parsedSpec returned');
  const names = b => r.executionPlan[b].map(x => x.name).sort().join(',');
  eq(names('skip'), 'ledger,native,observe');
  eq(names('defer'), 'contract,identity,seal,store,synth');
  eq(names('run'), 'boot,gate,ledger_file,native_lang,native_system,native_tools,native_windows,registry,text');
  eq(names('block'), '');
  assert(r.executionPlan.run.every(x => x.tier === 'T2'), 'every runnable module reaches T2');
  const files = walk(out);
  assert(files.length > 0 && files.every(x => x.endsWith('.eg')), 'only .eg files');
  eq(r.gapField.gaps.length, 0, 'no gaps');
});

(async () => {
  for (const j of jobs) await j();
  console.log('\n\n  target.test.js');
  console.log('  ' + p + ' passed  ' + f + ' failed');
  process.exit(f > 0 ? 1 : 0);
})();
