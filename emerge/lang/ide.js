'use strict';
// emerge/lang/ide.js — `eg ide [folder] [--port 4343]`: a local editor for .eg files. Zero dependencies.
// Autocomplete is read from the language itself (keywords, types, builtins + arities), diagnostics come from the real
// checker, Run/Test use the real interpreter, and Generate writes new .eg files from templates that check clean.

const fs = require('fs');
const path = require('path');
const http = require('http');
const lang = require('./index');
const { KEYWORDS } = require('./lexer');
const { TYPES } = require('./parser');
const { builtinArity } = require('./runtime');

// ── generators: each returns .eg source that passes `eg check` ─────────────────────────────────────────────────────
const ident = s => (String(s || 'Thing').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'Thing');
const lower = s => ident(s).toLowerCase();
const GENERATORS = {
  compartment: n => `compartment ${ident(n)} {
  id = "${lower(n)}.main"
  intent = "what ${ident(n)} is responsible for"
  state { count: 0 }

  constraint non_negative hard { state.count >= 0 }

  on "${lower(n)}.add" (e) {
    state.count += e.by
    emit "${lower(n)}.changed" { count: state.count }
  }

  fn total() = state.count
}

on "${lower(n)}.changed" (e) { print("${ident(n)} now", e.count) }

emit "${lower(n)}.add" { by: 1 }
print(${ident(n)}.total())
`,
  component: n => `component ${ident(n)} {
  id = "${lower(n)}.main"
  namespace = "${lower(n)}"
  version = "1.0.0"
  intent = "what ${ident(n)} does"
  state { seen: 0 }

  boundary counts_up { state.seen >= 0 }

  in input(x: { value: num }) {
    state.seen += 1
    emit out result { n: state.seen, value: x.value }
  }
  out result: { n: int, value: num }
}

wire "${lower(n)}.in" -> ${ident(n)}.input
wire ${ident(n)}.result -> "${lower(n)}.out"

on "${lower(n)}.out" (r) { print("${ident(n)} produced", r.n, r.value) }
emit "${lower(n)}.in" { value: 1.5 }
`,
  test: n => `fn double(x: num) = x * 2

test "${String(n || 'double').replace(/"/g, '')}" {
  expect double(2) == 4, "double(2) should be 4"
  expect double(0) == 0
}
`,
  module: n => `// ${lower(n)}.eg — use it with: use "./${lower(n)}.eg" as ${lower(n)}
let version = "1.0.0"
fn greet(name: string) = "hello, {name}"
`,
  program: n => `// ${lower(n)}.eg — an Emerge program. Run: eg run ${lower(n)}.eg
let name = "${ident(n)}"
print("hello from", name)
`,
};

function vocab() {
  const kw = [...KEYWORDS].map(w => ({ w, k: 'keyword' }));
  const ty = [...TYPES].map(w => ({ w, k: 'type' }));
  const bi = [...builtinArity()].map(([w, a]) => ({ w, k: 'builtin',
    d: Array.isArray(a) ? `${a[0]}${a[1] === -1 ? '+' : a[0] === a[1] ? '' : '–' + a[1]} args` : `${a} args` }));
  const ctx = ['id', 'intent', 'namespace', 'version', 'boundary', 'out', 'kind', 'is', 'despawn', 'print', 'raise']
    .filter(w => !KEYWORDS.has(w)).map(w => ({ w, k: 'contextual' }));
  return [...kw, ...ty, ...bi, ...ctx];
}

function diagnostics(src, file) {
  const r = lang.compileSource(src, file);
  const f = (d, level) => ({ line: d.line, col: d.col, message: d.message, level });
  return { ok: !r.errors.length, items: [...r.errors.map(d => f(d, 'error')), ...r.warnings.map(d => f(d, 'warning'))] };
}

