'use strict';
/**
 * compiler.js — Tier 0 + Tier 1 spec compiler
 * UUID: spec-compiler-t0-t1-v1-0000-0001
 * Version: 1.0.0
 *
 * TIER 0 — Structure. Zero LLM. Always runs.
 *   Input:  ParsedSpec (from js-yaml over a .spec file)
 *   Output: directory tree, empty TS files, barrel exports, tsconfig, package.json
 *   Token cost: 0
 *
 * TIER 1 — Scaffold. Zero LLM. Runs when genReadiness > 0.3.
 *   Input:  ParsedSpec + KnowledgeGraph
 *   Output: typed interfaces, gate stubs, SISO wiring, test describe blocks
 *   Token cost: 0
 *
 * CORTEX FIRST:
 *   Before emitting anything, compiler calls cortex-query.preflight().
 *   Files already in Cortex versionium are not re-emitted.
 *   Open gaps are injected into the relevant stubs as TODO comments.
 *
 * §1.1  Nothing emitted until spec parsed + Cortex queried.
 * §1.2  Every emit failure is written to a local failures log.
 * §1.3  No stubs in production code — T1 stubs explicitly throw NotImplementedError.
 * §3.1  Bottom-up only — foundation emitted before modules.
 */

const fs      = require('fs');
const path    = require('path');
const { preflight, ping } = require('../cortex-query');
const { writeback, summarizeWriteback } = require('../cortex-query/writeback');
// -- Spec normalization -------------------------------------------------------
// .spec modules come in two shapes: array (spec-parser.spec) or dict (causal-nexus.spec)

