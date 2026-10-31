#!/usr/bin/env node
// Chunk benchmark: can a smaller model write a piece of careful handwork when it is cut into minimal units, each with
// its boundary declared at every edge (cie-eg.spec s15), compared with the same job as one task?
//
//   node chunks.js static                                   check every reference unit passes; prompt sizes per unit
//   node chunks.js derive                                   rungs 1-2 with no model: synth.eg writes every unit, then test
//   node chunks.js run   --model qwen2.5-coder:1.5b         one model, both conditions (monolith and chunked)
//   node chunks.js sweep --models qwen2.5-coder:0.5b,qwen2.5-coder:1.5b,qwen2.5-coder:3b,qwen2.5-coder:7b
//   node chunks.js selftest                                 the whole pipeline against a fake model server (no model needed)
//
// Options: --suite utf8_decode   --attempts 3   --trials 1   --temperature 0   --ctx 4096
//          --url http://localhost:11434 (Ollama, the default)   or   --api openai --url http://localhost:8080 (llama.cpp
//          server, LM Studio, vLLM: anything with /v1/chat/completions)
//          --assist   when a unit fails every attempt, use the reference for it and carry on, so later units still get
//                     measured (the chain is then reported as assisted, not solved)
//
// Put this folder next to emerge/ (the repo root), or set EG_PATH=/path/to/emerge/lang/eg.js.
// Reads chunks/<suite>/chunks.spec with js-yaml from emerge/node_modules (run `npm install` in emerge/ once).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), https = require('https');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const EG = process.env.EG_PATH || path.join(ROOT, '..', 'emerge', 'lang', 'eg.js');
const EMERGE = path.join(path.dirname(EG), '..');
const est = s => Math.ceil(s.length / 4);
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; }
const flag = name => process.argv.includes('--' + name);

function loadSuite(name) {
  let yaml;
  try { yaml = require(path.join(EMERGE, 'node_modules', 'js-yaml')); }
  catch { try { yaml = require('js-yaml'); } catch { console.error('js-yaml not found: run `npm install` in emerge/ (or `npm i js-yaml` here)'); process.exit(1); } }
  const dir = path.join(ROOT, 'chunks', name);
  const spec = yaml.load(fs.readFileSync(path.join(dir, 'chunks.spec'), 'utf8')).spec;
  const ref = id => fs.readFileSync(path.join(dir, 'ref', id + '.eg'), 'utf8').trim();
  return { dir, spec, ref };
}

// ---------- the one piece of language context both conditions get ----------
// Kept small on purpose: a unit needs syntax, not the whole language guide. Both conditions get exactly this.
const CARD = `You write Emerge (.eg). Syntax you may use:
fn name(a: num, b: list): map { ... }      fn name(x: num): bool = <expression>
types: num (also written as hex 0xFF), bool, list, map, string
let x = 1   (constant)     var y = 0   (variable)     y = 2   y += 1   y -= 1
if a and b { ... } else if not c { ... } else { ... }        or, and, not
while i < len(xs) { ... }      for k in 1..n { ... }   (k goes 1 .. n-1; the end is excluded)
return value     break     skip (continue)
comparisons: == != < <= > >=      arithmetic: + - * / %      bits: & | ^ ~ << >>
lists: [1, 2, 3]   xs[i]   len(xs)   push(xs, v) returns a NEW list (use: xs = push(xs, v))
maps: { ok: true, n: 3 }   m.ok   (== compares lists and maps by value)
No semicolons. No classes. No imports. Blocks use { }.`;

const SYSTEM = CARD + '\nReply with only the requested Emerge code in one fenced code block. No tests, no explanation.';

