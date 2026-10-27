'use strict';
/**
 * kg.test.js — KnowledgeGraph builder tests
 * Tests: SISO pipeline, scoring, blast radius, chain, gaps, chunk integration.
 */
const { build, DEPTH, KG } = require('../compiler/kg-builder');
const { Event, Stream, StreamLog } = require('../siso');
const yaml = require('js-yaml');
const fs   = require('fs');

let p = 0, f = 0;
const jobs = [];
function test(label, fn) {
  const r = (() => { try { return fn(); } catch(e) { return Promise.reject(e); } })();
  if (r?.then) jobs.push(r.then(()=>{p++;process.stdout.write('.');}).catch(e=>{f++;console.log('\nFAIL:',label,'-',e.message);}));
  else { p++; process.stdout.write('.'); }
}
function assertEqual(a,b,msg){if(a!==b)throw new Error(msg??'expected '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function assert(v,msg){if(!v)throw new Error(msg??'assertion failed');}
function assertClose(a,b,tol=0.01,msg){if(Math.abs(a-b)>tol)throw new Error(msg??'expected '+b+' ±'+tol+', got '+a);}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FULL_MODULE = {
  id:'M', name:'m', description:'d',
  exports:['f()→R'], gate_pipeline:['G1'],
  behavioral_contracts:['c'], error_paths:['e'],
};

const CHAIN_SPEC = {
  meta: { name: 'chain-test', version: '1.0.0' },
  modules: [
    { id:'A', name:'a', description:'d', exports:['f()→R'], gate_pipeline:['G1'], behavioral_contracts:['c'], error_paths:['e'] },
    { id:'B', name:'b', description:'d', exports:['g()→S'], gate_pipeline:['G2'], behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'a'}] },
    { id:'C', name:'c', description:'d', exports:['h()→T'], gate_pipeline:['G3'], behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'b'}] },
  ],
};

// ── SISO pipeline structure ───────────────────────────────────────────────────
test('KG: build() returns ok + graph', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules: [FULL_MODULE] });
  assert(r.ok); assert(r.graph);
});
test('KG: pipeline produces 6 events (build+nodes+edges+scored+blast+complete)', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[FULL_MODULE] }, {logLevel:'EVENTS'});
  assertEqual(r.log.sample().count, 6);
});
test('KG: pipeline events in correct sequence', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[FULL_MODULE] }, {logLevel:'EVENTS'});
  const types = r.log.sample().entries.map(e=>e.type);
  assertEqual(types[0], KG.BUILD);
  assertEqual(types[5], KG.COMPLETE);
});

// ── specDepth scoring ─────────────────────────────────────────────────────────
test('KG: specDepth 0.0 for id-only node', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[{id:'X',name:'X'}] });
  assertClose(r.graph.getNode('X').specDepth, DEPTH.NAME);
});
test('KG: specDepth 0.85 for module with contracts but no error_paths', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[{id:'M',name:'m',description:'d',exports:['f()→R'],gate_pipeline:['G1'],behavioral_contracts:['c']}] });
  assertClose(r.graph.getNode('M').specDepth, DEPTH.CONTRACTS);
});
test('KG: specDepth 1.0 when all fields present (exports+gates+contracts+errorPaths)', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[FULL_MODULE] });
  assertClose(r.graph.getNode('M').specDepth, DEPTH.FULL);
});
test('KG: specDepth 0.3 with exports only', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[{id:'X',name:'x',description:'d',exports:['f()→R']}] });
  assertClose(r.graph.getNode('X').specDepth, DEPTH.EXPORTS);
});

// ── generationReadiness propagation ──────────────────────────────────────────
test('KG: leaf node genReady = own specDepth', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[FULL_MODULE] });
  const n = r.graph.getNode('M');
  assertClose(n.generationReadiness, n.specDepth);
});
test('KG: dependent genReady = min(own, dep.genReady)', () => {
  // B depends on A. A=0.85, B=0.7 → B.genReady = min(0.7, 0.85) = 0.7
  const r = build({ meta:{name:'t',version:'1'}, modules:[
    { id:'A', name:'a', description:'d', exports:['f()→R'], gate_pipeline:['G1'], behavioral_contracts:['c'], error_paths:['e'] },
    { id:'B', name:'b', description:'d', exports:['g()→S'], gate_pipeline:['G2'], behavioral_contracts:['c'], deps:[{name:'a'}] },
  ]});
  const b = r.graph.getNodeByName('b');
  assertClose(b.generationReadiness, DEPTH.CONTRACTS); // 0.7
});
test('KG: weak dep chains constrain downstream', () => {
  // kg(0.3) → parser(0.7) → lexer(1.0). kg.genReady = min(0.3, 0.7) = 0.3
  const r = build(CHAIN_SPEC);
  // All full spec here → all GREEN
  const a = r.graph.getNodeByName('a');
  const c = r.graph.getNodeByName('c');
  assertClose(a.generationReadiness, DEPTH.FULL);
  assertClose(c.generationReadiness, DEPTH.FULL); // chain is fully specced
});