function sanitizeSpec(raw) {
  // Pre-process .spec files to fix known YAML authoring issues:
  // - Unquoted list items containing bare ': ' sequences (gate pipeline entries, type sigs)
  // Only quote items where the colon appears after a non-key-like prefix.
  // Leaves legitimate YAML mapping items (deps, name:, version:) untouched.
  return raw.replace(
    /^(\s*-\s+)(.+)$/gm,
    (match, indent, val) => {
      if (val.startsWith('"') || val.startsWith("'") || val.startsWith('{') || val.startsWith('[')) {
        return match;
      }
      // Only quote if: contains ': ' AND does not look like a simple 'key: value' mapping
      // A simple mapping starts with a lowercase/identifier key followed by ': '
      const simpleMapping = /^[a-z_][a-z_0-9]*:\s/.test(val.trim());
      const hasColon = /:\s/.test(val);
      if (hasColon && !simpleMapping) {
        const escaped = val.replace(/"/g, '\\"');
        return indent + '"' + escaped + '"';
      }
      return match;
    }
  );
}

function normalizeModules(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(m => ({ ...m, name: m.name ?? m.id }));
  if (typeof raw === 'object') {
    return Object.entries(raw).map(([key, val]) => ({
      name: key, id: val?.id ?? key, ...val,
    }));
  }
  return [];
}

function normalizeSpec(raw) {
  if (!raw) return {};
  return {
    ...raw,
    modules: normalizeModules(raw.modules),
    schemas: Array.isArray(raw.schemas) ? raw.schemas : Object.values(raw.schemas ?? {}),
  };
}



// ── Constants ─────────────────────────────────────────────────────────────────

const COMPILER_VERSION = require('../version').SYSTEM;
const COMPILER_ID      = require('../version').COMPILER_ID + '-t0-t1';

// specDepth thresholds (from spec-parser.spec §MOD-KG-BUILDER)
const SPEC_DEPTH = {
  ID_ONLY:    0.0,
  NAME:       0.1,
  DESCRIPTION:0.2,
  EXPORTS:    0.3,
  GATES:      0.5,
  CONTRACTS:  0.7,
  ERROR_PATHS:0.85,
  FULL:       1.0,
};

// ── T0: Structure emitter ─────────────────────────────────────────────────────

/**
 * emitT0(parsedSpec, outputDir, cortexResult)
 *
 * Deterministic. Same spec → same output. Always.
 * Skips files already in cortexResult.existingFiles.
 */
async function emitT0(parsedSpec, outputDir, cortexResult = null) {
  parsedSpec = normalizeSpec(parsedSpec);
  const skipped = [];
  const emitted = [];
  const failures = [];

  const existingNames = new Set(
    (cortexResult?.existingFiles ?? []).map(f => f.name)
  );

  function skip(name, reason) {
    skipped.push({ name, reason });
  }

  function write(filePath, content) {
    const rel = path.relative(outputDir, filePath);
    if (existingNames.has(rel) || existingNames.has(filePath)) {
      skip(rel, 'already_in_cortex');
      return;
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      emitted.push(rel);
    } catch (e) {
      failures.push({ file: rel, error: e.message });
    }
  }

  const meta    = parsedSpec.meta    ?? {};
  const modules = parsedSpec.modules ?? [];

  // ── Root files ──────────────────────────────────────────────────────────
  write(path.join(outputDir, 'package.json'), JSON.stringify({
    name:    meta.name    ?? 'unknown',
    version: meta.version ?? '0.0.1',
    type:    'module',
    main:    'src/index.ts',
    scripts: {
      build: 'tsc',
      test:  'node --experimental-vm-modules node_modules/.bin/jest',
    },
    dependencies: Object.fromEntries(
      (meta.runtime_deps ?? meta.deps ?? [])
        .filter(d => d.required)
        .map(d => [d.name, d.version ?? '*'])
    ),
    devDependencies: {
      typescript: '^5.0.0',
      jest:       '^29.0.0',
      '@types/node': '^20.0.0',
    },
  }, null, 2));

  write(path.join(outputDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target:            'ES2022',
      module:            'NodeNext',
      moduleResolution:  'NodeNext',
      outDir:            './dist',
      rootDir:           './src',
      strict:            true,
      esModuleInterop:   true,
      declaration:       true,
      declarationMap:    true,
      sourceMap:         true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  }, null, 2));

  // ── src/types/ — one file per schema block ──────────────────────────────
  const typesDir = path.join(outputDir, 'src', 'types');

  // Core types file
  write(path.join(typesDir, 'index.ts'), [
    `// Generated by ${COMPILER_ID} v${COMPILER_VERSION}`,
    `// spec: ${meta.name} v${meta.version}`,
    `// DO NOT EDIT — regenerated from .spec on every T0 run`,
    '',
    `export * from './events.js';`,
    `export * from './schemas.js';`,
    ...modules.map(m => `export * from './modules/${toTypeName(m.name ?? m.id)}.js';`),
  ].join('\n'));

  // Event constants
  const events = extractEvents(parsedSpec);
  write(path.join(typesDir, 'events.ts'), [
    `// Event type constants — generated from spec`,
    `// Source: ${meta.name}.spec events block`,
    '',
    `export const Events = {`,
    ...events.map(e => `  '${e}': '${e}',`),
    `} as const;`,
    '',
    `export type EventType = keyof typeof Events;`,
  ].join('\n'));

  // Schema types
  const schemas = parsedSpec.schemas ?? [];
  write(path.join(typesDir, 'schemas.ts'), [
    `// Schema types — generated from spec Block 7`,
    '',
    ...schemas.map(s => schemaToInterface(s)),
  ].join('\n'));

  // Root barrel
  write(path.join(outputDir, 'src', 'index.ts'), [
    `// ${meta.name} — generated barrel`,
    `// spec: v${meta.version} | compiler: ${COMPILER_ID} v${COMPILER_VERSION}`,
    '',
    `export * from './types/index.js';`,
    ...modules.map(m => `export * from './modules/${m.name ?? m.id}/index.js';`),
  ].join('\n'));

  // ── src/modules/{name}/ — one directory per module ──────────────────────
  for (const mod of modules) {
    const modName = mod.name ?? mod.id;
    const modDir  = path.join(outputDir, 'src', 'modules', modName);

    // Module barrel
    write(path.join(modDir, 'index.ts'), [
      `// ${modName} — module barrel`,
      `// specDepth: ${computeSpecDepth(mod).toFixed(2)}`,
      `export * from './${modName}.js';`,
    ].join('\n'));

    // Empty implementation file (T1 will fill this)
    write(path.join(modDir, `${modName}.ts`), [
      `// ${modName}.ts — STUB`,
      `// Generated by ${COMPILER_ID} T0`,
      `// Replace this file with T1 scaffold or hand-written implementation`,
      '',
      `// specDepth: ${computeSpecDepth(mod).toFixed(2)}`,
      `// exports: ${(mod.exports ?? []).length}`,
      `// gates: ${(mod.gate_pipeline ?? []).length}`,
      '',
      `// TODO: T1 scaffold pending`,
    ].join('\n'));

    // Empty test file (T1 will fill this)
    write(path.join(modDir, `${modName}.test.ts`), [
      `// ${modName}.test.ts — STUB`,
      `// Generated by ${COMPILER_ID} T0`,
      `// T1 will emit describe() blocks from behavioral_contracts`,
      '',
      `describe('${modName}', () => {`,
      `  it.todo('T1 scaffold pending');`,
      `});`,
    ].join('\n'));
  }

  return {
    tier:     0,
    emitted,
    skipped,
    failures,
    outputDir,
    moduleCount: modules.length,
    eventCount:  events.length,
    schemaCount: schemas.length,
  };
}

