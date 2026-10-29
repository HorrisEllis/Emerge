'use strict';
// ════════════════════════════════════════════════════════════════════════════
// EMERGE KERNEL v1.0.0
// UUID: emerge-kernel-js-seed-v1-0-0
// The JS seed. Reads .spec → builds SNR gate → compiles .emerge/.eg → outputs.
// Drop files in /io — .spec updates schema, .emerge/.eg compiles through gate.
// This file is the bootstrap. emerge-kernel.emerge will replace it.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT   = __dirname;
const IO     = path.join(ROOT, 'io');
const SPEC   = path.join(ROOT, 'emerge.spec');

fs.mkdirSync(IO, { recursive: true });

// ── Spec state (loaded from emerge.spec, hot-reloadable) ──────────────────────
let SCHEMA = {
  keywords:   new Set(),
  domains:    new Map(),   // name → [keywords]
  axioms:     new Set(),
  gap_types:  new Set(),
  root_types: new Set(),
  invariants: [],
  laws:       [],
  version:    '0.0.0',
};

// ── SPEC PARSER ───────────────────────────────────────────────────────────────
// Reads emerge.spec → populates SCHEMA
// The spec IS the SNR gate's definition of what is valid signal vs noise.

function loadSpec(specPath) {
  if (!fs.existsSync(specPath)) {
    console.warn('[kernel] no spec found — running with empty schema');
    return;
  }
  const src  = fs.readFileSync(specPath, 'utf8');
  const next = {
    keywords:   new Set(),
    domains:    new Map(),
    axioms:     new Set(),
    gap_types:  new Set(),
    root_types: new Set(),
    invariants: [],
    laws:       [],
    version:    '0.0.0',
  };

  let currentDomain = null;

  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;

    // version
    const ver = line.match(/^version\s+([\d.]+)/);
    if (ver) { next.version = ver[1]; continue; }

    // domain declaration
    const dom = line.match(/^domain\s+"?([^"]+)"?/);
    if (dom) { currentDomain = dom[1]; next.domains.set(currentDomain, []); continue; }

    // axiom
    const ax = line.match(/^axiom\s+([A-Z_]+)/);
    if (ax) { next.axioms.add(ax[1]); next.keywords.add('axiom'); continue; }

    // gap type
    const gt = line.match(/^gap\.(\w+)/);
    if (gt) { next.gap_types.add(gt[1]); next.keywords.add('gap'); continue; }

    // root type
    const rt = line.match(/^root\s+(\w+)/);
    if (rt) { next.root_types.add(rt[1]); continue; }

    // law
    const lw = line.match(/^law\s+([A-Z_]+)/);
    if (lw) { next.laws.push(lw[1]); next.keywords.add('law'); continue; }

    // keyword = definition (any line with = is a keyword definition)
    const kw = line.match(/^(\w+)\s*=/);
    if (kw) {
      const k = kw[1];
      next.keywords.add(k);
      if (currentDomain) next.domains.get(currentDomain).push(k);
      continue;
    }
  }

  SCHEMA = next;
  console.log(`[kernel] spec loaded v${SCHEMA.version} — ${SCHEMA.keywords.size} keywords, ${SCHEMA.axioms.size} axioms, ${SCHEMA.gap_types.size} gap types`);
}

// ── SNR GATE ──────────────────────────────────────────────────────────────────
// Every token/construct in source is a signal.
// Gate scores it. Pass → IR. Noise → logged, never dropped.
//
// Score vector: raw_snr · fidelity · integrity · polarity · oscillation · recency
// Weights from spec (defaults match emerge-spec v1.0.0):

const WEIGHTS = { raw_snr: 0.35, fidelity: 0.20, integrity: 0.20, polarity: 0.10, oscillation: 0.05, recency: 0.10 };
const GATE    = 0.42;

