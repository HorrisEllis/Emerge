'use strict';
/**
 * emerge/compiler/phase-specs.js — PS1: each phase specced again, with its DAG and its related files, beside the system that owns it.
 * comp_id: nexus.emerge.phase-specs
 * Lives in emerge (the spec compiler's system), not lib/: it compiles specs with emerge's kg-builder, and lib/ requiring emerge/ is
 * a new upward crossing (lib/system-boundary.js). From here its uses of lib/ are the allowed system-uses-kernel kind.
 * Spec: docs/substrate.spec MOD-PHASE-SPECS · Map: docs/2026-10-20-substrate-graph-traversal-chunking-gating-phasemap.spec PS1
 *
 * James, 2026-10-20: "not phasemaps. full specs to build them. everything needs  to be speccced before built,so it can be rebuilt
 * if lost. can you do that? what about specs, then phases then specced again with dag and related files for it, look at the
 * handoff"
 *
 * His order, as tooling: (1) a full spec (emerge module format, compiled by emerge/compiler/kg-builder.js), (2) its phases in a
 * phasemap, each naming the spec (`spec:`) and the modules it builds (`blocks:`), (3) THIS: every phase written again as nodes —
 *   <owner>/phases/<map-id>/<phase>.phase         authored: id, map, layer, status, files, depends_on, blocks, spec, graph hash
 *   <owner>/phases/<map-id>/graph/<…>.graph       derived: files with roles (changes, uses, used-by), edges, crossings, dag slice
 * (the handoff of 2026-10-19, PN1's layout: the .phase holds what is authored; the DAG slice is derived, in its own .graph keyed by
 * its hash). Owner = lib/phase-plan.js targetSystem over the phase's files; core's home is lib/.
 * Reuse (§8.6): phase-dag (the whole DAG, slice), phase-map-auto (files, requires, consumers), phase-graph (graphFor, crossings),
 * pipeline-nodes (phaseNode, graphNode, writeNode), emerge's kg-builder (what a spec declares). Nothing here asks a model.
 *
 *   write({ root, map, mapsDir, out }) → [{ phase, owner, phaseFile, graphFile, ready, blocks: { resolved, missing } }]
 *   check({ root, map, mapsDir, out }) → [{ phase, drift: [why] }]   — re-derives and compares with the files on disk
 *   cli: node lib/emerge/compiler/phase-specs.js <map.spec> [--check]
 */
const fs = require('fs');
const path = require('path');

const MODULE_ID = 'nexus.emerge.phase-specs';
const VERSION = '1.1.0';
const ROOT = path.resolve(__dirname, '..', '..', '..');

const _field = (body, k) => { const m = String(body || '').match(new RegExp(`^\\s{4}${k}:\\s*(.+)$`, 'm')); return m ? m[1].trim() : null; };
const _list = (v) => (v ? v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean) : []);
const _mapId = (map) => path.basename(String(map)).replace(/-phasemap\.spec$/, '').replace(/\.spec$/, '');

/** the ids a spec declares (modules, schemas, interfaces, by id and by name), through emerge's own knowledge-graph builder */
function specIds(specPath) {
  const yaml = require('js-yaml');
  const raw = yaml.load(fs.readFileSync(specPath, 'utf8'));
  const { build } = require('./kg-builder.js');
  const r = build(raw && raw.spec ? raw.spec : raw);
  if (!r || !r.ok) throw new Error(`the spec did not build: ${(r && r.error) || 'kg-builder returned no graph'}`);
  const ids = new Set();
  const nodes = r.graph.nodes instanceof Map ? [...r.graph.nodes.values()] : (r.graph.nodes || []);
  for (const n of nodes) if (!n.isBlack) { ids.add(n.id); if (n.name) ids.add(n.name); }
  return ids;
}

function _ownerDir(owner, SYS) {
  if (!owner || owner === 'core') return 'lib';
  try { const s = SYS.get(owner); const r = s && (s.roots || s.dirs); if (r && r.length) return r[0]; } catch (_) {}
  return 'lib';
}