// ── T1: Scaffold emitter ──────────────────────────────────────────────────────

/**
 * emitT1(parsedSpec, knowledgeGraph, outputDir, cortexResult)
 *
 * Emits typed interfaces, gate stubs, SISO wiring, test describe blocks.
 * Only runs for nodes where genReadiness > 0.3.
 * Still zero LLM tokens.
 */
async function emitT1(parsedSpec, knowledgeGraph, outputDir, cortexResult = null) {
  parsedSpec = normalizeSpec(parsedSpec);
  const emitted  = [];
  const skipped  = [];
  const failures = [];

  const existingNames = new Set(
    (cortexResult?.existingFiles ?? []).map(f => f.name)
  );
  const openGaps = cortexResult?.openGaps ?? [];

  function write(filePath, content) {
    const rel = path.relative(outputDir, filePath);
    if (existingNames.has(rel) || existingNames.has(filePath)) {
      skipped.push({ name: rel, reason: 'already_in_cortex' });
      return;
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      emitted.push(rel);
    } catch (e) {
      failures.push({ file: rel, error: e.message });
    }
  }

  const modules = parsedSpec.modules ?? [];

  for (const mod of modules) {
    const modName    = mod.name ?? mod.id;
    const specDepth  = computeSpecDepth(mod);
    const genReady   = computeGenReadiness(mod, knowledgeGraph);

    if (genReady <= SPEC_DEPTH.EXPORTS) {
      skipped.push({ name: modName, reason: `genReadiness ${genReady.toFixed(2)} ≤ 0.3` });
      continue;
    }

    // Module gaps from Cortex
    const modGaps = openGaps.filter(g =>
      g.path?.includes(modName) || g.path?.includes(mod.id)
    );

    const modDir  = path.join(outputDir, 'src', 'modules', modName);

    // ── TypeScript interface ───────────────────────────────────────────────
    const interfaceFile = path.join(modDir, `${modName}.interface.ts`);
    write(interfaceFile, emitInterface(mod, parsedSpec));

    // ── Implementation scaffold ────────────────────────────────────────────
    const implFile = path.join(modDir, `${modName}.ts`);
    write(implFile, emitImpl(mod, parsedSpec, modGaps));

    // ── Test scaffold ─────────────────────────────────────────────────────
    const testFile = path.join(modDir, `${modName}.test.ts`);
    write(testFile, emitTests(mod, parsedSpec, modGaps));
  }

  return {
    tier:        1,
    emitted,
    skipped,
    failures,
    outputDir,
    moduleCount: modules.length,
  };
}