function scoreToken(tok, ctx) {
  // raw_snr: is this token a known keyword or valid literal?
  const raw_snr = SCHEMA.keywords.has(tok.value) || tok.type !== 'WORD' ? 1.0 : 0.1;

  // fidelity: does it appear in expected position for its domain?
  const fidelity = ctx.domainExpects && ctx.domainExpects.includes(tok.value) ? 1.0 : 0.5;

  // integrity: is it structurally complete (has required fields)?
  const integrity = tok.complete ? 1.0 : 0.6;

  // polarity: known keyword = POSITIVE (1.0), unknown = NEGATIVE (-1.0 → 0.0 after clamp)
  const polarity = SCHEMA.keywords.has(tok.value) ? 1.0 : 0.0;

  // oscillation: how many times has this token type appeared recently? (novelty bonus)
  const occ = ctx.seen.get(tok.value) || 0;
  const oscillation = occ === 0 ? 1.0 : occ < 3 ? 0.7 : 0.4;

  // recency: tokens early in file are more load-bearing (definitions), score slightly higher
  const recency = Math.max(0.3, 1.0 - (ctx.position / (ctx.total || 1)) * 0.4);

  const composite =
    raw_snr       * WEIGHTS.raw_snr       +
    fidelity      * WEIGHTS.fidelity      +
    integrity     * WEIGHTS.integrity     +
    polarity      * WEIGHTS.polarity      +
    oscillation   * WEIGHTS.oscillation   +
    recency       * WEIGHTS.recency;

  return { composite, raw_snr, fidelity, integrity, polarity, oscillation, recency };
}

function snrGate(tokens, sourceName) {
  const passed = [];
  const noise  = [];
  const seen   = new Map();
  const total  = tokens.length;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const ctx = {
      position: i,
      total,
      seen,
      domainExpects: inferDomainExpects(tok, tokens, i),
    };

    const score = scoreToken(tok, ctx);
    seen.set(tok.value, (seen.get(tok.value) || 0) + 1);

    if (score.composite >= GATE) {
      passed.push({ ...tok, score });
    } else {
      noise.push({ ...tok, score, reason: 'below_gate_threshold' });
      // NOISE_IS_LOGGED — never silently dropped
      console.warn(`[snr] noise: "${tok.value}" @ line ${tok.line} — score ${score.composite.toFixed(3)} < ${GATE}`);
    }
  }

  return { passed, noise, snr: passed.length / Math.max(total, 1) };
}

function inferDomainExpects(tok, tokens, i) {
  // Walk back to find enclosing domain keyword
  for (let j = i - 1; j >= 0; j--) {
    const v = tokens[j].value;
    if (SCHEMA.domains.has(v)) return SCHEMA.domains.get(v) || [];
  }
  return [];
}

// ── TOKENIZER ─────────────────────────────────────────────────────────────────

function tokenize(src) {
  const tokens = [];
  const lines  = src.split('\n');

  for (let li = 0; li < lines.length; li++) {
    const raw   = lines[li];
    const line  = raw.trim();
    if (!line || line.startsWith('//')) continue;

    const indent = raw.match(/^(\s*)/)[1].length;
    const parts  = line.split(/\s+/);

    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi];
      if (!p) continue;

      let type = 'WORD';
      if (p === '->') type = 'ROUTE';
      else if (p === '=')  type = 'DEF';
      else if (p === '{')  type = 'OPEN';
      else if (p === '}')  type = 'CLOSE';
      else if (p === '|')  type = 'OR';
      else if (/^"/.test(p)) type = 'STRING';
      else if (/^\d/.test(p)) type = 'NUMBER';
      else if (/^\[/.test(p)) type = 'RANGE';
      else if (SCHEMA.keywords.has(p)) type = 'KEYWORD';

      tokens.push({
        type,
        value:    p,
        line:     li + 1,
        col:      pi,
        indent,
        complete: true,  // extended validation would set this per construct
      });
    }
  }

  return tokens;
}

// ── PARSER → IR ───────────────────────────────────────────────────────────────
// Passed tokens → Intermediate Representation
// IR is the kernel's in-memory model of the source