/** the phasemaps of a tree: docs/*-phasemap.spec, plus the one asked for when it sits elsewhere */
function _maps(root, mapsDir, extra = null) {
  const maps = fs.readdirSync(mapsDir).filter(f => f.endsWith('-phasemap.spec'))
    .map(f => { const p = path.relative(root, path.join(mapsDir, f)).split(path.sep).join('/'); return { path: p, text: fs.readFileSync(path.join(root, p), 'utf8') }; });
  if (extra && !maps.some(m => m.path === extra)) maps.push({ path: extra, text: fs.readFileSync(path.join(root, extra), 'utf8') });
  return maps;
}

/** agent mappings kept by SL8 (idearium/data/phase-mapping/*.agent-maps.json), merged by phase key; the newest answer wins */
function keptAgentMaps(root = ROOT) {
  const dir = path.join(root, 'idearium', 'data', 'phase-mapping');
  const out = {};
  let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.agent-maps.json')); } catch (_) { return out; }
  for (const f of files) {
    let all = {}; try { all = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    for (const [k, m] of Object.entries(all)) if (m && (m.files || []).length && (!out[k] || (m.at || 0) > (out[k].at || 0))) out[k] = m;
  }
  return out;
}

/**
 * _core — §0.60.229 SL9: one DAG for every map (MP1's mapping in it, SL8's kept agent mappings where MP1 placed nothing), then each
 * phase's nodes. The .phase keeps what its map authors (declared depends_on); the .graph is derived: files with roles, crossings, and
 * its slice of the DAG with every edge's kind (declared, inferred from a shared file, or agent:<by>). Owner: the system of its files,
 * else the system most of its map's phases belong to, else its map's loom tags, else lib/ (core). Findings and decisions are not phases.
 */
function _core({ root = ROOT, maps, only = null, mappings = null } = {}) {
  const PD = require('../../phase-dag.js'), PF = require('../../phase-files.js'), PMA = require('../../phase-map-auto.js');
  const PG = require('../../phase-graph.js'), PN = require('../../pipeline-nodes.js'), PP = require('../../phase-plan.js');
  const SYS = require('../../nexus-self/systems.js');
  const mp = {}; for (const [k, m] of PMA.forMaps({ root, maps }).byKey) mp[k] = m;
  const agent = mappings || {};
  for (const [k, m] of Object.entries(agent)) if (!(mp[k] && (mp[k].files || []).length)) {
    mp[k] = { source: 'agent', by: m.by, files: m.files, requires: [], consumers: [], specs: [], dependsOnInferred: (m.dependsOn || []).map(x => ({ on: String(x).split('::').pop(), key: x, by: m.by })) };
  }
  const dag = PD.build(maps, { mapped: mp });
  const edgeKind = new Map(dag.edges.map(e => [`${e.from}>${e.to}`, e.kind]));
  const systemOf = PG.boundarySystemOf(root);
  let baseline = null; try { baseline = PG.baselineEdges(root); } catch (_) { baseline = null; }
  const ownerOfFiles = (files) => PP.targetSystem({ files, tags: [], ownerOf: SYS.ownerOf, tagSystem: SYS.systemForLoomTag }).system || null;
  const loom = { parsePhasemapText: require('../../phase-dag.js').parsePhasemap };   // loom's reader through lib (emerge uses the kernel; no emerge → loom crossing)
  const specCache = new Map(), out = [];
  for (const m of maps) {
    if (only && m.path !== only) continue;
    const parsed = new Map(loom.parsePhasemapText(m.text, m.path).map(p => [p.id, p]));
    const seenIds = new Set();   // the first entry of an id is the phase (lib/phase-dag.js, the roadmap)
    const phases = PF.phasesOf(m.text, m.path).filter(ph => { const p = parsed.get(ph.id); if (p && p.kind) return false; if (seenIds.has(ph.id)) return false; seenIds.add(ph.id); return true; });
    // the map's own owner: the system most of its phases' files belong to, else its loom tags
    const votes = new Map();
    for (const ph of phases) { const n = dag.nodes[`${m.path}::${ph.id}`]; const o = n && n.files.length ? ownerOfFiles(n.files) : null; if (o && o !== 'core') votes.set(o, (votes.get(o) || 0) + 1); }
    let mapOwner = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    mapOwner = mapOwner ? mapOwner[0] : null;
    if (!mapOwner) { for (const p of parsed.values()) { for (const t of p.systems || []) { const sy = SYS.systemForLoomTag(t); if (sy && sy !== 'core') { mapOwner = sy; break; } } if (mapOwner) break; } }
    for (const ph of phases) {
      const key = `${m.path}::${ph.id}`;
      const node = dag.nodes[key];
      const spec = _field(ph.body, 'spec');
      const blocks = _list(_field(ph.body, 'blocks'));
      let ids = null, specError = null;
      if (spec) {
        if (!specCache.has(spec)) { try { specCache.set(spec, { ids: specIds(path.join(root, spec)) }); } catch (e) { specCache.set(spec, { error: e.message }); } }
        const c = specCache.get(spec); ids = c.ids || null; specError = c.error || null;
      }
      const resolved = ids ? blocks.filter(b => ids.has(b)) : [];
      const missing = ids ? blocks.filter(b => !ids.has(b)) : blocks.slice();
      const mapped = mp[key] || PMA.mapPhase(ph, {});
      const graph = PG.graphFor({ phase: ph.id, map: m.path, mapped, mapText: m.text, depsGate: null, systemOf, baselineEdges: baseline });
      const slice = node ? PD.slice(dag, key) : null;
      // the whole DAG's hash is not stored per phase: it changes with any phase anywhere, and every .graph would be rewritten on every map
      // edit; the phase's own slice is what it depends on (the hash is in each owner's INDEX.md)
      if (slice) graph.dag = { layer: slice.layer, deps: slice.deps, dependents: slice.dependents, upstream: slice.upstream, downstream: slice.downstream,
        blockedBy: slice.blockedBy, unlocks: slice.unlocks, conflicts: slice.conflicts, dangling: slice.dangling, ...(slice.prose && slice.prose.length ? { prose: slice.prose } : {}), lines: PD.lines(slice).map(l => l.replace(/^DAG [0-9a-f]+ · /, '')),
        edges: slice.deps.map(d => ({ from: d, kind: edgeKind.get(`${d}>${key}`) === 'inferred' ? ((mp[key] && mp[key].source === 'agent') ? mp[key].by : 'inferred') : 'declared' })) };
      if (mapped && mapped.source === 'agent') graph.mappedBy = mapped.by;
      const files = node ? node.files : [];
      const owner = (files.length ? ownerOfFiles(files) : null) || mapOwner || 'core';
      const dir = path.join(_ownerDir(owner, SYS), 'phases', _mapId(m.path));
      const graphEnv = PN.graphNode({ ...graph, for: ph.id }, { kind: 'phase' });
      if (graph.mappedBy) graphEnv.payload.mappedBy = graph.mappedBy;
      const declared = node ? node.deps.filter(d => edgeKind.get(`${d}>${key}`) === 'declared').map(d => d.split('::').pop()) : _list(_field(ph.body, 'depends_on'));
      const phaseEnv = PN.phaseNode({ id: ph.id, map: m.path, layer: _field(ph.body, 'layer'), status: _field(ph.body, 'status') || 'OPEN',
        files: (ph.files && ph.files.length) ? ph.files : files, depends_on: declared, blocks, spec, graph: graph.hash });
      out.push({ phase: ph.id, key, map: m.path, owner, dir, ready: graph.ready, graphHash: graph.hash, graphEnv, phaseEnv,
        status: node ? node.status : 'pending', done: node ? node.done : false, layer: node ? node.layer : null, blockedBy: slice ? slice.blockedBy : [],
        source: (mapped && mapped.source) || 'none', blocks: { resolved, missing, ...(specError ? { specError } : {}) } });
    }
  }
  return { rows: out, dag };
}

/** derive(...) → per phase of one map: the nodes to write, without writing them */
function derive({ root = ROOT, map, mapsDir = path.join(root, 'docs'), mappings = null } = {}) {
  const mapRel = path.relative(root, path.resolve(root, map)).split(path.sep).join('/');
  return _core({ root, maps: _maps(root, mapsDir, mapRel), only: mapRel, mappings: mappings || keptAgentMaps(root) }).rows;
}

// a node is written only when its payload changed (exported_at would make every pass a change: SL9 "a second --all changes nothing");
// an older .graph of the same phase (another hash) moves to graph/_superseded/, never deleted (§0.3)
function _writeRow(d, out) {
  const NE = require('../../node-export.js');
  const abs = path.join(out, d.dir);
  let changed = 0, superseded = 0;
  const put = (env, file) => {
    NE.validate(env);
    try { const on = NE.fromYaml(fs.readFileSync(file, 'utf8')); if (JSON.stringify(on.payload) === JSON.stringify(env.payload)) return file; } catch (_) {}
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, NE.toYaml(env), 'utf8'); changed++; return file;
  };
  const gdir = path.join(abs, 'graph');
  const graphFile = put(d.graphEnv, path.join(gdir, `${d.phase}-${d.graphHash}.graph`));
  try {
    for (const f of fs.readdirSync(gdir)) {
      if (f === path.basename(graphFile) || !f.endsWith('.graph') || !f.startsWith(`${d.phase}-`) || !/^[0-9a-f]{16}\.graph$/.test(f.slice(d.phase.length + 1))) continue;
      fs.mkdirSync(path.join(gdir, '_superseded'), { recursive: true }); fs.renameSync(path.join(gdir, f), path.join(gdir, '_superseded', f)); superseded++;
    }
  } catch (_) {}
  const phaseFile = put(d.phaseEnv, path.join(abs, `${d.phase}.phase`));
  return { phase: d.phase, owner: d.owner, ready: d.ready, graphHash: d.graphHash, blocks: d.blocks, changed, superseded,
    phaseFile: path.relative(out, phaseFile).split(path.sep).join('/'), graphFile: path.relative(out, graphFile).split(path.sep).join('/') };
}