// ── Interface emitter ─────────────────────────────────────────────────────────

function emitInterface(mod, parsedSpec) {
  const name    = mod.name ?? mod.id;
  const exports = mod.exports ?? [];

  return [
    `// ${name} — TypeScript interface`,
    `// Generated by spec-compiler T1 from gate_pipeline + exports`,
    `// specDepth: ${computeSpecDepth(mod).toFixed(2)}`,
    '',
    `export interface I${toTypeName(name)} {`,
    ...exports.map(ex => {
      const sig = parseExportSig(ex);
      return `  ${sig.name}(${sig.params}): ${sig.returns};`;
    }),
    `}`,
    '',
    `export interface I${toTypeName(name)}Config {`,
    `  // Module configuration — fill from spec constraints`,
    ...((mod.constraints ?? []).map(c => `  // ${c.id}: ${(c.description ?? '').slice(0, 80)}`)),
    `}`,
  ].join('\n');
}

// ── Implementation scaffold emitter ──────────────────────────────────────────

function emitImpl(mod, parsedSpec, modGaps = []) {
  const name    = mod.name ?? mod.id;
  const exports = mod.exports ?? [];
  const gates   = mod.gate_pipeline ?? [];
  const bc      = mod.behavioral_contracts ?? [];
  const errors  = mod.error_paths ?? [];

  const gapComments = modGaps.map(g =>
    `// GAP [${g.severity}] ${g.type}: ${g.body?.slice(0, 100) ?? ''}`
  );

  return [
    `'use strict';`,
    `// ── ${name} ────────────────────────────────────────────────────────────`,
    `// UUID: ${mod.uuid ?? 'MISSING-UUID'}`,
    `// Version: 0.0.1`,
    `//`,
    `// Generated by spec-compiler T1`,
    `// specDepth: ${computeSpecDepth(mod).toFixed(2)}`,
    ...(gapComments.length ? ['', '// ── Open Gaps (from Cortex) ──', ...gapComments] : []),
    '',

    // SISO import placeholder
    `// ── SISO wiring ─────────────────────────────────────────────────────────`,
    `// import { Stream, Gate, Event } from '../foundation/siso/index.js';`,
    `// const stream = new Stream('${name}');`,
    '',

    // Gate pipeline stubs
    ...(gates.length ? [
      `// ── Gate Pipeline ───────────────────────────────────────────────────────`,
      ...gates.map(g => emitGateStub(g, name)),
      '',
    ] : []),

    // Behavioral contracts as comments
    ...(bc.length ? [
      `// ── Behavioral Contracts ────────────────────────────────────────────────`,
      ...bc.map(c => `// CONTRACT: ${c}`),
      '',
    ] : []),

    // Error paths as comments
    ...(errors.length ? [
      `// ── Error Paths ─────────────────────────────────────────────────────────`,
      ...errors.map(e => `// ERROR: ${e}`),
      '',
    ] : []),

    // Function stubs
    `// ── Exports ──────────────────────────────────────────────────────────────`,
    ...exports.map(ex => emitFunctionStub(ex, name)),
    '',
    `module.exports = {`,
    ...exports.map(ex => `  ${parseExportSig(ex).name},`),
    `};`,
  ].join('\n');
}

function emitGateStub(gate, moduleName) {
  const gateId = typeof gate === 'string' ? gate : (gate.id ?? gate);
  // Parse "GATE-LEX-001: raw string → YAML.parseDocument() → YAMLDocument"
  const parts  = String(gateId).split(':');
  const id     = parts[0]?.trim() ?? gateId;
  const desc   = parts[1]?.trim() ?? '';
  return [
    `// ${id}${desc ? ': ' + desc : ''}`,
    `// stream.on('${id.toLowerCase()}', async (event) => {`,
    `//   // §1.3 implement gate transform here`,
    `//   throw new Error('${moduleName} gate ${id}: not implemented');`,
    `// });`,
    '',
  ].join('\n');
}