function parse(passed) {
  const ir = {
    compartments: [],
    invariants:   [],
    signals:      [],
    gaps:         [],
    laws:         [],
    loops:        [],
    whatifs:      [],
    ledger:       [],
    identity:     null,
    outputs:      [],
    meta:         { keywords_used: new Set(), domains_touched: new Set() },
  };

  // Only parse top-level constructs (indent === 0)
  const TOP_LEVEL = new Set(['compartment','invariant','signal','gap','law','loop','whatif','ledger','output']);

  for (let i = 0; i < passed.length; i++) {
    const tok = passed[i];
    if (!tok || tok.indent !== 0 || !TOP_LEVEL.has(tok.value)) continue;

    const block = parseBlock(passed, i + 1, tok.value);

    switch (tok.value) {
      case 'compartment': ir.compartments.push(block); break;
      case 'invariant':   ir.invariants.push(block);   break;
      case 'signal':      ir.signals.push(block);      break;
      case 'gap':         ir.gaps.push(block);         break;
      case 'law':         ir.laws.push(block);         break;
      case 'loop':        ir.loops.push(block);        break;
      case 'whatif':      ir.whatifs.push(block);      break;
      case 'ledger':      ir.ledger.push(block);       break;
      case 'output':      ir.outputs.push(block);      break;
    }
    ir.meta.keywords_used.add(tok.value);
  }

  return ir;
}

