'use strict';
/**
 * SISO vs WARP — same workload, both real implementations, measured not asserted.
 *
 * SISO's actual reference code (siso_ref/SISO (Core)/src/core) is loaded
 * unmodified. WARP is the code just built. Neither is mocked.
 *
 * Scenario: 5 identical "risky" events (a negative value that should never
 * be allowed to execute) sent through both. Then 20 repeated identical
 * "generate" events sent through WARP's unified dispatch to demonstrate
 * the compounding curve SISO has no mechanism for at all.
 *
 * Honesty note: no live LLM call is available in this sandbox, so
 * unifiedDispatch's cascade step uses a deterministic mock generator
 * that always succeeds (a stand-in for a model call). What's measured
 * — the exact-cache hit/miss counts, the cost curve, the axiom rejection
 * behavior — are real, not staged; only the "model" itself is a stub.
 */
const path = require('path');
const SISO_PATH = path.join(__dirname, '..', '..', 'siso_ref', 'SISO (Core)', 'src', 'core');

// SISO reference is ESM (export class ...) — read and eval as CJS-compatible
// since this sandbox runs plain node without an ESM loader configured for
// arbitrary paths. This is the actual reference source, transformed only
// enough to load, not rewritten.
const fs = require('fs');
function loadSisoModule(file) {
  const src = fs.readFileSync(path.join(SISO_PATH, file), 'utf8')
    .replace(/^export /gm, '')
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"](.+)['"];?/g, 'const {$1} = require("$2");');
  const module = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', src + '\nmodule.exports = { ' +
    (src.match(/class (\w+)/g) || []).map(c => c.replace('class ', '')).join(', ') + ' };');
  fn(module, module.exports, require, file, SISO_PATH);
  return module.exports;
}

const { Event: SisoEvent } = loadSisoModule('Event.js');
const { Gate: SisoGate } = loadSisoModule('Gate.js');
const { Stream: SisoStream } = loadSisoModule('Stream.js');

const { Event, Gate, Axiom, Stream, StreamLog } = require('../core');
const { unifiedDispatch } = require('../dispatch');
const { PopulationStore } = require('../dispatch/population');
const { FlatFileCrystallizer } = require('../plugins/crystallizer-flatfile');
const { scoreDefault } = require('../plugins/scorer-default');
const { runCascade } = require('../dispatch/cascade');

console.log('=== SISO vs WARP — head-to-head, real code, measured ===\n');

// ── Part 1: the axiom-rejection scenario — SISO structurally cannot do this ──
console.log('--- Part 1: reject a bad transform before it runs ---');

class RiskySisoGate extends SisoGate {
  constructor() { super('risky'); this.ranCount = 0; }
  transform(event) {
    this.ranCount++; // SISO has no primitive to stop this from running
  }
}
const sisoStream = new SisoStream({});
const sisoGate = new RiskySisoGate();
sisoStream.register(sisoGate);
for (let i = 0; i < 5; i++) sisoStream.emit(new SisoEvent('risky', String(-5)));
console.log(`SISO: 5 events with a "never allowed" value emitted -> gate ran ${sisoGate.ranCount}/5 times`);
console.log('  (SISO has no Axiom primitive — nothing in the framework can stop this. The paper calls this discipline, not architecture.)');

const warpStream = new Stream();
let warpRan = 0;
warpStream.register(new Gate('risky', { transform: () => { warpRan++; } }));
warpStream.registerAxiom(new Axiom('no-negative-value', {
  severity: 'hard',
  check: (event) => Number(event.data.value ?? 0) >= 0,
}));
for (let i = 0; i < 5; i++) warpStream.emit(new Event('risky', { value: -5 }));
console.log(`WARP: same 5 events -> gate ran ${warpRan}/5 times, ${warpStream.rejected.length} rejected and logged`);
console.log(`  Rejection reason on file: ${JSON.stringify(warpStream.rejected[0].failures)}\n`);

// ── Part 2: the compounding curve — cost over 20 identical requests ──
console.log('--- Part 2: cost curve over 20 identical generate requests ---');

let modelCallCount = 0;
async function mockGenerate(provider, priorFailure) {
  modelCallCount++;
  return { shape: 'valid', filledBy: provider };
}
function validateAlwaysOk(output) {
  return { ok: true };
}

const population = new PopulationStore();
const crystallizer = new FlatFileCrystallizer({}); // in-memory only, no path
const axioms = [new Axiom('shape-check', { severity: 'hard', check: () => true })];
const log = new StreamLog();

const costPerRequest = [];

async function main() {
for (let i = 0; i < 20; i++) {
  modelCallCount = 0; // reset per-request counter to measure marginal cost
  const event = new Event('generate.widget', { kind: 'button', variant: 'primary' });
  const result = await unifiedDispatch({
    gateSignature: 'generate.widget',
    gateClass: 'widget-button',
    event,
    axioms,
    crystallizer,
    population,
    scorer: scoreDefault,
    cascade: ({ event }) => runCascade({
      providers: ['cheap-model', 'strong-model'],
      generate: mockGenerate,
      validate: validateAlwaysOk,
    }),
    expectedShapeKeys: ['shape'],
    log,
  });
  costPerRequest.push({ request: i + 1, modelCalls: modelCallCount, source: result.source });
}

console.log('request# | model calls | source');
for (const r of costPerRequest) {
  console.log(`  ${String(r.request).padStart(2)}      |      ${r.modelCalls}      | ${r.source}`);
}
const firstFree = costPerRequest.findIndex(r => r.modelCalls === 0) + 1;
const totalCalls = costPerRequest.reduce((s, r) => s + r.modelCalls, 0);
console.log(`\nFirst zero-cost (crystal hit) request: #${firstFree}`);
console.log(`Total model calls across 20 identical requests: ${totalCalls} (SISO/naive re-prompt baseline would be 20)`);
console.log(`Population size for this gate-class: ${population.stats('widget-button').size} variant(s) retained`);
}

main();