function emitFunctionStub(exportStr, moduleName) {
  const sig     = parseExportSig(exportStr);
  const isAsync = exportStr.includes('Promise') || exportStr.includes('Async');
  const prefix  = isAsync ? 'async ' : '';
  return [
    `// ${exportStr}`,
    `${prefix}function ${sig.name}(${sig.params}) {`,
    `  // §1.3 No stubs in production — implement this`,
    `  throw new Error('${moduleName}.${sig.name}: not implemented');`,
    `}`,
    '',
  ].join('\n');
}

// ── Test scaffold emitter ─────────────────────────────────────────────────────

function emitTests(mod, parsedSpec, modGaps = []) {
  const name    = mod.name ?? mod.id;
  const exports = mod.exports ?? [];
  const bc      = mod.behavioral_contracts ?? [];
  const errors  = mod.error_paths ?? [];

  return [
    `'use strict';`,
    `// ── ${name} tests ─────────────────────────────────────────────────────────`,
    `// Generated by spec-compiler T1`,
    `// One describe block per export. One it() per behavioral contract + error path.`,
    '',
    ...(modGaps.map(g => `// GAP [${g.severity}]: ${g.type} — ${g.body?.slice(0, 80) ?? ''}`)),
    '',
    `const mod = require('./${name}.js');`,
    '',
    `describe('${name}', () => {`,
    '',

    // One describe per export
    ...exports.map(ex => {
      const sig = parseExportSig(ex);
      return [
        `  describe('${sig.name}', () => {`,
        `    it('exists and is callable', () => {`,
        `      expect(typeof mod.${sig.name}).toBe('function');`,
        `    });`,
        '',
        `    // Behavioral contracts:`,
        ...bc.slice(0, 3).map(c => `    it.todo('${c.slice(0, 80)}');`),
        '',
        `    // Error paths:`,
        ...errors.slice(0, 2).map(e => `    it.todo('handles: ${e.slice(0, 60)}');`),
        `  });`,
        '',
      ].join('\n');
    }),

    `});`,
  ].join('\n');
}

// ── Spec parsing helpers ──────────────────────────────────────────────────────

function computeSpecDepth(mod) {
  let depth = SPEC_DEPTH.ID_ONLY;
  if (mod.name)                                      depth = Math.max(depth, SPEC_DEPTH.NAME);
  if (mod.description)                               depth = Math.max(depth, SPEC_DEPTH.DESCRIPTION);
  if ((mod.exports        ?? []).length > 0)         depth = Math.max(depth, SPEC_DEPTH.EXPORTS);
  if ((mod.gate_pipeline  ?? []).length > 0)         depth = Math.max(depth, SPEC_DEPTH.GATES);
  if ((mod.behavioral_contracts ?? []).length > 0)   depth = Math.max(depth, SPEC_DEPTH.CONTRACTS);
  if ((mod.error_paths    ?? []).length > 0)         depth = Math.max(depth, SPEC_DEPTH.ERROR_PATHS);
  return depth;
}

function computeGenReadiness(mod, graph) {
  const ownDepth = computeSpecDepth(mod);
  if (!graph) return ownDepth;

  const deps = mod.deps ?? mod.runtime_deps ?? [];
  if (!deps.length) return ownDepth;

  let minDepReadiness = 1.0;
  for (const dep of deps) {
    const depNode = graph.getNodeByName?.(dep.name);
    if (depNode) {
      minDepReadiness = Math.min(minDepReadiness, depNode.generationReadiness ?? 0.5);
    }
  }
  return Math.min(ownDepth, minDepReadiness);
}