function parseBlock(tokens, startIdx, kind) {
  const block = { kind, name: null, fields: {}, body: [] };
  if (!tokens[startIdx]) return block;

  let si = startIdx;

  // name: first STRING or WORD that isn't OPEN
  if (tokens[si]?.type === 'STRING' || (tokens[si]?.type === 'WORD' && tokens[si]?.value !== '{')) {
    block.name = tokens[si].value.replace(/"/g, '');
    si++;
  }

  // skip opening brace if present
  const hasBrace = tokens[si]?.type === 'OPEN';
  if (hasBrace) si++;

  const baseIndent  = tokens[startIdx]?.indent ?? 0;
  let   braceDepth  = hasBrace ? 1 : 0;

  for (let j = si; j < tokens.length; j++) {
    const t = tokens[j];

    if (hasBrace) {
      if (t.type === 'OPEN')  { braceDepth++; continue; }
      if (t.type === 'CLOSE') { braceDepth--; if (braceDepth <= 0) break; continue; }
    } else {
      if (t.indent <= baseIndent) break;
    }

    // field: key = value
    if (t.type === 'DEF') {
      const key = tokens[j - 1]?.value;
      const val = tokens[j + 1]?.value;
      if (key && val) block.fields[key] = val;
    }

    block.body.push(t.value);
  }

  return block;
}

// ── VALIDATOR (axiom checker) ─────────────────────────────────────────────────
// Runs the spec's axioms against the IR.
// Produces gap records for every violation — never throws.

function validate(ir, sourceName) {
  const gaps    = [];
  const report  = { valid: true, gaps };

  const gap = (type, msg, pressure = 0.8, loc = null) => {
    const entry = {
      type, msg, message: msg,  // message alias for backward compat
      pressure, loc,
      source: 'validate',       // source field for backward compat
    };
    gaps.push(entry);
    if (pressure >= 0.9) report.valid = false;
    return entry;
  };
  const _gap = gap;

  // EXECUTION_IS_TRACEABLE — every compartment needs identity
  for (const co of ir.compartments) {
    if (!co.fields.id && !co.fields.uuid && !co.fields.shortid) {
      gap('gap.structural', `compartment "${co.name}" has no identity (id/uuid) — EXECUTION_IS_TRACEABLE violated`, 0.9);
    }
  }

  // NO_SILENT_DROP — no bare catch or swallow patterns (heuristic on body tokens)
  for (const co of ir.compartments) {
    if (co.body.includes('catch') && !co.body.includes('log') && !co.body.includes('emit')) {
      gap('gap.structural', `compartment "${co.name}" may silently drop — NO_SILENT_DROP violated`, 1.0);
    }
  }

  // GAP_IS_FIRST_CLASS — every gap must have pressure declared
  for (const g of ir.gaps) {
    if (!g.fields.pressure) {
      gap('gap.evidential', `gap "${g.name}" missing pressure field — GAP_IS_FIRST_CLASS requires it`, 0.7);
    }
  }

  // RECORD_IS_TRUTH — loops must contain record
  for (const lp of ir.loops) {
    if (!lp.body.includes('record')) {
      gap('gap.temporal', `loop "${lp.name}" has no record call — RECORD_IS_TRUTH violated`, 0.85);
    }
  }

  // PROOF_REQUIRED_FOR_PROMOTION — any promote call needs adjacent proof
  for (const co of ir.compartments) {
    const b = co.body;
    const promoteIdx = b.indexOf('promote');
    if (promoteIdx !== -1) {
      const window = b.slice(Math.max(0, promoteIdx - 3), promoteIdx + 3);
      if (!window.includes('proof')) {
        gap('gap.logical', `compartment "${co.name}" calls promote without proof — PROOF_REQUIRED_FOR_PROMOTION violated`, 0.9);
      }
    }
  }

  return report;
}

// ── EMITTER ───────────────────────────────────────────────────────────────────
// Validated IR → runnable kernel object
// The kernel object IS the runtime — it has boot(), ingest(), status()

function emit(ir, sourceName) {
  const kernel = {
    id:           `kernel-${Date.now()}`,
    source:       sourceName,
    compartments: new Map(),
    noise_ring:   [],
    event_log:    [],
    stats:        { ingested: 0, passed: 0, noise: 0, gaps: 0 },
    running:      false,
    schema_ver:   SCHEMA.version,

    boot() {
      this.running = true;
      // Register compartments from IR
      for (const co of ir.compartments) {
        this.compartments.set(co.name || co.fields.id || `co-${Date.now()}`, {
          ...co, fidelity: 0.5, phase: 0.0, stats: { passed: 0, noise: 0 }
        });
      }
      this._emit('kernel.booted', { compartments: this.compartments.size, source: sourceName });
      console.log(`[kernel] booted — ${this.compartments.size} compartments from ${sourceName}`);
      return this;
    },

    // Co → I → In → O → Co
    ingest(signal) {
      if (!this.running) return { passed: false, reason: 'kernel_not_running' };
      this.stats.ingested++;

      const tokens = tokenize(typeof signal === 'string' ? signal : JSON.stringify(signal));
      const { passed, noise, snr } = snrGate(tokens, sourceName);

      this.stats.noise += noise.length;
      for (const n of noise) this.noise_ring.push({ ...n, ts: Date.now() });
      if (this.noise_ring.length > 5000) this.noise_ring.splice(0, this.noise_ring.length - 5000);

      if (passed.length > 0) {
        this.stats.passed++;
        this._emit('signal.passed', { snr, tokens: passed.length });
        return { passed: true, snr, ir: parse(passed) };
      } else {
        this.stats.noise++;
        this._emit('signal.noise', { snr, reason: 'all_tokens_below_gate' });
        return { passed: false, snr, reason: 'all_tokens_below_gate', noise };
      }
    },

    status() {
      return {
        running:      this.running,
        schema_ver:   this.schema_ver,
        compartments: this.compartments.size,
        stats:        this.stats,
        snr:          this.stats.ingested > 0
                        ? (this.stats.passed / this.stats.ingested).toFixed(3)
                        : 'n/a',
        regime:       this._regime(),
      };
    },

    _regime() {
      const snr = this.stats.ingested > 0 ? this.stats.passed / this.stats.ingested : 1;
      if (snr > 0.85)  return 'stable';
      if (snr > 0.5)   return 'degraded';
      if (snr > 0.2)   return 'collapsing';
      return 'oscillatory';
    },

    _emit(type, payload) {
      const ev = { type, payload, ts: Date.now() };
      this.event_log.push(ev);
      if (this.event_log.length > 5000) this.event_log.splice(0, this.event_log.length - 5000);
    },
  };

  return kernel;
}

// ── COMPILE ───────────────────────────────────────────────────────────────────
// Full pipeline: source → tokenize → SNR gate → parse → validate → emit kernel

function compile(src, sourceName) {
  console.log(`\n[kernel] compiling ${sourceName}`);

  const tokens          = tokenize(src);
  const { passed, noise, snr } = snrGate(tokens, sourceName);
  console.log(`[snr] ${passed.length} signal / ${noise.length} noise — SNR ${(snr * 100).toFixed(1)}%`);

  const ir              = parse(passed);
  const validation      = validate(ir, sourceName);

  if (!validation.valid) {
    console.warn(`[kernel] ${validation.gaps.length} gap(s) detected:`);
    for (const g of validation.gaps) {
      console.warn(`  [${g.type}] ${g.message} (pressure ${g.pressure})`);
    }
  }

  const kernel = emit(ir, sourceName);

  return { kernel, ir, snr, noise, gaps: validation.gaps, valid: validation.valid };
}

// ── IO WATCHER ────────────────────────────────────────────────────────────────
// Watches /io directory.
// .spec  → loadSpec (updates schema / SNR gate definition)
// .emerge / .eg → compile → write output to /io/<name>.out.json

function processFile(filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  const src  = fs.readFileSync(filePath, 'utf8');

  if (ext === '.spec') {
    console.log(`\n[kernel] spec update detected — ${base}`);
    loadSpec(filePath);
    // Copy as canonical spec
    fs.copyFileSync(filePath, SPEC);
    writeOutput(filePath, { event: 'spec_updated', version: SCHEMA.version, keywords: SCHEMA.keywords.size });
    return;
  }

  if (ext === '.emerge' || ext === '.eg') {
    const result = compile(src, base);
    result.kernel.boot();

    const out = {
      source:    base,
      compiled:  true,
      snr:       result.snr,
      valid:     result.valid,
      gaps:      result.gaps,
      status:    result.kernel.status(),
      ir_summary: {
        compartments: result.ir.compartments.length,
        invariants:   result.ir.invariants.length,
        gaps:         result.ir.gaps.length,
        loops:        result.ir.loops.length,
        laws:         result.ir.laws.length,
      },
      noise_count: result.noise.length,
    };

    writeOutput(filePath, out);
    console.log(`[kernel] → ${base.replace(ext, '.out.json')} — regime: ${result.kernel.status().regime}`);
    return;
  }

  console.log(`[kernel] ignored ${base} (unknown type)`);
}

function writeOutput(inputPath, data) {
  const outName = path.basename(inputPath).replace(/\.[^.]+$/, '.out.json');
  const outPath = path.join(IO, outName);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
}

function watchIO() {
  console.log(`[kernel] watching ${IO}`);
  // §2026-10-28 — emerge's own watcher (was ../safe-watch.js, from the Nexus tree above emerge/): fs.watch, with errors
  // reported instead of crashing the kernel.
  const safeWatch = (dir, cb) => {
    try { const w = fs.watch(dir, cb); w.on('error', e => console.error(`[kernel] watch error on ${dir}: ${e.message}`)); return w; }
    catch (e) { console.error(`[kernel] cannot watch ${dir}: ${e.message}`); return null; }
  };
  safeWatch(IO, (event, filename) => {
    if (!filename) return;
    const fp  = path.join(IO, filename);
    const ext = path.extname(filename).toLowerCase();
    if (!['.spec', '.emerge', '.eg'].includes(ext)) return;
    if (!fs.existsSync(fp)) return;
    setTimeout(() => processFile(fp), 50); // debounce
  });
}

// ── EXPORT (for CLI and self-compilation) ─────────────────────────────────────
module.exports = { 
  compile, 
  tokenize, 
  snrGate, 
  parse, 
  validate, 
  loadSpec, 
  get SCHEMA() { return SCHEMA; } 
};
// ── BOOT ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  loadSpec(SPEC);
  watchIO();
  console.log('[kernel] ready — drop .spec / .emerge / .eg into ./io');
}

