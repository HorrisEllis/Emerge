'use strict';
// tests/compiler-door.test.js — Emerge's spec compiler through its own door (EAS4 L1). Nexus docs/2026-10-31-emerge-as-a-system-phasemap.spec.
// Every call goes over HTTP to server.js, as another system would make it; the comparison runs compiler/index.js directly.
//
//   CD-01  the contract lists POST /compiler/compile, and its command node states its expectation (in, out, fails)
//   CD-02  a spec through the door gives byte for byte the files compile() writes for it on disk (SPEC_COMPILER.spec, T0+T1)
//   CD-03  a missing spec is a 400 that names it; a spec the compiler refuses is ok:false with its error, never a partial ok
//   CD-04  the door keeps the shape: every component has a capability, a command and events
//   CD-05  build with a host named by its routes (EAS_D9): Emerge POSTs preflight, writeback and sync to them; files come back
//   CD-06  a host route that does not answer is said, never taken as a pass; build without a host uses the local host
//   CD-07  run with a model named by its route: every T2 node's prompt reaches the route, each result kept with its reason; progress listed
//   CD-08  a host or model given as a path (a module) is refused at the door: only settings cross it
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { start } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const SPEC = path.join(ROOT, 'SPEC_COMPILER.spec');

function call(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(s) }); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end(data);
  });
}
function files(dir, base = dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, base, out); else out[path.relative(base, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
  }
  return out;
}

let passed = 0, failed = 0;
async function t(id, desc, fn) { try { await fn(); console.log(`  ✓ ${id} ${desc}`); passed++; } catch (e) { console.error(`  ✗ ${id} ${desc}\n    ${e.stack.split('\n').slice(0, 4).join('\n    ')}`); failed++; } }

