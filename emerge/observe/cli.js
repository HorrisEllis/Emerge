'use strict';
// component_id: emerge.observe.cli · spec: CIE-EG §13.7
//
//   eg debug <ledger.json> blame                      start here: the first struggle, the first unhealthy field, and why
//   eg debug <ledger.json> why <seq>                  the chain back from an entry to what explains it
//   eg debug <ledger.json> at <seq>                   the world after that entry: state, open gaps, field and sigma
//   eg debug <ledger.json> follow [--compartment C] [--signal S] [--kind K] [--from N] [--to N]
//   eg debug <ledger.json> diff <other.json>          the first entry where two runs part ways
//   eg debug <ledger.json> clip <from> <to> [-o f]    a bounded, re-verifiable slice;  eg debug <clip.json> verify-clip
//   eg debug <ledger.json> report                     the whole observation (field, sigma, liminal, gaps) as JSON
// A ledger file is what `eg run --ledger out.json` writes. Add --json to any command for machine output.

const fs = require('fs');
const D = require('./debug');
const { observe } = require('./index');

/** parse a ledger file without losing 64-bit integers: an integer too large for a double is read back as the BigInt it was written as */
function load(file) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text, function (k, v, ctx) { return (typeof v === 'number' && Number.isInteger(v) && !Number.isSafeInteger(v) && ctx && ctx.source) ? BigInt(ctx.source) : v; });
}
const j = v => JSON.stringify(v, (k, x) => typeof x === 'bigint' ? String(x) : x, 2);
const line = c => `  #${c.seq} ${c.summary}${c.via ? `   ← ${c.via}` : ''}`;

function printWhy(w, out) {
  if (!w.ok) return out(`${w.reason}\n`);
  w.before.length && out(`before #${w.seq}:\n${w.before.map(line).join('\n')}\n`);
  out(`why #${w.seq}:\n${w.chain.map(line).join('\n')}\n`);
  if (w.root) out(`root: #${w.root.seq} ${w.root.summary}\n`);
  if (w.consequences.length) out(`then:\n${w.consequences.map(line).join('\n')}\n`);
  out(`(${w.note})\n`);
}

function run(argv, { out = s => process.stdout.write(s), err = s => process.stderr.write(s) } = {}) {
  const args = argv.slice(), flags = {}, rest = [];
  while (args.length) { const a = args.shift(); if (a === '--json') flags.json = true; else if (a === '-o') flags.o = args.shift(); else if (a.startsWith('--')) flags[a.slice(2)] = args.shift(); else rest.push(a); }
  const [file, cmd, ...more] = rest;
  if (!file || !cmd) { err('usage: eg debug <ledger.json> blame | why <seq> | at <seq> | follow | diff <other.json> | clip <from> <to> | verify-clip | report\n'); return 2; }
  let entries; try { entries = load(file); } catch (e) { err(`debug: cannot read ${file}: ${e.message}\n`); return 2; }
  const num = (v, what) => { const n = Number(v); if (!Number.isInteger(n)) throw new Error(`${what} must be an entry number`); return n; };
  try {
    let r;
    if (cmd === 'verify-clip') { r = D.verifyClip(entries.magic ? entries : { magic: 'EG-CLIP', ...entries }); out(flags.json ? j(r) + '\n' : r.ok ? 'clip verifies\n' : `clip fails at ${r.seq ?? '-'}: ${r.reason}\n`); return r.ok ? 0 : 1; }
    if (!Array.isArray(entries)) throw new Error('a ledger file is a JSON list of entries');
    switch (cmd) {
      case 'blame': r = D.blame(entries); if (flags.json) break;
        if (!r.ok) { out(r.reason + '\n'); return 1; }
        out(`${r.entries} entries · field ${r.field} · sigma ${r.sigma} · ${r.open_gaps} open gap(s)\n`);
        if (r.clean) { out('nothing went wrong in this ledger\n'); return 0; }
        if (r.first_stress) { out('\nfirst struggle:\n'); printWhy(r.first_stress, out); }
        if (r.first_unhealthy) out(`\nfield first went ${r.first_unhealthy.regime} at #${r.first_unhealthy.seq}\n`);
        for (const p of r.proposals) out(`\nobserve would open: [${p.type} ${p.pressure}] ${p.message}\n`);
        return 0;
      case 'why': r = D.why(entries, num(more[0], 'why')); if (!flags.json) { printWhy(r, out); return r.ok ? 0 : 1; } break;
      case 'at': r = D.at(entries, num(more[0], 'at')); if (!flags.json) {
        if (!r.ok) { out(r.reason + '\n'); return 1; }
        out(`after #${r.seq}: ${r.entry.summary}\nfield ${r.field.regime} (coherence ${r.field.coherence}, friction ${r.field.friction}, resonance ${r.field.resonance}, entropy ${r.field.entropy}) since #${r.field_regime_since} · sigma ${r.sigma.regime} · velocity ${r.velocity}\n`);
        for (const [n, c] of Object.entries(r.compartments)) out(`  ${n} (declared #${c.declared}): ${j(c.state).replace(/\s+/g, ' ')}\n`);
        for (const g of r.open_gaps) out(`  open gap #${g.seq} [${g.type} ${g.pressure}]${g.occurrences > 1 ? ` ×${g.occurrences}` : ''}\n`);
        return 0; } break;
      case 'follow': r = D.follow(entries, { compartment: flags.compartment, signal: flags.signal, kind: flags.kind, from: flags.from ? Number(flags.from) : undefined, to: flags.to ? Number(flags.to) : undefined });
        if (!flags.json) { out(r.entries.map(c => `  #${c.seq} ${c.summary}`).join('\n') + `\n${r.count} entr${r.count === 1 ? 'y' : 'ies'}\n`); return 0; } break;
      case 'diff': { const other = load(more[0]); r = D.diff(entries, other); if (!flags.json) {
        if (r.identical) { out(`identical: ${r.entries} entries, same hashes\n`); return 0; }
        out(`the runs share ${r.common} entr${r.common === 1 ? 'y' : 'ies'}; they part ways at #${r.first}\n  A: ${r.a ? '#' + r.a.seq + ' ' + r.a.summary : '(ends)'}\n  B: ${r.b ? '#' + r.b.seq + ' ' + r.b.summary : '(ends)'}\n${r.note}\n`);
        for (const [c, s] of Object.entries(r.state_before_diverging_differs)) out(`  ${c} already differed: A ${j(s.a).replace(/\s+/g, ' ')} · B ${j(s.b).replace(/\s+/g, ' ')}\n`);
        return 1; } break; }
      case 'clip': r = D.clip(entries, num(more[0], 'clip from'), num(more[1], 'clip to'));
        if (r.ok && flags.o) { fs.writeFileSync(flags.o, j(r) + '\n'); out(`wrote ${r.count} entries (#${r.seqRange[0]}..#${r.seqRange[1]}) to ${flags.o}\n`); return 0; } break;
      case 'report': r = observe(entries); break;
      default: err(`debug: unknown command ${cmd}\n`); return 2;
    }
    out(j(r) + '\n'); return r.ok === false ? 1 : 0;
  } catch (e) { err(`debug: ${e.message}\n`); return 2; }
}

module.exports = { run, load };