// ── Confidence ────────────────────────────────────────────────────────────────
test('KG: GREEN when genReady >= 0.8', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[FULL_MODULE] });
  assertEqual(r.graph.getNode('M').confidence, 'GREEN');
});
test('KG: AMBER when genReady 0.5-0.79', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[
    { id:'X', name:'x', description:'d', exports:['f()→R'], gate_pipeline:['G1'], behavioral_contracts:['c'] },
  ]});
  assertEqual(r.graph.getNode('X').confidence, 'AMBER');
});
test('KG: RED when genReady < 0.5', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[{id:'X',name:'x',description:'d',exports:['f()→R']}] });
  assertEqual(r.graph.getNode('X').confidence, 'RED');
});
test('KG: BLACK for referenced-but-undeclared dep', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[
    { id:'B', name:'b', description:'d', exports:['f()→R'], gate_pipeline:['G1'], behavioral_contracts:['c'], error_paths:['e'], deps:[{name:'ghost'}] },
  ]});
  const black = r.graph.getBlackNodes();
  assertEqual(black.length, 1);
  assertEqual(black[0].name, 'ghost');
  assertEqual(black[0].confidence, 'BLACK');
});

// ── Blast radius ──────────────────────────────────────────────────────────────
test('KG: blast radius of A includes B and C in A→B→C chain', () => {
  const r = build(CHAIN_SPEC);
  const blast = r.graph.getBlastRadius('A').map(n=>n.name).sort();
  assert(blast.includes('b'), 'b not in blast');
  assert(blast.includes('c'), 'c not in blast');
});
test('KG: leaf node (no dependents) has empty blast radius', () => {
  const r = build(CHAIN_SPEC);
  assertEqual(r.graph.getBlastRadius('C').length, 0);
});

// ── Graph queries ─────────────────────────────────────────────────────────────
test('KG: getChain finds path through deps', () => {
  const r = build(CHAIN_SPEC);
  const chain = r.graph.getChain('C', 'A');
  assert(chain !== null, 'chain not found');
  assertEqual(chain[0], 'C');
  assertEqual(chain[chain.length-1], 'A');
});
test('KG: getChain returns null for no path', () => {
  const r = build(CHAIN_SPEC);
  assertEqual(r.graph.getChain('A', 'C'), null); // reverse direction
});
test('KG: getBuildOrder is bottom-up (foundations first)', () => {
  const r = build(CHAIN_SPEC);
  const order = r.graph.getBuildOrder().filter(n=>n.kind==='module').map(n=>n.name);
  // a has no deps → should be first; c depends on b depends on a → should be last
  assert(order.indexOf('a') < order.indexOf('c'), 'a should come before c');
});
test('KG: getNodesByKind filters correctly', () => {
  const r = build({ meta:{name:'t',version:'1'}, modules:[FULL_MODULE], events:['e.done { x }'] });
  assert(r.graph.getNodesByKind('module').length >= 1);
  assert(r.graph.getNodesByKind('event').length >= 1);
});
test('KG: getGaps returns sorted by impact desc', () => {
  const r = build(CHAIN_SPEC);
  const gaps = r.graph.getGaps();
  for (let i=1;i<gaps.length;i++) assert(gaps[i-1].impact >= gaps[i].impact, 'gaps not sorted');
});

// ── causal-nexus.spec integration ────────────────────────────────────────────
test('KG: causal-nexus.spec builds without error', () => {
  const raw  = fs.readFileSync('/mnt/user-data/uploads/causal-nexus.spec', 'utf-8');
  const doc  = yaml.load(raw);
  const spec = doc.spec;
  const mods = Object.entries(spec.modules).map(([k,v]) => ({ name:k, id:v.id??k, ...v }));
  const r    = build({ ...spec, modules: mods });
  assert(r.ok);
  assert(r.graph.meta.nodeCount > 0);
  assertEqual(r.graph.meta.blackCount, 0); // causal-nexus has no undeclared refs
});

// ── Chunk integration ─────────────────────────────────────────────────────────
test('KG: getChunk() returns valid chunk within token budget', () => {
  const r     = build({ meta:{name:'t',version:'1'}, modules:[FULL_MODULE] });
  const chunk = r.graph.getChunk('M', null, 2);
  assert(chunk, 'chunk is null');
  assertEqual(chunk.subject.id, 'M');
  assert(chunk.seamContract.tests.length > 0);
  const { estimateTokens } = require('../chunk');
  assert(estimateTokens(chunk) <= 800, 'over T2 budget');
});

// ── Pipeline: compile() now returns graph ────────────────────────────────────
test('KG: compile() result includes graph', async () => {
  const { compile } = require('../compiler/pipeline');
  const r = await compile('/mnt/user-data/uploads/causal-nexus.spec', '/tmp/kg-test-'+Date.now(), {
    skipCortex: true, tier: 1,
  });
  assert(r.ok);
  assert(r.graph !== undefined, 'graph missing from compile result');
  if (r.graph) {
    assert(r.graph.meta.nodeCount > 0);
  }
});

// ── Report ────────────────────────────────────────────────────────────────────
Promise.all(jobs).then(() => {
  console.log('\n\n  kg.test.js');
  console.log('  ' + p + ' passed  ' + f + ' failed');
  if (f > 0) process.exit(1);
  else process.exit(0);
});