function extractEvents(parsedSpec) {
  const events = [];
  const evBlock = parsedSpec.events ?? parsedSpec.event_model ?? {};

  if (Array.isArray(evBlock)) {
    // event_model is array of strings: "event.name { payload }"
    for (const e of evBlock) {
      const name = typeof e === 'string' ? e.split(/\s/)[0] : (e.name ?? e.id);
      if (name) events.push(name);
    }
  } else if (typeof evBlock === 'object') {
    for (const [ns, list] of Object.entries(evBlock)) {
      if (Array.isArray(list)) {
        for (const e of list) {
          const name = typeof e === 'string' ? e.split(/\s/)[0] : (e.name ?? e.id);
          if (name) events.push(name);
        }
      }
    }
  }
  return [...new Set(events)];
}

function schemaToInterface(schema) {
  const name = schema.id ?? schema.name ?? 'Unknown';
  const fields = Object.entries(schema.fields ?? schema.properties ?? {});
  return [
    `export interface ${toTypeName(name)} {`,
    ...fields.map(([k, v]) => `  ${k}: ${yamlTypeToTs(v)};`),
    `}`,
    '',
  ].join('\n');
}

function parseExportSig(exportStr) {
  // "parse(tokens: SpecToken[], boundaries: BlockBoundary[]) → ParsedSpec"
  const m = exportStr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?:→|-?>)\s*(.+)$/);
  if (m) return { name: m[1], params: m[2].trim(), returns: m[3].trim() };

  // "tokenize(input: string) → SpecToken[]"
  const m2 = exportStr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
  return { name: m2?.[1] ?? 'unknown', params: '...args: unknown[]', returns: 'unknown' };
}

function toTypeName(str) {
  return str
    .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
    .replace(/^./, c => c.toUpperCase());
}

