'use strict';
/**
 * compiler/model.js — the model T2 asks, behind one interface.
 * UUID: spec-compiler-model-v1-0000-2026-1028-jamesbrooks-001
 * Version: 1.0.0
 *
 * §2026-10-28 — T2 used to post to Nexus's Guardian (:7820 /command, then poll /api/seam/status). Emerge depends on
 * nothing above it, so T2 now calls a model:
 *
 *   model.generate(prompt, meta) → { ok, text, error, prompt_tokens, output_tokens }
 *
 * Emerge ships two backends, both talking straight to a local server:
 *   ollama  POST <url>/api/chat              (default url http://localhost:11434)
 *   openai  POST <url>/v1/chat/completions   (llama.cpp server, LM Studio, vLLM; default url http://localhost:8080)
 * Any other backend (Nexus's Guardian is one, kept in Nexus's repo) is a module a project passes in.
 *
 * Settings: createModel({ api, url, model, temperature, ctx, timeoutMs }) or env EMERGE_MODEL_API, EMERGE_MODEL_URL,
 * EMERGE_MODEL (default qwen2.5-coder:7b). Zero dependencies beyond node.
 */

const http  = require('http');
const https = require('https');
const path  = require('path');

function post(url, body, timeoutMs) {
  return new Promise(resolve => {
    let u; try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: 'bad url ' + url }); }
    const lib = u.protocol === 'https:' ? https : http; const data = JSON.stringify(body);
    const req = lib.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => { try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(raw) }); } catch { resolve({ ok: false, error: 'bad reply: ' + raw.slice(0, 200) }); } });
    });
    req.on('error', e => resolve({ ok: false, error: `model server unreachable at ${url}: ${e.message}` }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'model server timed out' }); });
    req.write(data); req.end();
  });
}

function createModel(o = {}) {
  const api = o.api ?? process.env.EMERGE_MODEL_API ?? 'ollama';
  const url = (o.url ?? process.env.EMERGE_MODEL_URL ?? (api === 'openai' ? 'http://localhost:8080' : 'http://localhost:11434')).replace(/\/$/, '');
  const model = o.model ?? process.env.EMERGE_MODEL ?? 'qwen2.5-coder:7b';
  const temperature = o.temperature ?? 0;
  const timeoutMs = o.timeoutMs ?? 600000;
  const name = `${api}:${model}`;
  if (api === 'openai') {
    return { name, async generate(prompt) {
      const r = await post(url + '/v1/chat/completions', { model, messages: [{ role: 'user', content: prompt }], temperature, stream: false }, timeoutMs);
      if (!r.ok) return { ok: false, error: r.error ?? JSON.stringify(r.data?.error ?? r.status) };
      return { ok: true, text: r.data.choices?.[0]?.message?.content ?? '', prompt_tokens: r.data.usage?.prompt_tokens ?? 0, output_tokens: r.data.usage?.completion_tokens ?? 0 };
    } };
  }
  if (api !== 'ollama') throw new Error(`unknown model api "${api}" (ollama | openai, or pass a model object)`);
  return { name, async generate(prompt) {
    const r = await post(url + '/api/chat', { model, messages: [{ role: 'user', content: prompt }], stream: false, options: { temperature, num_ctx: o.ctx ?? 8192 } }, timeoutMs);
    if (!r.ok) return { ok: false, error: r.error ?? r.data?.error ?? String(r.status) };
    return { ok: true, text: r.data.message?.content ?? '', prompt_tokens: r.data.prompt_eval_count ?? 0, output_tokens: r.data.eval_count ?? 0 };
  } };
}

/** loadModel(m) → model. m: a model object · a path to a module exporting one (or createModel()) · settings · undefined */
function loadModel(m) {
  if (typeof m === 'string') {
    const mod = require(path.resolve(m));
    m = typeof mod.createModel === 'function' ? mod.createModel() : (mod.model ?? mod);
  }
  if (m && typeof m.generate === 'function') return { name: m.name ?? 'custom', generate: m.generate.bind(m) };
  return createModel(m ?? {});
}

module.exports = { createModel, loadModel, MODULE_ID: 'spec-compiler-model', VERSION: '1.0.0' };