function write(opts = {}) {
  const out = opts.out || opts.root || ROOT;   // out: where the nodes go (default the tree itself)
  return derive(opts).map(d => _writeRow(d, out));
}

/**
 * writeAll({ root, out, mapsDir, mappings }) — SL9: every phase of every phasemap, one DAG; each system's phases/INDEX.md.
 * → { written, changed, superseded, bySystem: { system: n }, skipped: [{ map, why }], dagHash }
 */
function writeAll({ root = ROOT, out = null, mapsDir = path.join(root, 'docs'), mappings = null } = {}) {
  out = out || root;
  const maps = [], skipped = [];
  for (const m of _maps(root, mapsDir)) { try { require('../../phase-dag.js').parsePhasemap(m.text, m.path); maps.push(m); } catch (e) { skipped.push({ map: m.path, why: e.message }); } }
  const { rows, dag } = _core({ root, maps, mappings: mappings || keptAgentMaps(root) });
  // a .phase already in the tree for the same map::phase at another place (its owner changed: the old per-map pass had no mapping) moves,
  // with its graphs, to _archive/phases-moved/<its old path> — kept, said (§0.3); a .phase whose phase is in no map is listed, left in place
  const NE = require('../../node-export.js');
  const want = new Map(rows.map(d => [`${d.map}::${d.phase}`, path.join(d.dir, `${d.phase}.phase`).split(path.sep).join('/')]));
  // entries their map holds as a decision or a finding are not phases (loom, 0.60.225/0.60.227): an old .phase of one is archived too
  const notPhase = new Set(); for (const m of maps) for (const p of require('../../phase-dag.js').parsePhasemap(m.text, m.path)) if (p.kind) notPhase.add(`${m.path}::${p.id}`);
  const moved = [], orphaned = [];
  const phaseDirs = [];
  try { for (const top of fs.readdirSync(out, { withFileTypes: true })) if (top.isDirectory() && !/^(\.|node_modules$|_archive$|data$)/.test(top.name)) { const pd = path.join(out, top.name, 'phases'); if (fs.existsSync(pd)) phaseDirs.push(pd); } } catch (_) {}
  for (const pd of phaseDirs) for (const md of fs.readdirSync(pd, { withFileTypes: true })) {
    if (!md.isDirectory() || md.name.startsWith('_')) continue;
    for (const f of fs.readdirSync(path.join(pd, md.name)).filter(x => x.endsWith('.phase'))) {
      const abs = path.join(pd, md.name, f), rel = path.relative(out, abs).split(path.sep).join('/');
      let pl = null; try { pl = NE.fromYaml(fs.readFileSync(abs, 'utf8')).payload; } catch (_) { continue; }
      const k = `${pl.map}::${pl.id}`, to = want.get(k);
      if (!to && !notPhase.has(k)) { orphaned.push(rel); continue; }
      if (to === rel) continue;
      const arch = path.join(out, '_archive', 'phases-moved');
      const mv = (src) => { const dst = path.join(arch, path.relative(out, src)); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.renameSync(src, dst); };
      mv(abs);
      const gd = path.join(pd, md.name, 'graph');
      try { for (const g of fs.readdirSync(gd)) if (g.startsWith(`${pl.id}-`) && g.endsWith('.graph')) mv(path.join(gd, g)); } catch (_) {}
      moved.push({ from: rel, to: to || null, ...(to ? {} : { why: 'its map holds it as a decision or a finding, not a phase' }) });
    }
  }
  const res = rows.map(d => _writeRow(d, out));
  const bySystem = {};
  for (const d of rows) bySystem[d.owner] = (bySystem[d.owner] || 0) + 1;
  // each owner's phases/INDEX.md — deterministic (no clock): by map, in DAG order
  const byDir = new Map();
  for (const d of rows) { const k = path.dirname(d.dir); if (!byDir.has(k)) byDir.set(k, []); byDir.get(k).push(d); }
  for (const [dir, list] of byDir) {
    const sys = list[0].owner;
    const byMap = new Map(); for (const d of list) { if (!byMap.has(d.map)) byMap.set(d.map, []); byMap.get(d.map).push(d); }
    const open = list.filter(d => !d.done);
    const L = [`# ${sys === 'core' ? 'core (lib/)' : sys} — its phases`, '',
      `Generated by \`node lib/emerge/compiler/phase-specs.js --all\` (SL9) from the phasemaps in docs/. The maps are the source; each \`.phase\` holds what its map authors, and each \`graph/<phase>-<hash>.graph\` its files, crossings and slice of the whole DAG (DAG ${dag.hash}). Do not edit these by hand: edit the map, then run it again.`, '',
      `${list.length} phases from ${byMap.size} maps · ${open.length} open · ${open.filter(d => !d.blockedBy.length && d.ready).length} open with every dependency closed and a graph`, ''];
    for (const [map, ds] of [...byMap].sort((a, b) => a[0].localeCompare(b[0]))) {
      L.push(`## ${_mapId(map)}`, '', '| phase | status | layer | graph | waits on |', '| --- | --- | --- | --- | --- |');
      for (const d of [...ds].sort((a, b) => (a.layer ?? 99) - (b.layer ?? 99) || a.phase.localeCompare(b.phase))) {
        L.push(`| [${d.phase}](${_mapId(map)}/${d.phase}.phase) | ${d.done ? 'done' : d.status} | ${d.layer ?? '—'} | ${d.ready ? `${d.source === 'agent' ? 'agent-mapped' : d.source}` : 'none'} | ${d.blockedBy.map(k => k.split('::').pop()).join(', ') || '—'} |`);
      }
      L.push('');
    }
    const file = path.join(out, dir, 'INDEX.md'), text = L.join('\n');
    let had = null; try { had = fs.readFileSync(file, 'utf8'); } catch (_) {}
    if (had !== text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, 'utf8'); }
  }
  return { written: res.length, changed: res.filter(r => r.changed).length, superseded: res.reduce((a, r) => a + r.superseded, 0), moved, orphaned, bySystem, skipped, dagHash: dag.hash, rows: res };
}