function safeName(dir, name) {
  const n = String(name || '').replace(/\\/g, '/');
  if (!/^[A-Za-z0-9_\-./]+\.eg$/.test(n) || n.includes('..') || n.startsWith('/')) return null;
  return path.join(dir, n);
}
function listEg(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'build') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listEg(p, base, out);
    else if (e.name.endsWith('.eg')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

function execFile(abs, mode) {
  let out = '', err = '';
  const r = lang.runFile(abs, { test: mode === 'test', out: s => { out += s; }, err: s => { err += s; }, warnings: true });
  return { code: r.code, stdout: out, stderr: err };
}

const OUTPUT = path.join(__dirname, '..', 'output');   // emerge/output — where generated .eg files go by default

function start(dirArg, port) {
  const dir = path.resolve(dirArg || OUTPUT);
  fs.mkdirSync(dir, { recursive: true });
  const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const readBody = req => new Promise(ok => { let b = ''; req.on('data', c => { b += c; if (b.length > 2e6) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });

  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    try {
      if (req.method === 'GET' && url === '/') return send(res, 200, PAGE, 'text/html');
      if (req.method === 'GET' && url === '/api/vocab') return send(res, 200, { words: vocab(), version: lang.VERSION, dir });
      if (req.method === 'GET' && url === '/api/files') return send(res, 200, { files: listEg(dir) });
      if (req.method === 'GET' && url === '/api/file') {
        const p = safeName(dir, new URL(req.url, 'http://x').searchParams.get('name'));
        if (!p || !fs.existsSync(p)) return send(res, 404, { error: 'no such file' });
        return send(res, 200, { source: fs.readFileSync(p, 'utf8') });
      }
      if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
      const b = await readBody(req);
      if (url === '/api/check') return send(res, 200, diagnostics(String(b.source || ''), b.name || '<input>'));
      if (url === '/api/save') {
        const p = safeName(dir, b.name);
        if (!p) return send(res, 400, { error: 'file names look like name.eg (letters, digits, _ - / .)' });
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, String(b.source || ''));
        return send(res, 200, { saved: b.name });
      }
      if (url === '/api/run' || url === '/api/test') {
        const p = safeName(dir, b.name);
        if (!p) return send(res, 400, { error: 'save the file as name.eg first' });
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, String(b.source || ''));
        return send(res, 200, execFile(p, url === '/api/test' ? 'test' : 'run'));
      }
      if (url === '/api/generate') {
        const g = GENERATORS[b.kind];
        if (!g) return send(res, 400, { error: 'kinds: ' + Object.keys(GENERATORS).join(', ') });
        const source = g(b.name);
        const stem = lower(b.name || b.kind);
        let name = `${stem}.eg`, i = 2;
        while (fs.existsSync(path.join(dir, name))) name = `${stem}${i++}.eg`;
        fs.writeFileSync(path.join(dir, name), source);
        return send(res, 200, { name, source, check: diagnostics(source, name) });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) { send(res, 500, { error: e.message }); }
  });
  server.listen(port, '127.0.0.1', () => process.stdout.write(`emerge ide  http://127.0.0.1:${port}   (files in ${dir})\n`));
  return server;
}

