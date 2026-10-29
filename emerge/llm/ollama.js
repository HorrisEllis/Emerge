'use strict';
// emerge/llm/ollama.js — a minimal client for a local Ollama server, for the legacy IDE (emerge-ide.js).
// component_id: emerge.llm.ollama
// §2026-10-28 — replaces ../../ollama/ollama-runtime, which lived in the Nexus tree above emerge/, so emerge-ide.js could
// not load when emerge stood alone. Same four members the IDE uses. Env: OLLAMA_URL (http://localhost:11434), EMERGE_MODEL.

const http  = require('http');
const https = require('https');

const BASE = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.EMERGE_MODEL || 'qwen2.5-coder:3b';

function call(method, p, body, onChunk) {
  const u = new URL(BASE + p); const lib = u.protocol === 'https:' ? https : http;
  const data = body ? JSON.stringify(body) : null;
  return lib.request({ hostname: u.hostname, port: u.port, path: u.pathname, method,
    headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, onChunk);
}

/** ping() → Promise<bool> */
function ping() {
  return new Promise(resolve => {
    const req = call('GET', '/api/tags', null, res => { res.resume(); res.on('end', () => resolve(res.statusCode < 400)); });
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false)); req.end();
  });
}

/** listModels() → Promise<string[]> */
function listModels() {
  return new Promise(resolve => {
    const req = call('GET', '/api/tags', null, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve((JSON.parse(d).models || []).map(m => m.name)); } catch { resolve([]); } });
    });
    req.on('error', () => resolve([])); req.end();
  });
}

/** streamGenerate({ model, prompt, system, temperature, max_tokens }, onToken, onDone, onError) → abort() */
function streamGenerate(o, onToken, onDone, onError) {
  let done = false; const finish = (fn, x) => { if (!done) { done = true; fn && fn(x); } };
  const req = call('POST', '/api/generate', { model: o.model || DEFAULT_MODEL, prompt: o.prompt, system: o.system, stream: true,
    options: { temperature: o.temperature ?? 0.2, num_predict: o.max_tokens ?? 1024 } }, res => {
    let buf = '';
    res.on('data', c => {
      buf += c; let i;
      while ((i = buf.indexOf('\n')) > -1) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        try { const j = JSON.parse(line); if (j.error) return finish(onError, new Error(j.error)); if (j.response) onToken && onToken(j.response); if (j.done) finish(onDone); }
        catch (e) { finish(onError, e); }
      }
    });
    res.on('end', () => finish(onDone));
  });
  req.on('error', e => finish(onError, e));
  req.end();
  return () => { done = true; req.destroy(); };
}

module.exports = { ping, listModels, streamGenerate, DEFAULT_MODEL };