/** checkAll(opts) — every phase's drift, as check() does for one map */
function checkAll({ root = ROOT, out = null, mapsDir = path.join(root, 'docs'), mappings = null } = {}) {
  const NE = require('../../node-export.js');
  const base = out || root;
  const { rows } = _core({ root, maps: _maps(root, mapsDir), mappings: mappings || keptAgentMaps(root) });
  return rows.map(d => {
    const drift = [];
    const pf = path.join(base, d.dir, `${d.phase}.phase`), gf = path.join(base, d.dir, 'graph', `${d.phase}-${d.graphHash}.graph`);
    if (!fs.existsSync(pf)) drift.push('no .phase written');
    else { const on = NE.fromYaml(fs.readFileSync(pf, 'utf8')); if (JSON.stringify(on.payload) !== JSON.stringify(d.phaseEnv.payload)) drift.push('the .phase differs from what the map and tree give now'); }
    if (!fs.existsSync(gf)) drift.push(`no .graph for hash ${d.graphHash}`);
    return { phase: d.phase, key: d.key, drift };
  });
}

/** check(...) — re-derive; a .phase or .graph that differs from what the tree derives now is drift, said per phase */
function check(opts = {}) {
  const root = opts.out || opts.root || ROOT;
  const NE = require('../../node-export.js');
  return derive(opts).map(d => {
    const drift = [];
    const pf = path.join(root, d.dir, `${d.phase}.phase`);
    const gf = path.join(root, d.dir, 'graph', `${d.phase}-${d.graphHash}.graph`);
    if (!fs.existsSync(pf)) drift.push('no .phase written');
    else { const on = NE.fromYaml(fs.readFileSync(pf, 'utf8')); if (JSON.stringify(on.payload) !== JSON.stringify(d.phaseEnv.payload)) drift.push('the .phase differs from what the map and tree give now'); }
    if (!fs.existsSync(gf)) drift.push(`no .graph for hash ${d.graphHash} (the graph changed, or was never written)`);
    if (d.blocks.missing.length) drift.push(`blocks not in the spec: ${d.blocks.missing.join(', ')}`);
    if (d.blocks.specError) drift.push(`spec unreadable: ${d.blocks.specError}`);
    return { phase: d.phase, drift };
  });
}