const PAGE = `<!doctype html><meta charset=utf-8><title>Emerge IDE</title>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>
:root{--bg:#fff;--fg:#1c1c1c;--mut:#6b6b6b;--bd:#d8d8d8;--pn:#f5f5f4;--ac:#0b6bcb;--er:#c0262d;--wn:#9a6700}
@media(prefers-color-scheme:dark){:root{--bg:#161616;--fg:#e8e8e8;--mut:#9a9a9a;--bd:#333;--pn:#1f1f1f;--ac:#5aa9ff;--er:#ff7b72;--wn:#e3b341}}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif}
header{display:flex;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--bd);flex-wrap:wrap}
button,select,input{font:inherit;color:var(--fg);background:var(--pn);border:1px solid var(--bd);border-radius:6px;padding:5px 10px}button{cursor:pointer}button:hover{border-color:var(--ac)}
main{flex:1;display:flex;min-height:0}aside{width:190px;border-right:1px solid var(--bd);overflow:auto;padding:6px;background:var(--pn)}
aside div{padding:4px 8px;border-radius:5px;cursor:pointer;word-break:break-all}aside div:hover,aside .on{background:var(--bd)}
section{flex:1;display:flex;flex-direction:column;min-width:0}
#wrap{position:relative;flex:1;min-height:0}
textarea{position:absolute;inset:0;width:100%;height:100%;resize:none;border:0;outline:0;padding:10px;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,Consolas,monospace;tab-size:2;white-space:pre}
#ac{position:absolute;display:none;max-height:210px;overflow:auto;background:var(--pn);border:1px solid var(--bd);border-radius:6px;min-width:210px;z-index:5;font:13px ui-monospace,Consolas,monospace;box-shadow:0 4px 14px #0003}
#ac div{padding:3px 10px;display:flex;justify-content:space-between;gap:14px;cursor:pointer}#ac .sel{background:var(--ac);color:#fff}#ac small{opacity:.7}
#panel{height:170px;border-top:1px solid var(--bd);overflow:auto;padding:8px 10px;font:13px ui-monospace,Consolas,monospace;white-space:pre-wrap;background:var(--pn)}
.error{color:var(--er)}.warning{color:var(--wn)}.ok{color:var(--ac)}#panel a{color:inherit;text-decoration:underline;cursor:pointer}
#mirror{position:absolute;visibility:hidden;white-space:pre;font:14px/1.5 ui-monospace,Consolas,monospace;padding:10px}
</style>
<header><b>Emerge IDE</b><select id=gk><option>compartment<option>component<option>test<option>module<option>program</select>
<input id=gn placeholder="name" size=12><button id=gen>Generate .eg</button><span style="flex:1"></span>
<input id=fname placeholder="file.eg" size=16><button id=save>Save</button><button id=run>Run</button><button id=test>Test</button><span id=stat style="color:var(--mut)"></span></header>
<main><aside id=files></aside><section><div id=wrap><textarea id=ed spellcheck=false autofocus></textarea><div id=ac></div><div id=mirror></div></div><div id=panel>Ctrl+Space completes · Tab accepts · Ctrl+S saves · Ctrl+Enter runs</div></section></main>
<script>
const $=id=>document.getElementById(id);let WORDS=[],sel=0,matches=[],timer;
const api=(p,b)=>fetch(p,b?{method:'POST',body:JSON.stringify(b)}:{}).then(r=>r.json());
const ed=$('ed'),ac=$('ac'),panel=$('panel');
async function init(){const v=await api('/api/vocab');WORDS=v.words;$('stat').textContent='eg '+v.version;await files()}
async function files(){const f=(await api('/api/files')).files;$('files').innerHTML='';f.forEach(n=>{const d=document.createElement('div');d.textContent=n;if(n===$('fname').value)d.className='on';d.onclick=()=>open(n);$('files').appendChild(d)})}
async function open(n){const r=await api('/api/file?name='+encodeURIComponent(n));ed.value=r.source||'';$('fname').value=n;files();check()}
function prefix(){const p=ed.selectionStart,m=/[A-Za-z_][A-Za-z0-9_]*$/.exec(ed.value.slice(0,p));return m?m[0]:''}
function showAc(force){const pre=prefix();if(!pre&&!force){return hideAc()}
 const seen=new Set();matches=WORDS.filter(x=>x.w.startsWith(pre)&&x.w!==pre&&!seen.has(x.w)&&seen.add(x.w)).sort((a,b)=>a.w.length-b.w.length).slice(0,40);
 if(!matches.length)return hideAc();sel=0;draw();place()}
function draw(){ac.innerHTML='';matches.forEach((m,i)=>{const d=document.createElement('div');d.className=i===sel?'sel':'';d.innerHTML='<span>'+m.w+'</span><small>'+(m.d||m.k)+'</small>';d.onmousedown=e=>{e.preventDefault();sel=i;accept()};ac.appendChild(d)});ac.style.display='block'}
function place(){const mi=$('mirror');mi.style.width=ed.clientWidth+'px';mi.textContent=ed.value.slice(0,ed.selectionStart);const s=document.createElement('span');s.textContent='.';mi.appendChild(s);
 ac.style.left=Math.min(s.offsetLeft+10-ed.scrollLeft,ed.clientWidth-230)+'px';ac.style.top=(s.offsetTop+26-ed.scrollTop)+'px'}
function hideAc(){ac.style.display='none';matches=[]}
function accept(){const m=matches[sel];if(!m)return;const p=ed.selectionStart,pre=prefix();ed.setRangeText(m.w+(m.k==='builtin'?'(':''),p-pre.length,p,'end');hideAc();ed.focus();sched()}
ed.addEventListener('input',()=>{showAc(false);sched()});
ed.addEventListener('keydown',e=>{
 if(ac.style.display==='block'){if(e.key==='ArrowDown'){e.preventDefault();sel=(sel+1)%matches.length;draw();return}
  if(e.key==='ArrowUp'){e.preventDefault();sel=(sel-1+matches.length)%matches.length;draw();return}
  if(e.key==='Tab'||e.key==='Enter'){e.preventDefault();accept();return}if(e.key==='Escape'){hideAc();return}}
 if(e.key===' '&&e.ctrlKey){e.preventDefault();showAc(true);return}
 if(e.key==='Tab'){e.preventDefault();ed.setRangeText('  ',ed.selectionStart,ed.selectionEnd,'end');sched()}
 if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();save()}
 if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();exec('run')}});
ed.addEventListener('blur',()=>setTimeout(hideAc,150));
function sched(){clearTimeout(timer);timer=setTimeout(check,350)}
function goto(l){const lines=ed.value.split('\\n');let o=0;for(let i=0;i<l-1&&i<lines.length;i++)o+=lines[i].length+1;ed.focus();ed.setSelectionRange(o,o)}
function show(items){panel.innerHTML='';items.forEach(t=>{const d=document.createElement('div');d.className=t.c||'';if(t.l){const a=document.createElement('a');a.textContent=t.l;a.onclick=()=>goto(t.ln);d.appendChild(a);d.append(' '+t.t)}else d.textContent=t.t;panel.appendChild(d)})}
async function check(){const r=await api('/api/check',{source:ed.value,name:$('fname').value||'<input>'});
 show(r.items.length?r.items.map(i=>({c:i.level,l:'line '+i.line+':'+i.col,ln:i.line,t:i.level+': '+i.message})):[{c:'ok',t:'ok — no errors'}])}
async function save(){const n=$('fname').value.trim();if(!n)return show([{c:'error',t:'name the file first (e.g. main.eg)'}]);const r=await api('/api/save',{name:n,source:ed.value});show([r.error?{c:'error',t:r.error}:{c:'ok',t:'saved '+n}]);files()}
async function exec(m){const n=$('fname').value.trim();const r=await api('/api/'+m,{name:n,source:ed.value});if(r.error)return show([{c:'error',t:r.error}]);
 show([{c:r.code?'error':'ok',t:m+' exit '+r.code},{t:r.stdout},{c:'error',t:r.stderr}]);files()}
$('save').onclick=save;$('run').onclick=()=>exec('run');$('test').onclick=()=>exec('test');
$('gen').onclick=async()=>{const r=await api('/api/generate',{kind:$('gk').value,name:$('gn').value});if(r.error)return show([{c:'error',t:r.error}]);ed.value=r.source;$('fname').value=r.name;await files();check()};
init();
</script>`;

module.exports = { OUTPUT, start, vocab, diagnostics, GENERATORS };