// ── EMITTER TARGETS ───────────────────────────────────────────────────────────
// Extends the kernel to produce real files from .emerge output declarations.
// A component can declare emit targets — the kernel writes them on compile.
//
// Syntax in .emerge:
//   output "filename.ext" {
//     type = file
//     content = <template-key>
//   }

const EMIT_TEMPLATES = {};

function registerTemplate(key, fn) {
  EMIT_TEMPLATES[key] = fn;
}

function emitFiles(ir, outDir, sourceName) {
  const written = [];
  const fs2 = require('fs');
  const path2 = require('path');

  for (const out of (ir.outputs || [])) {
    const name    = out.name;
    const tmplKey = out.fields.content || out.fields.template;
    const type    = out.fields.type || 'file';
    if (!name || type !== 'file') continue;

    const content = EMIT_TEMPLATES[tmplKey]
      ? EMIT_TEMPLATES[tmplKey](ir, out)
      : (out.fields.raw || '');

    if (!content) { console.warn(`[emitter] no content for output "${name}"`); continue; }

    const dest = path2.join(outDir, name);
    fs2.writeFileSync(dest, content);
    written.push(dest);
    console.log(`[emitter] → ${dest}`);
  }
  return written;
}

module.exports.emitFiles        = emitFiles;
module.exports.registerTemplate = registerTemplate;
module.exports.EMIT_TEMPLATES   = EMIT_TEMPLATES;
