#!/usr/bin/env node
// Emerge-vs-JS token benchmark.
//   node bench.js static                       size comparison of reference solutions (eg, js, py); checks every reference passes
//   node bench.js llm --model qwen2.5-coder    asks a local Ollama model to solve each task in both languages
// Put this folder next to `emerge/` (the repo root), or set EG_PATH=/path/to/emerge/lang/eg.js
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const EG = process.env.EG_PATH || path.join(ROOT, '..', 'emerge', 'lang', 'eg.js');
const LANG_DIR = path.dirname(EG);
const TASKS = fs.readdirSync(path.join(ROOT, 'tasks')).filter(d => fs.statSync(path.join(ROOT, 'tasks', d)).isDirectory()).sort();
const est = s => Math.ceil(s.length / 4);               // rough: 4 characters per token
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

// ---------- running candidates ----------
function runEmerge(taskDir, code) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egb-'));
  const f = path.join(tmp, 'candidate.eg');
  fs.writeFileSync(f, code + '\n' + read(taskDir, 'tests.eg'));
  const r = spawnSync('node', [EG, 'test', f], { encoding: 'utf8', timeout: 30000 });
  return judge((r.stdout || '') + (r.stderr || ''));
}
function runJs(taskDir, code) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsb-'));
  fs.writeFileSync(path.join(tmp, 'solution.js'), code);
  fs.copyFileSync(path.join(taskDir, 'tests.js'), path.join(tmp, 'tests.js'));
  const r = spawnSync('node', [path.join(ROOT, 'js-runner.js'), tmp], { encoding: 'utf8', timeout: 30000 });
  return judge((r.stdout || '') + (r.stderr || ''));
}
function judge(out) {
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const ok = !!m && +m[2] === 0 && +m[1] > 0;
  return { ok, output: out.trim().slice(0, 700) };
}
function runPy(taskDir, code) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pyb-'));
  fs.writeFileSync(path.join(tmp, 'solution.py'), code);
  fs.copyFileSync(path.join(taskDir, 'tests.py'), path.join(tmp, 'tests.py'));
  const r = spawnSync(process.env.PYTHON || 'python3', [path.join(ROOT, 'py-runner.py'), tmp], { encoding: 'utf8', timeout: 30000 });
  return judge((r.stdout || '') + (r.stderr || ''));
}
const runners = { eg: runEmerge, js: runJs, py: runPy };
const LANGS = ['eg', 'js', 'py'];

// Real token counts when js-tiktoken is installed (TIKTOKEN_PATH=<folder holding node_modules/js-tiktoken>); else ~chars/4.
function tokenizers() {
  try {
    const req = process.env.TIKTOKEN_PATH ? require(require.resolve('js-tiktoken', { paths: [process.env.TIKTOKEN_PATH] })) : require('js-tiktoken');
    return ['cl100k_base', 'o200k_base'].map(n => ({ name: n, count: (enc => s => enc.encode(s).length)(req.getEncoding(n)) }));
  } catch { return []; }
}

// ---------- static mode ----------
function staticMode() {
  const toks = tokenizers();
  const cols = toks.length ? toks.map(t => t.name) : ['~chars/4'];
  const count = (s) => toks.length ? toks.map(t => t.count(s)) : [est(s)];
  console.log('task        lang  chars ' + cols.map(c => c.padStart(12)).join('') + '   reference passes');
  const tot = Object.fromEntries(LANGS.map(l => [l, cols.map(() => 0)]));
  for (const t of TASKS) {
    const dir = path.join(ROOT, 'tasks', t);
    for (const lang of LANGS) {
      if (!fs.existsSync(path.join(dir, 'solution.' + lang))) continue;
      const code = read(dir, 'solution.' + lang);
      const r = runners[lang](dir, code);
      const c = count(code);
      c.forEach((n, i) => tot[lang][i] += n);
      console.log(t.padEnd(11), lang.padEnd(4), String(code.length).padStart(6), c.map(n => String(n).padStart(12)).join(''), '  ', r.ok ? 'yes' : 'NO\n' + r.output);
    }
  }
  console.log('\ntotal reference-solution tokens (' + cols.join(' / ') + '): ' + LANGS.map(l => l + ' ' + tot[l].join(' / ')).join('   '));
  const ctx = emergeContext();
  console.log('Emerge reference context a model needs: ' + count(ctx).join(' / ') + ' tokens (' + ctx.length + ' chars). JS and Python need none.');
  console.log('Break-even: Emerge only wins on tokens if its per-task saving, summed over tasks per session, exceeds that context cost (or it is cached).');
}