function unitPrompt(spec, unit) {
  const deps = (unit.deps || []).map(id => spec.units.find(u => u.id === id));
  const b = unit.boundary || {};
  return [
    'Write exactly this one function:',
    '  ' + unit.signature,
    'What it does: ' + unit.does,
    'Input: ' + Object.entries(b.in || {}).map(([k, v]) => k + ' = ' + v).join('; '),
    'Output: ' + b.out,
    'Rules (all must hold):',
    ...(b.invariants || []).map(s => '  - ' + s),
    'Examples:',
    ...(unit.examples || []).map(s => '  ' + s),
    deps.length ? 'These functions already exist; call them, do not write them:' : 'Call no other functions you would have to write.',
    ...deps.map(d => '  ' + d.signature + '   // ' + d.does),
  ].join('\n');
}
function monolithPrompt(spec) {
  return 'Write exactly this one function (you may add helper functions):\n  ' + spec.monolith.signature + '\n' + spec.monolith.task;
}

// ---------- running candidates ----------
function runEg(code) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egc-'));
  const f = path.join(tmp, 'candidate.eg');
  fs.writeFileSync(f, code);
  const r = spawnSync(process.execPath, [EG, 'test', f], { encoding: 'utf8', timeout: 30000 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const m = out.match(/(\d+) passed, (\d+) failed/);
  return { ok: !!m && +m[2] === 0 && +m[1] > 0, output: out.slice(0, 900) };
}
const extractCode = text => { const m = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/); return (m ? m[1] : text).trim(); };
// A unit's reply must not smuggle in other units: keep only the fn it was asked for (by name) and any private helpers,
// and drop redefinitions of its deps, so the accepted dep code is what actually runs.
function stripDeps(code, depIds) {
  if (!depIds.length) return code;
  const lines = code.split('\n'); const out = []; let skipping = false, depth = 0;
  for (const line of lines) {
    const m = line.match(/^\s*fn\s+([A-Za-z_]\w*)\s*\(/);
    if (!skipping && m && depIds.includes(m[1])) {
      if (!line.includes('{') && line.includes('=')) continue;          // one-line fn x(...) = expr
      skipping = true; depth = 0;
    }
    if (skipping) {
      for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth <= 0 && line.includes('}')) skipping = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n').trim();
}

// ---------- model clients ----------
function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const lib = u.protocol === 'https:' ? https : http; const data = JSON.stringify(body);
    const req = lib.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('bad reply from model server: ' + d.slice(0, 200))); } });
    });
    req.on('error', e => reject(new Error('model server unreachable at ' + url + ': ' + e.message)));
    req.setTimeout(600000, () => req.destroy(new Error('model server timed out')));
    req.write(data); req.end();
  });
}
function client(opts) {
  const temperature = +opts.temperature;
  if (opts.api === 'openai') {
    return async (model, messages) => {
      const r = await post(opts.url.replace(/\/$/, '') + '/v1/chat/completions', { model, messages, temperature, stream: false });
      if (r.error) throw new Error(JSON.stringify(r.error));
      return { text: r.choices[0].message.content || '', prompt: r.usage?.prompt_tokens || 0, out: r.usage?.completion_tokens || 0 };
    };
  }
  return async (model, messages) => {
    const r = await post(opts.url.replace(/\/$/, '') + '/api/chat', { model, messages, stream: false, options: { temperature, num_ctx: +opts.ctx } });
    if (r.error) throw new Error(r.error);
    return { text: r.message?.content || '', prompt: r.prompt_eval_count || 0, out: r.eval_count || 0 };
  };
}

// One task with retries: the model gets the test output after a failure.
async function solve(chat, model, prompt, test, attempts) {
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }];
  let prompt_tokens = 0, output_tokens = 0, last = null;
  for (let a = 1; a <= attempts; a++) {
    const r = await chat(model, messages);
    prompt_tokens += r.prompt; output_tokens += r.out;
    const code = extractCode(r.text);
    last = test(code);
    if (last.ok) return { ok: true, attempts: a, prompt_tokens, output_tokens, code: last.code ?? code };
    messages.push({ role: 'assistant', content: r.text });
    messages.push({ role: 'user', content: 'The tests failed:\n' + last.output + '\nFix it. Reply with the complete function in one fenced code block.' });
  }
  return { ok: false, attempts, prompt_tokens, output_tokens, error: last && last.output };
}