(async () => {
  console.log('\ncompiler-door — Emerge\'s spec compiler through its own door');
  const { server, port, ctx } = await start({ port: 0, root: ROOT });
  try {
    await t('CD-01', 'the contract lists POST /compiler/compile; its command states in, out and fails', async () => {
      const c = (await call(port, 'GET', '/contract')).body;
      assert.ok(c.resources.some(r => r.method === 'POST' && r.path === '/compiler/compile'), 'the route is in the contract');
      const cmd = ctx.index.get('command', 'emerge.compiler.compile');
      const ex = (cmd && (cmd.expects || (cmd.payload && cmd.payload.expects))) || {};
      for (const k of ['in', 'out', 'fails']) assert.ok(typeof ex[k] === 'string' && ex[k].length > 10, `expects.${k} is stated`);
    });

    await t('CD-02', 'through the door: byte for byte the files compile() writes on disk', async () => {
      const r = (await call(port, 'POST', '/compiler/compile', { spec: fs.readFileSync(SPEC, 'utf8'), name: 'SPEC_COMPILER.spec' })).body;
      assert.ok(r.ok, JSON.stringify(r).slice(0, 300));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-direct-'));
      try {
        const log = console.log; console.log = () => {};
        let d; try { d = await require('../compiler/index.js').compile(SPEC, dir, { tier: 1, skipCortex: true }); } finally { console.log = log; }
        assert.ok(d.ok);
        const want = files(dir), emitted = [...new Set([...d.t0.emitted, ...d.t1.emitted])].sort();
        assert.deepStrictEqual(Object.keys(r.files), emitted, 'the same files');
        for (const rel of emitted) assert.strictEqual(r.files[rel], want[rel], `${rel} is the same bytes`);
        assert.ok(emitted.length > 20, `a whole package (${emitted.length} files)`);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

    await t('CD-03', 'a missing spec is a 400 naming it; a refused spec is ok:false with its error', async () => {
      const miss = await call(port, 'POST', '/compiler/compile', {});
      assert.strictEqual(miss.status, 400); assert.match(JSON.stringify(miss.body), /spec/);
      const bad = (await call(port, 'POST', '/compiler/compile', { spec: 'not: [a, module, spec' })).body;
      assert.strictEqual(bad.ok, false); assert.ok(bad.error, 'the compiler\'s own words'); assert.ok(!bad.files, 'no partial files');
    });

    // a stand-in for another system: answers Emerge's host and model contracts, and records what it was asked
    const seen = [];
    const stand = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const body = b ? JSON.parse(b) : {}; seen.push({ path: req.url, body });
      const reply = req.url === '/preflight' ? { ok: true, existingFiles: [], openGaps: [], skipGeneration: false, summary: 'stand-in preflight' }
        : req.url === '/generate' ? { ok: true, text: '// stand-in T2 body', prompt_tokens: 1, output_tokens: 1 } : { ok: true, from: 'stand-in', path: req.url };
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply)); }); });
    await new Promise(r => stand.listen(0, '127.0.0.1', r));
    const S = `http://127.0.0.1:${stand.address().port}`;
    const host = { name: 'stand-in', preflight: `${S}/preflight`, writeback: `${S}/writeback`, sync: `${S}/sync` };
    const spec = fs.readFileSync(SPEC, 'utf8');

    await t('CD-05', 'build with a host named by its routes: preflight, writeback and sync are POSTed; files come back', async () => {
      seen.length = 0;
      const r = (await call(port, 'POST', '/compiler/build', { spec, name: 'SPEC_COMPILER.spec', host })).body;
      assert.ok(r.ok, JSON.stringify(r).slice(0, 300));
      const paths = seen.map(x => x.path);
      for (const p of ['/preflight', '/writeback', '/sync']) assert.ok(paths.includes(p), `${p} was called (${paths.join(', ')})`);
      assert.ok(Object.keys(r.files).length > 20, 'the package came back');
      assert.ok(r.t1 && r.t1.emitted.length > 0 && r.t1.emitted.every(f => f in r.files), 'T1\'s emitted list names files that came back');
    });

    await t('CD-06', 'a host route that does not answer is said; without a host the local host builds', async () => {
      const dead = { name: 'dead', preflight: 'http://127.0.0.1:1/preflight' };
      const r = (await call(port, 'POST', '/compiler/build', { spec, host: dead })).body;
      assert.match(JSON.stringify(r), /unreachable|refused|ECONNREFUSED/, 'the dead route is named in the result');
      const local = (await call(port, 'POST', '/compiler/build', { spec })).body;
      assert.ok(local.ok && Object.keys(local.files).length > 20, JSON.stringify(local).slice(0, 200));
    });

    await t('CD-07', 'run with a model named by its route: each T2 prompt reaches it; results and progress come back', async () => {
      seen.length = 0;
      const r = (await call(port, 'POST', '/compiler/run', { spec, host, model: { api: 'route', url: `${S}/generate`, extra: { provider: 'ollama' } } })).body;
      assert.ok(r.stage, JSON.stringify(r).slice(0, 300));
      assert.ok(Array.isArray(r.progress) && r.progress.some(p => p.status === 'compiled'), 'progress is listed');
      if (r.stage === 'complete') {
        const asked = seen.filter(x => x.path === '/generate');
        assert.strictEqual(asked.length, r.t2.dispatched, 'every T2 node asked the route once');
        assert.ok(asked.every(x => typeof x.body.prompt === 'string' && x.body.prompt.length > 50), 'each with its prompt');
        assert.ok(asked.every(x => x.body.provider === 'ollama'), 'the route\'s extra fields go with every prompt');
        assert.strictEqual(r.t2.results.length, r.t2.dispatched, 'every node has its result, none dropped');
        assert.ok(r.t2.results.every(x => x.status), 'each result says what happened');
      } else assert.strictEqual(r.stage, 'compile_only', 'no T2 nodes in this spec is said, not hidden');
    });

    await t('CD-08', 'a host or a model given as a path is refused at the door', async () => {
      const a = await call(port, 'POST', '/compiler/build', { spec, host: '/etc/some-host.js' });
      assert.strictEqual(a.status, 400); assert.match(JSON.stringify(a.body), /host/);
      const b = await call(port, 'POST', '/compiler/run', { spec, model: './a-model.js' });
      assert.strictEqual(b.status, 400); assert.match(JSON.stringify(b.body), /model/);
    });
    await t('CD-09', 'compile with a host by route: preflight and writeback POSTed; the same files as without one', async () => {
      seen.length = 0;
      const withHost = (await call(port, 'POST', '/compiler/compile', { spec, name: 'SPEC_COMPILER.spec', host })).body;
      const plain = (await call(port, 'POST', '/compiler/compile', { spec, name: 'SPEC_COMPILER.spec' })).body;
      assert.ok(withHost.ok && plain.ok, JSON.stringify(withHost).slice(0, 200));
      const paths = seen.map(x => x.path);
      assert.ok(paths.includes('/preflight') && paths.includes('/writeback'), paths.join(', '));
      assert.deepStrictEqual(Object.keys(withHost.files).filter(k => !k.startsWith('.emerge/')), Object.keys(plain.files).filter(k => !k.startsWith('.emerge/')), 'the same files');
      assert.ok(withHost.cortex !== undefined && withHost.writeback !== undefined, 'the host\'s answers come back');
      const bad = await call(port, 'POST', '/compiler/compile', { spec, host: './h.js' });
      assert.strictEqual(bad.status, 400);
    });
    stand.close();

    await t('CD-04', 'every component keeps the shape: a capability, a command and events', async () => {
      assert.deepStrictEqual(ctx.shape(), []);
    });
  } finally { server.close(); }
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