function yamlTypeToTs(typeStr) {
  const s = String(typeStr).toLowerCase();
  if (s.includes('string'))  return 'string';
  if (s.includes('number') || s.includes('float') || s.includes('int')) return 'number';
  if (s.includes('boolean') || s.includes('bool')) return 'boolean';
  if (s.includes('[]'))      return 'unknown[]';
  return 'unknown';
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * compile(specPath, outputDir, options)
 *
 * Full T0+T1 compilation pipeline:
 *   1. Parse .spec file (js-yaml)
 *   2. Query Cortex (what already exists?)
 *   3. Emit T0 (structure — skipping existing)
 *   4. Emit T1 (scaffold — skipping existing, injecting open gaps)
 *   5. Return compilation report
 */
async function compile(specPath, outputDir, options = {}) {
  const { skipCortex = false, tier = 1, verbose = false, skipWriteback = false } = options;

  // ── Step 0: Load spec ────────────────────────────────────────────────────
  let yaml, parsedSpec;
  try {
    const { load } = await import('js-yaml');
    const raw      = fs.readFileSync(specPath, 'utf-8');
    const doc      = load(raw);
    parsedSpec     = normalizeSpec(doc?.spec ?? doc);
    if (!parsedSpec) throw new Error('No spec root found');
  } catch (e) {
    return { ok: false, error: `spec parse failed: ${e.message}`, step: 'parse' };
  }

  const moduleName = parsedSpec.meta?.name ?? path.basename(specPath, '.spec');

  // ── Step 1: Query Cortex ─────────────────────────────────────────────────
  let cortexResult = null;
  if (!skipCortex) {
    const cortexPing = await ping();
    if (verbose) console.log(`[compiler] Cortex: ${cortexPing.reachable ? 'reachable' : 'unreachable'}`);

    cortexResult = await preflight({
      moduleName,
      specPath,
      outputDir,
    });

    if (verbose) console.log(`[compiler] Cortex preflight:\n${cortexResult.summary}`);

    if (cortexResult.skipGeneration && !options.force) {
      return {
        ok:      true,
        skipped: true,
        reason:  'all files present in Cortex, no high gaps',
        summary: cortexResult.summary,
        cortex:  cortexResult,
      };
    }
  }

  // ── Step 2: Emit T0 ──────────────────────────────────────────────────────
  const t0 = await emitT0(parsedSpec, outputDir, cortexResult);
  if (verbose) console.log(`[compiler] T0: emitted ${t0.emitted.length}, skipped ${t0.skipped.length}`);

  // ── Step 3: Emit T1 (if tier >= 1) ───────────────────────────────────────
  let t1 = null;
  if (tier >= 1) {
    // Minimal knowledge graph stub — real KG built by kg-builder (future module)
    const minimalGraph = {
      getNode:       (id)   => parsedSpec.modules?.find(m => m.id === id),
      getNodeByName: (name) => parsedSpec.modules?.find(m => m.name === name),
      getNodesByKind: (kind) => (parsedSpec.modules ?? []).filter(m => m.kind === kind),
    };
    t1 = await emitT1(parsedSpec, minimalGraph, outputDir, cortexResult);
    if (verbose) console.log(`[compiler] T1: emitted ${t1.emitted.length}, skipped ${t1.skipped.length}`);
  }

  // ── Step 4: Write-back to Cortex ────────────────────────────────────────
  const compileResult = {
    ok: true, skipped: false, moduleName, outputDir, t0, t1, cortex: cortexResult,
    specDepths: (parsedSpec.modules ?? []).map(m => ({
      name: m.name ?? m.id, specDepth: computeSpecDepth(m).toFixed(2),
    })),
  };

  let writebackReport = null;
  if (!skipCortex && !skipWriteback) {
    writebackReport = await writeback(compileResult, specPath, { verbose });
    if (verbose) console.log(`[compiler] writeback:\n${summarizeWriteback(writebackReport)}`);
  }

  return { ...compileResult, writeback: writebackReport };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args      = process.argv.slice(2);
  const specPath  = args[0];
  const outputDir = args[1] ?? './output';
  const verbose   = args.includes('--verbose');
  const force     = args.includes('--force');
  const skipCortex= args.includes('--skip-cortex');

  if (!specPath) {
    console.error('Usage: node compiler.js <spec-path> [output-dir] [--verbose] [--force] [--skip-cortex]');
    process.exit(1);
  }

  compile(specPath, outputDir, { verbose, force, skipCortex, tier: 1 })
    .then(result => {
      if (!result.ok) {
        console.error(`[compiler] FAILED: ${result.error}`);
        process.exit(1);
      }
      if (result.skipped) {
        console.log(`[compiler] SKIPPED: ${result.reason}`);
        if (verbose) console.log(result.summary);
      } else {
        console.log(`[compiler] OK: ${result.moduleName}`);
        console.log(`  T0: ${result.t0?.emitted?.length ?? 0} emitted, ${result.t0?.skipped?.length ?? 0} skipped`);
        console.log(`  T1: ${result.t1?.emitted?.length ?? 0} emitted, ${result.t1?.skipped?.length ?? 0} skipped`);
        if (result.cortex?.summary) console.log(`  Cortex: ${result.cortex.summary.split('\n')[0]}`);
        if (result.writeback && !result.writeback.skipped) {
          const wb = result.writeback;
          console.log(`  Writeback: ${wb.filesUploaded?.length ?? 0} files, commit: ${wb.commit?.ok ? 'ok' : 'failed'}, seam: ${wb.seam?.ok ? 'ok' : 'failed'}`);
          if (wb.errors?.length) console.warn(`  Writeback warnings: ${wb.errors.join(', ')}`);
        }
        if (result.specDepths?.length) {
          console.log('  specDepths:');
          for (const s of result.specDepths) console.log(`    ${s.name}: ${s.specDepth}`);
        }
      }
    })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  compile,
  emitT0,
  emitT1,
  computeSpecDepth,
  computeGenReadiness,
};