async function runMonolith(chat, model, suite, attempts) {
  const { spec } = suite;
  return solve(chat, model, monolithPrompt(spec), code => runEg(code + '\n\n' + spec.monolith.tests), attempts);
}

async function runChunked(chat, model, suite, attempts, assist) {
  const { spec, ref } = suite;
  const accepted = {}; const units = []; let assisted = false, broken = null;
  for (const unit of spec.units) {
    const depCode = (unit.deps || []).map(id => accepted[id]).join('\n\n');
    const test = code => {
      const own = stripDeps(code, unit.deps || []);
      const r = runEg([depCode, own, unit.tests].filter(Boolean).join('\n\n'));
      return { ...r, code: own };
    };
    const r = await solve(chat, model, unitPrompt(spec, unit), test, attempts);
    units.push({ unit: unit.id, ok: r.ok, attempts: r.attempts, prompt_tokens: r.prompt_tokens, output_tokens: r.output_tokens, ...(r.ok ? {} : { error: r.error }) });
    if (r.ok) accepted[unit.id] = r.code;
    else if (assist) { accepted[unit.id] = ref(unit.id); assisted = true; }
    else { broken = unit.id; break; }
  }
  // Integration: the assembled program against the monolith's tests (the same tests as the last unit).
  let integrated = false;
  if (!broken) integrated = runEg(spec.units.map(u => accepted[u.id]).join('\n\n') + '\n\n' + spec.monolith.tests).ok;
  const sum = k => units.reduce((a, u) => a + u[k], 0);
  return { ok: integrated && !assisted, assisted, broken_at: broken, integrated, units,
    attempts: sum('attempts'), prompt_tokens: sum('prompt_tokens'), output_tokens: sum('output_tokens'),
    program: broken ? null : spec.units.map(u => accepted[u.id]).join('\n\n') };
}

async function runModel(chat, model, suite, opts) {
  const trials = +opts.trials; const rows = [];
  for (let t = 1; t <= trials; t++) {
    const mono = await runMonolith(chat, model, suite, +opts.attempts);
    const chunk = await runChunked(chat, model, suite, +opts.attempts, opts.assist);
    rows.push({ trial: t, monolith: mono, chunked: chunk });
    const tok = r => r.prompt_tokens + r.output_tokens;
    console.log(`${model}  trial ${t}`);
    console.log(`  monolith  ${mono.ok ? 'PASS' : 'FAIL'}  attempts ${mono.attempts}  tokens ${tok(mono)}`);
    console.log(`  chunked   ${chunk.ok ? 'PASS' : chunk.assisted ? 'ASSISTED' : 'FAIL'}  attempts ${chunk.attempts}  tokens ${tok(chunk)}` +
      (chunk.broken_at ? `  (stopped at ${chunk.broken_at})` : ''));
    for (const u of chunk.units) console.log(`     ${u.unit.padEnd(13)} ${u.ok ? 'pass' : 'FAIL'}  attempts ${u.attempts}  tokens ${u.prompt_tokens + u.output_tokens}`);
  }
  return { model, rows };
}