// ---------- context the model gets for Emerge ----------
function emergeContext() {
  const readme = read(LANG_DIR, 'README.md');
  const section = h => { const m = readme.match(new RegExp('## ' + h + '[\\s\\S]*?(?=\\n## |$)')); return m ? m[0] : ''; };
  const parts = ['A tour', 'Compartments, signals, constraints', 'Modules and tests', 'Statements and builtins'].map(section).join('\n');
  return 'You write programs in Emerge (.eg). Reference follows.\n\n' + parts;
}

// ---------- llm mode ----------
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; }
function chat(url, model, messages) {
  return new Promise((resolve, reject) => {
    const u = new URL(url + '/api/chat');
    const body = JSON.stringify({ model, messages, stream: false, options: { temperature: 0, num_ctx: +arg('ctx', 8192) } });
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('bad reply: ' + d.slice(0, 200))); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
const extractCode = text => { const m = text.match(/```[a-z]*\n([\s\S]*?)```/i); return (m ? m[1] : text).trim(); };

async function llmMode() {
  const url = arg('url', process.env.OLLAMA_URL || 'http://localhost:11434');
  const model = arg('model'); if (!model) { console.error('need --model <ollama model name>'); process.exit(1); }
  const maxAttempts = +arg('attempts', 5);
  const only = arg('tasks', '').split(',').filter(Boolean);
  const ctxEg = emergeContext();
  const results = [];
  for (const t of TASKS.filter(t => !only.length || only.includes(t))) {
    const dir = path.join(ROOT, 'tasks', t);
    for (const lang of ['eg', 'js']) {
      const system = lang === 'eg' ? ctxEg : 'You write JavaScript (Node, CommonJS).';
      const task = read(dir, 'task.md');
      const messages = [
        { role: 'system', content: system + '\nReply with the complete code in one fenced code block and nothing else.' },
        { role: 'user', content: (lang === 'js' ? task.replace(/^EMERGE:.*\n/m, '').replace(/^JAVASCRIPT: /m, '') : task.replace(/^JAVASCRIPT:.*\n?/m, '').replace(/^EMERGE: /m, '')) +
          (lang === 'js' ? '\nExport with module.exports / exports.<name>.' : '') }
      ];
      let promptTok = 0, outTok = 0, attempts = 0, ok = false, last = '';
      while (attempts < maxAttempts && !ok) {
        attempts++;
        const reply = await chat(url, model, messages);
        promptTok += reply.prompt_eval_count || 0; outTok += reply.eval_count || 0;
        const text = (reply.message && reply.message.content) || '';
        const code = extractCode(text);
        const r = runners[lang](dir, code);
        ok = r.ok; last = r.output;
        if (!ok) { messages.push({ role: 'assistant', content: text }); messages.push({ role: 'user', content: 'The tests failed:\n' + r.output + '\nFix it. Reply with the complete code in one fenced block.' }); }
      }
      results.push({ task: t, lang, ok, attempts, promptTok, outTok, totalTok: promptTok + outTok });
      console.log(t.padEnd(10), lang, ok ? 'PASS' : 'FAIL', 'attempts', attempts, 'prompt', promptTok, 'out', outTok);
    }
  }
  const out = path.join(ROOT, 'results'); fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, model.replace(/[^\w.-]/g, '_') + '-' + Date.now() + '.json');
  fs.writeFileSync(file, JSON.stringify({ model, maxAttempts, results }, null, 2));
  console.log('\nlang  solved  avg_attempts  total_tokens (prompt+output, as reported by Ollama)');
  for (const lang of ['eg', 'js']) {
    const rs = results.filter(r => r.lang === lang);
    console.log(lang.padEnd(5), String(rs.filter(r => r.ok).length + '/' + rs.length).padEnd(7), (rs.reduce((a, r) => a + r.attempts, 0) / rs.length).toFixed(2).padStart(12), String(rs.reduce((a, r) => a + r.totalTok, 0)).padStart(12));
  }
  console.log('saved', file);
}

const mode = process.argv[2];
if (mode === 'static') staticMode();
else if (mode === 'llm') llmMode().catch(e => { console.error(e.message); process.exit(1); });
else console.log('usage: node bench.js static | node bench.js llm --model <name> [--attempts 5] [--tasks median,tank] [--ctx 8192] [--url http://localhost:11434]');
