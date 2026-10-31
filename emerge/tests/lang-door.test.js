'use strict';
// tests/lang-door.test.js — Emerge's language through its own door (EAS2). Nexus docs/emerge-system.spec MOD-EAS-LANG-DOOR.
// Every call goes over HTTP to server.js, as another system would make it; nothing here requires lib/lang.js.
//
//   LD-01  the contract lists the six language routes
//   LD-02  check: an error comes back with its line and column; good source checks clean
//   LD-03  run and test: a program runs and prints; its test blocks pass
//   LD-04  build: CommonJS comes back as files, and the built module runs
//   LD-05  say: his words become Emerge, no model
//   LD-06  synth through the door gives byte for byte what synth.eg gives on the command line (utf8_decode's six units)
//   LD-07  a program that never ends is killed at its timeout; the door keeps answering
//   LD-08  a missing field is a 400 that names it
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const { start } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const UNITS = path.join(ROOT, '..', 'bench', 'chunks', 'utf8_decode', 'chunks.spec');

function call(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(s) }); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end(data);
  });
}

let passed = 0, failed = 0;
async function t(id, desc, fn) { try { await fn(); console.log(`  ✓ ${id} ${desc}`); passed++; } catch (e) { console.error(`  ✗ ${id} ${desc}\n    ${e.stack.split('\n').slice(0, 4).join('\n    ')}`); failed++; } }

(async () => {
  console.log('\nlang-door — Emerge\'s language through its own door');
  const { server, port } = await start({ port: 0, root: ROOT });
  const post = (verb, body) => call(port, 'POST', `/lang/${verb}`, body);
  try {
    await t('LD-01', 'the contract lists the six language routes', async () => {
      const c = (await call(port, 'GET', '/contract')).body;
      const lang = c.resources.filter(r => r.path && r.path.startsWith('/lang/')).map(r => `${r.method} ${r.path}`).sort();
      assert.deepStrictEqual(lang, ['build', 'check', 'run', 'say', 'synth', 'test'].map(v => `POST /lang/${v}`));
    });

    await t('LD-02', 'check: an error with its line and column; good source is clean', async () => {
      const bad = (await post('check', { source: 'let x = ' })).body;
      assert.strictEqual(bad.ok, false);
      assert.match(bad.stderr, /main\.eg:1:9: error/);
      const good = (await post('check', { source: 'let x = 1 + 2\nprint("{x}")\n' })).body;
      assert.strictEqual(good.ok, true, good.stderr);
    });

    await t('LD-03', 'run prints; test blocks pass', async () => {
      const r = (await post('run', { source: 'let a = args()\nprint("hello {a[0]}")\n', args: ['James'] })).body;
      assert.strictEqual(r.ok, true, r.stderr);
      assert.strictEqual(r.stdout.trim(), 'hello James');
      const tr = (await post('test', { source: 'fn double(n) = n * 2\ntest "double" {\n  expect double(4) == 8\n}\n' })).body;
      assert.strictEqual(tr.ok, true, tr.stdout + tr.stderr);
    });

    await t('LD-04', 'build: CommonJS comes back as files, and runs', async () => {
      const r = (await post('build', { source: 'fn triple(n) = n * 3\nprint("{triple(5)}")\n', standalone: true })).body;
      assert.strictEqual(r.ok, true, r.stderr);
      const names = Object.keys(r.files);
      const main = names.find(n => /^main\.js$/.test(path.basename(n)));
      assert.ok(main, `no main.js in ${names.join(', ')}`);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-door-'));
      try {
        for (const [n, text] of Object.entries(r.files)) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), text); }
        const out = spawnSync(process.execPath, [path.join(dir, main)], { encoding: 'utf8' });
        assert.strictEqual(out.status, 0, out.stderr);
        assert.strictEqual(out.stdout.trim(), '15');
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

    await t('LD-05', 'say: his words become Emerge, no model', async () => {
      const r = (await post('say', { sentence: 'a sovereign system called Vault holding coins, at most 100 coins, log it' })).body;
      assert.strictEqual(r.ok, true, r.stdout + r.stderr);
      const eg = Object.entries(r.files).find(([n]) => n.endsWith('.eg'));
      assert.ok(eg, `no .eg written: ${Object.keys(r.files).join(', ')}`);
      assert.match(eg[1], /Vault/);
      // a word not in his vocabulary is a gap, said, and nothing is guessed or written
      const gap = (await post('say', { sentence: 'a compartment called Pantry holding jars. whenever a jar lands, bump jars' })).body;
      assert.strictEqual(gap.ok, false);
      assert.match(gap.stdout + gap.stderr, /"bump" is not in your words yet/);
      assert.deepStrictEqual(gap.files, {});
    });

    await t('LD-06', 'synth through the door = synth.eg on the command line, byte for byte', async () => {
      const spec = yaml.load(fs.readFileSync(UNITS, 'utf8')).spec;
      const units = spec.units.map(u => ({ id: u.id, signature: u.signature, derive: u.derive }));
      const r = (await post('synth', { units })).body;
      assert.strictEqual(r.ok, true, r.stderr);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-door-synth-'));
      try {
        fs.writeFileSync(path.join(dir, 'units.json'), JSON.stringify(units));
        fs.mkdirSync(path.join(dir, 'out'));
        const cli = spawnSync(process.execPath, [path.join(ROOT, 'lang', 'eg.js'), 'run', path.join(ROOT, 'lang', 'cie', 'synth.eg'), 'units.json', 'out'], { cwd: dir, encoding: 'utf8' });
        assert.strictEqual(cli.status, 0, cli.stderr);
        assert.strictEqual(r.stdout, cli.stdout, 'the same records (form, rung, boundary hash, code hash)');
        assert.deepStrictEqual(Object.keys(r.files).sort(), units.map(u => `${u.id}.eg`).sort());
        for (const u of units) assert.strictEqual(r.files[`${u.id}.eg`], fs.readFileSync(path.join(dir, 'out', `${u.id}.eg`), 'utf8'), u.id);
        assert.match(r.stdout, /6 written, 0 gaps, 0 model calls/);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

    await t('LD-07', 'a program that never ends is killed at its timeout; the door keeps answering', async () => {
      const r = (await post('run', { source: 'var i = 0\nwhile true { i += 1 }\n', timeoutMs: 1500 })).body;
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.timedOut, true);
      assert.ok(r.ms < 10000, `took ${r.ms} ms`);
      assert.strictEqual((await call(port, 'GET', '/health')).body.ok, true);
    });

    await t('LD-08', 'a missing field is a 400 that names it', async () => {
      const r = await post('build', {});
      assert.strictEqual(r.status, 400);
      assert.match(r.body.error, /missing source/);
      assert.match((await post('synth', { units: [] })).body.error, /missing units/);
    });
  } finally {
    server.close();
  }
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