function summarize(all, opts, suiteName) {
  console.log('\nmodel                         monolith solved   chunked solved   units passed   tokens mono / chunked (avg)');
  for (const { model, rows } of all) {
    const n = rows.length, avg = f => Math.round(rows.reduce((a, r) => a + f(r), 0) / n);
    const units = rows.flatMap(r => r.chunked.units); const tot = units.length;
    const unitsTotal = n * rows[0].chunked.units.length;
    console.log(model.padEnd(30),
      `${rows.filter(r => r.monolith.ok).length}/${n}`.padEnd(17),
      `${rows.filter(r => r.chunked.ok).length}/${n}`.padEnd(16),
      `${units.filter(u => u.ok).length}/${tot}`.padEnd(14),
      `${avg(r => r.monolith.prompt_tokens + r.monolith.output_tokens)} / ${avg(r => r.chunked.prompt_tokens + r.chunked.output_tokens)}`);
    void unitsTotal;
  }
  const out = path.join(ROOT, 'results'); fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `chunks-${suiteName}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ suite: suiteName, options: opts, card_tokens_est: est(SYSTEM), results: all }, null, 2));
  console.log('saved ' + file);
}

function options() {
  return { suite: arg('suite', 'utf8_decode'), attempts: arg('attempts', '3'), trials: arg('trials', '1'), temperature: arg('temperature', '0'),
    ctx: arg('ctx', '4096'), api: arg('api', 'ollama'), url: arg('url', process.env.OLLAMA_URL || (arg('api') === 'openai' ? 'http://localhost:8080' : 'http://localhost:11434')),
    assist: flag('assist') };
}

// ---------- static: references pass, prompt sizes ----------
function staticMode() {
  const opts = options(); const suite = loadSuite(opts.suite); const { spec, ref } = suite;
  let allOk = true; const accepted = {};
  console.log('unit           reference passes   prompt ~tokens (system + unit)');
  for (const u of spec.units) {
    accepted[u.id] = ref(u.id);
    const r = runEg([(u.deps || []).map(d => accepted[d]).join('\n\n'), accepted[u.id], u.tests].filter(Boolean).join('\n\n'));
    allOk = allOk && r.ok;
    console.log(u.id.padEnd(14), (r.ok ? 'yes' : 'NO').padEnd(18), est(SYSTEM) + ' + ' + est(unitPrompt(spec, u)), r.ok ? '' : '\n' + r.output);
  }
  const whole = runEg(spec.units.map(u => accepted[u.id]).join('\n\n') + '\n\n' + spec.monolith.tests);
  console.log('assembled program passes the monolith tests: ' + (whole.ok ? 'yes' : 'NO\n' + whole.output));
  console.log('monolith prompt ~tokens: ' + est(SYSTEM) + ' + ' + est(monolithPrompt(spec)));
  const biggest = Math.max(...spec.units.map(u => est(unitPrompt(spec, u))));
  console.log('largest single unit prompt ~tokens: ' + est(SYSTEM) + ' + ' + biggest + '  (the context a model must hold at once)');
  if (!allOk || !whole.ok) process.exitCode = 1;
}

// ---------- derive: rungs 1 and 2 with no model (cie-eg.spec 15; emerge/lang/cie/synth.eg) ----------
// The units' derive blocks go to synth.eg (written in Emerge). Its code is tested exactly as a model's would be: each
// unit alone with its deps, then the assembled program against the monolith's tests. Run twice: the bytes must match.
function deriveMode() {
  const opts = options(); const { spec } = loadSuite(opts.suite);
  const synth = path.join(EMERGE, 'lang', 'cie', 'synth.eg');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egd-'));
  fs.writeFileSync(path.join(tmp, 'units.json'), JSON.stringify(spec.units.map(u => ({ id: u.id, signature: u.signature, derive: u.derive }))));
  const gen = dir => {
    fs.mkdirSync(dir, { recursive: true });
    const r = spawnSync(process.execPath, [EG, 'run', synth, path.join(tmp, 'units.json'), dir], { encoding: 'utf8', timeout: 60000 });
    return ((r.stdout || '') + (r.stderr || '')).trim();
  };
  const log = gen(path.join(tmp, 'a')); gen(path.join(tmp, 'b'));
  console.log(log + '\n');
  const code = {}; let allOk = true, same = true;
  console.log('unit           generated passes   same bytes on a second run');
  for (const u of spec.units) {
    const f = id => path.join(tmp, 'a', id + '.eg');
    if (!fs.existsSync(f(u.id))) { allOk = false; console.log(u.id.padEnd(14), 'NOT GENERATED'); continue; }
    code[u.id] = fs.readFileSync(f(u.id), 'utf8').trim();
    const again = fs.readFileSync(path.join(tmp, 'b', u.id + '.eg'), 'utf8').trim() === code[u.id];
    same = same && again;
    const r = runEg([(u.deps || []).map(d => code[d]).join('\n\n'), code[u.id], u.tests].filter(Boolean).join('\n\n'));
    allOk = allOk && r.ok;
    console.log(u.id.padEnd(14), (r.ok ? 'yes' : 'NO').padEnd(18), again ? 'yes' : 'NO', r.ok ? '' : '\n' + r.output);
  }
  const whole = runEg(spec.units.map(u => code[u.id] || '').join('\n\n') + '\n\n' + spec.monolith.tests);
  console.log('assembled program passes the monolith tests: ' + (whole.ok ? 'yes' : 'NO\n' + whole.output));
  console.log('model calls: 0   tokens: 0   deterministic: ' + (same ? 'yes' : 'NO'));
  if (!allOk || !whole.ok || !same) process.exitCode = 1;
}

// ---------- selftest: a fake model server that answers from the references ----------
// It replies with a broken answer first for each new task, then the reference, so retries, feedback, dep stripping,
// integration, token accounting and both APIs are all exercised. It proves the plumbing, not any model.
async function selftest() {
  const opts = options(); const suite = loadSuite(opts.suite); const { spec, ref } = suite;
  const seen = new Set();
  const answer = messages => {
    const user = messages.find(m => m.role === 'user').content;
    const key = user; const first = !seen.has(key); seen.add(key);
    let code;
    if (user.startsWith('Write exactly this one function (you may add helper')) code = spec.units.map(u => ref(u.id)).join('\n\n');
    else {
      const asked = user.split('\n')[1].trim();                       // the line after "Write exactly this one function:"
      const id = spec.units.find(u => u.signature === asked).id;
      // the decode unit's answer also redefines a dep, which stripDeps must remove
      code = ref(id) + (id === 'decode' ? '\n\nfn is_cont(b: num): bool = false' : '');
    }
    if (first) code = 'fn broken() { return 1 }';
    return '```eg\n' + code + '\n```';
  };
  const server = http.createServer((req, res) => {
    let d = ''; req.on('data', c => d += c); req.on('end', () => {
      const body = JSON.parse(d); const text = answer(body.messages);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/chat/completions') res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
      else res.end(JSON.stringify({ message: { content: text }, prompt_eval_count: 100, eval_count: 50 }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port; let ok = true;
  for (const api of ['ollama', 'openai']) {
    seen.clear();
    const chat = client({ ...opts, api, url: 'http://127.0.0.1:' + port });
    const res = await runModel(chat, 'fake-' + api, suite, { ...opts, trials: 1 });
    const row = res.rows[0];
    const good = row.monolith.ok && row.monolith.attempts === 2 && row.chunked.ok && row.chunked.units.every(u => u.attempts === 2)
      && !/is_cont\(b: num\): bool = false/.test(row.chunked.program) && row.chunked.prompt_tokens === 100 * 2 * spec.units.length;
    console.log('selftest ' + api + ': ' + (good ? 'ok' : 'FAILED'));
    ok = ok && good;
  }
  server.close();
  if (!ok) process.exitCode = 1;
}

async function main() {
  const mode = process.argv[2]; const opts = options();
  if (mode === 'static') return staticMode();
  if (mode === 'selftest') return selftest();
  if (mode === 'derive') return deriveMode();
  if (mode === 'run' || mode === 'sweep') {
    const models = mode === 'run' ? [arg('model')] : (arg('models') || '').split(',').filter(Boolean);
    if (!models.length || !models[0]) { console.error(mode === 'run' ? 'need --model <name>' : 'need --models a,b,c'); process.exit(1); }
    const suite = loadSuite(opts.suite); const chat = client(opts); const all = [];
    for (const m of models) all.push(await runModel(chat, m, suite, opts));
    return summarize(all, opts, opts.suite);
  }
  console.log('usage: node chunks.js static | derive | selftest | run --model <name> | sweep --models a,b,c   [see the header for options]');
}
main().catch(e => { console.error(e.message); process.exit(1); });
