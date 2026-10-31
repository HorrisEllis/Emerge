'use strict';
/**
 * build-spec.test.js — build-spec.js end to end with nothing but Emerge and a fake local model server (Ollama API).
 *
 *   1. dry run: plan printed, open decisions listed with the modules waiting on them, nothing written to the build root
 *   2. scaffold run: .eg files in the build root, a deterministic build record in <root>/.emerge/build/, codegen.eg kept
 *   3. --build: valid answers replace scaffolds, a broken answer is rejected beside the scaffold, the hand-written file
 *      gets a proposal, and the build record lists what T2 did
 *   4. the same through the OpenAI-compatible API
 *   5. no network besides the model server: no Cortex, Idearium or Guardian is contacted
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SPEC = path.join(ROOT, 'spec', 'cie-eg.spec');
let p = 0, f = 0;
function check(label, cond, detail) { if (cond) { p++; process.stdout.write('.'); } else { f++; console.log('\nFAIL [' + label + ']' + (detail ? ': ' + detail : '')); } }

const answer = mod => mod === 'gate' ? 'fn gate_emit(from: string): bool {\n  return (\n}' : mod === 'native' ? 'fn codegen_note(): string = "proposal"' : `fn ${mod}_ready(): bool = true`;

function fakeModelServer() {
  const seen = [];
  const s = http.createServer((req, res) => {
    let d = ''; req.on('data', c => d += c); req.on('end', () => {
      seen.push(req.url);
      const body = JSON.parse(d || '{}');
      const prompt = body.messages?.[0]?.content ?? '';
      const mod = (prompt.match(/^# T2 IMPLEMENTATION — (\S+)/m) || [])[1];
      const text = '```eg\n' + answer(mod) + '\n```';
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/chat') return res.end(JSON.stringify({ message: { content: text }, prompt_eval_count: 10, eval_count: 5 }));
      if (req.url === '/v1/chat/completions') return res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
      res.statusCode = 404; res.end('{}');
    });
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r({ seen, url: 'http://127.0.0.1:' + s.address().port, close: () => s.close() })));
}

function run(args, env = {}) {
  return new Promise(resolve => {
    const c = spawn(process.execPath, [path.join(ROOT, 'build-spec.js'), ...args], { cwd: os.tmpdir(),
      env: { ...process.env, IDEARIUM_PORT: '1', NEXUS_PORT: '1', GUARDIAN_PORT: '1', ...env } });   // anything Nexus would fail loudly
    let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    c.on('close', code => resolve({ code, out }));
  });
}

function repoCopy() {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'build-spec-'));
  fs.cpSync(path.join(ROOT, 'lang', 'native'), path.join(dst, 'emerge', 'lang', 'native'), { recursive: true });
  return dst;
}

(async () => {
  const model = await fakeModelServer();

  // 1. dry run
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'build-spec-root-'));
  const r1 = await run([SPEC, '--dry-run', '--out', empty]);
  check('dry run exits 0', r1.code === 0, r1.out.slice(-300));
  check('plan printed', /plan: 10 to build, 5 deferred, 3 done or skipped, 0 blocked/.test(r1.out), r1.out.slice(0, 400));
  check('open decisions listed with waiting modules', /D3 .*waiting: seal/.test(r1.out) && /D7 .*waiting: contract/.test(r1.out));
  check('dry run writes nothing to the build root', fs.readdirSync(empty).length === 0);

  // 2. scaffolds + record
  const repo = repoCopy();
  const codegen = path.join(repo, 'emerge', 'lang', 'native', 'codegen.eg');
  const before = fs.readFileSync(codegen, 'utf8');
  const r2 = await run([SPEC, '--out', repo]);
  check('scaffold run exits 0', r2.code === 0, r2.out.slice(-300));
  const rec = path.join(repo, '.emerge', 'build', 'cie-eg.json');
  check('build record written', fs.existsSync(rec));
  const record = JSON.parse(fs.readFileSync(rec, 'utf8'));
  // 6 cie modules × (.eg + .test.eg), plus a new .test.eg beside each of the 4 hand-written native files (codegen, rt,
  // emerge, pe) — the hand-written files themselves are never among them
  check('record lists files with hashes', record.files.length === 16 && record.files.every(x => /^[0-9a-f]{64}$/.test(x.sha256)) &&
    !record.files.some(x => x.path.endsWith('native/codegen.eg')), record.files.map(x => x.path).join(','));
  check('record has the plan', record.plan.counts.run === 10 && record.plan.defer.some(d => d.name === 'seal'));
  const first = fs.readFileSync(rec);
  await run([SPEC, '--out', repo]);
  check('record is deterministic (no clock)', Buffer.compare(first, fs.readFileSync(rec)) === 0);
  check('hand-written codegen.eg kept', fs.readFileSync(codegen, 'utf8') === before && /left alone/.test(r2.out));

  // 3. --build (Ollama API)
  const r3 = await run([SPEC, '--out', repo, '--build', '--url', model.url, '--model', 'fake']);
  check('build exits 0', r3.code === 0, r3.out.slice(-400));
  check('T2 counts 9 written, 1 failed', /T2: 9 written, 1 failed/.test(r3.out), (r3.out.match(/T2:.*$/m) || [''])[0]);
  const cie = path.join(repo, 'emerge', 'lang', 'cie');
  check('valid answer replaced its scaffold', fs.readFileSync(path.join(cie, 'boot.eg'), 'utf8').startsWith('fn boot_ready'));
  check('broken answer rejected beside the scaffold', fs.readFileSync(path.join(cie, 'gate.eg'), 'utf8').startsWith('// GENERATED') &&
    fs.readFileSync(path.join(cie, 'gate.t2-rejected.eg'), 'utf8').startsWith('// T2 answer rejected'));
  check('hand-written file gets a proposal', fs.readFileSync(codegen, 'utf8') === before &&
    fs.existsSync(path.join(repo, 'emerge', 'lang', 'native', 'codegen.t2-proposal.eg')));
  const rec3 = JSON.parse(fs.readFileSync(rec, 'utf8'));
  check('record lists what T2 did', rec3.t2 && rec3.t2.model === 'ollama:fake' && rec3.t2.results.find(x => x.module === 'gate').status === 'rejected');

  // 4. OpenAI-compatible API
  const repo2 = repoCopy();
  const r4 = await run([SPEC, '--out', repo2, '--build', '--api', 'openai', '--url', model.url, '--model', 'fake']);
  check('openai API works too', r4.code === 0 && /T2: 9 written, 1 failed/.test(r4.out), r4.out.slice(-300));

  // 5. only the model server was contacted
  check('only the model server was called', model.seen.length === 20 && model.seen.every(u => u === '/api/chat' || u === '/v1/chat/completions'), model.seen.join(','));

  model.close();
  console.log('\n\n  build-spec.test.js');
  console.log('  ' + p + ' passed  ' + f + ' failed');
  process.exit(f > 0 ? 1 : 0);
})();