if (require.main === module) {
  const args = process.argv.slice(2); const map = args.find(a => !a.startsWith('--'));
  if (args.includes('--all')) {   // §0.60.229 SL9 — every phase of every map, one DAG
    const quiet = console.log; console.log = () => {};
    let r; try { r = args.includes('--check') ? checkAll({}) : writeAll({}); } finally { console.log = quiet; }
    if (Array.isArray(r)) { const bad = r.filter(x => x.drift.length); for (const x of bad.slice(0, 40)) console.log(`✗ ${x.key}  ${x.drift.join(' · ')}`); console.log(`${r.length} phases checked · ${bad.length} with drift`); process.exit(bad.length ? 1 : 0); }
    console.log(`${r.written} phases · ${r.changed} written or changed · ${r.superseded} older graphs moved to _superseded · ${r.moved.length} old copies moved to _archive/phases-moved (a new owner, or no longer a phase) · DAG ${r.dagHash}`);
    for (const o of r.orphaned) console.log(`orphaned (its phase is in no map; left in place): ${o}`);
    console.log(Object.entries(r.bySystem).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
    for (const sk of r.skipped) console.log(`skipped ${sk.map}: ${sk.why}`);
    process.exit(0);
  }
  if (!map) { console.error('usage: node lib/emerge/compiler/phase-specs.js <map.spec> [--check] | --all [--check]'); process.exit(2); }
  const quiet = console.log; console.log = () => {};
  let rows; try { rows = args.includes('--check') ? check({ map }) : write({ map }); } finally { console.log = quiet; }
  for (const r of rows) console.log(r.drift ? `${r.drift.length ? '✗' : '✓'} ${r.phase}${r.drift.length ? `  ${r.drift.join(' · ')}` : ''}`
    : `${r.ready ? '✓' : '·'} ${r.phase} → ${r.phaseFile}  (${r.owner}; graph ${r.graphHash}${r.blocks.missing.length ? `; MISSING blocks ${r.blocks.missing.join(', ')}` : ''})`);
  process.exit(rows.some(r => (r.drift && r.drift.length) || (r.blocks && r.blocks.missing.length)) ? 1 : 0);
}

module.exports = { MODULE_ID, VERSION, specIds, derive, write, check, writeAll, checkAll, keptAgentMaps };
