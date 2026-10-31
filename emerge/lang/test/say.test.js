'use strict';
// emerge/lang/test/say.test.js — emerge/spec/say.spec: his words in, Emerge out, no model.
// James, 2026-10-31: "im trying to remove as much friction from me and the code as possibel"
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const lang = require('../index');

const EG = path.join(__dirname, '..', 'eg.js');
const SAYDIR = path.join(__dirname, '..', 'say');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'emerge-say-'));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('✓ ' + name); } catch (e) { fail++; console.log('✗ ' + name + '\n    ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const run = (args, cwd) => spawnSync(process.execPath, [EG, ...args], { encoding: 'utf8', cwd });
const say = (sentence, dir = SAYDIR) => {
  const r = run(['run', path.join(dir, 'say.eg'), 'say', sentence]);
  ok(r.status === 0, 'say.eg failed: ' + r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};
const runFile = (src, name, node) => {
  const f = path.join(TMP, name + '.eg');
  fs.writeFileSync(f, src);
  if (node) fs.writeFileSync(path.join(TMP, name + '.node'), node);
  return { run: run(['run', f]), test: run(['test', f]) };
};

const INBOX = 'a compartment called Inbox with messages, never negative. when a message comes in add 1 to messages. record it, test it. the end state is every message counted once';

t('a sentence in his words becomes a compartment that checks, runs and passes its own test', () => {
  const r = say(INBOX);
  ok(r.ok && r.name === 'inbox', JSON.stringify(r).slice(0, 300));
  ok(lang.compileSource(r.source, 'inbox.eg').errors.length === 0, 'checker errors');
  for (const want of ['use "./inbox.node" as node', 'compartment Inbox', 'intent = "every message counted once"', 'state { messages: start.messages }', 'constraint messages_never_negative hard', 'on "inbox.message"', 'state.messages += o.message_messages_by', 'record "inbox.message"', 'test "Inbox keeps its gates"'])
    ok(r.source.includes(want), 'missing: ' + want);
  const x = runFile(r.source, 'inbox', r.node);
  ok(x.run.status === 0 && /Inbox \{messages: 1\}/.test(x.run.stdout), 'run: ' + x.run.stdout + x.run.stderr);
  ok(/1 passed, 0 failed/.test(x.test.stdout), 'test: ' + x.test.stdout);
});

t('the same sentence gives the same source, byte for byte', () => ok(say(INBOX).source === say(INBOX).source, 'differs'));

t('every word understood is shown with his own quote and its date', () => {
  const r = say(INBOX);
  ok(/"compartment" → /.test(r.report) && /you: "im saying to add that to cos/.test(r.report) && /2026-10-07/.test(r.report), r.report);
});

t('a sovereign system is a component with a door; at most N is a boundary; log it records', () => {
  const r = say('a sovereign system called Vault holding coins, at most 100 coins, log it');
  ok(r.ok, r.report);
  for (const want of ['component Vault', 'namespace = "vault"', 'boundary coins_at_most { state.coins <= o.max_coins }', 'in input(x: { value: num })', 'record "vault.input"', 'wire "vault.in" -> Vault.input', 'wire Vault.result -> "vault.out"'])
    ok(r.source.includes(want), 'missing: ' + want);
  ok(runFile(r.source, 'vault', r.node).run.status === 0, 'vault does not run');
  ok(JSON.parse(r.node).payload.options.max_coins === 100, 'max_coins is not a lever in the node file');
});

t('events on a component, add and remove by a number, and its test checks the gate', () => {
  const r = say('a component called Meter with level. when a tick arrives add 5 to level. when a drain comes remove 2 from level. never negative. test first');
  ok(r.ok, r.report);
  for (const want of ['in tick(x: { value: num })', 'state.level += o.tick_level_by', 'state.level -= o.drain_level_by', 'boundary level_never_negative', 'expect Meter.state.level >= 0'])
    ok(r.source.includes(want), 'missing: ' + want);
  const x = runFile(r.source, 'meter', r.node);
  ok(/Meter \{level: 3\}/.test(x.run.stdout) && /1 passed, 0 failed/.test(x.test.stdout), x.run.stdout + x.test.stdout);
});

t('an unknown word is a gap, named with the command that teaches it; nothing is written', () => {
  const r = say('a compartment called Pantry holding jars. whenever a jar lands, bump jars');
  ok(!r.ok && r.source === '', 'wrote source despite a gap');
  ok(/"bump" is not in your words yet — say: eg teach "bump" as <word>/.test(r.report), r.report);
});

t('what it is and what it is called are gaps when missing, never guessed', () => {
  const r = say('make a thing that shimmers');
  ok(!r.ok && /what it is — /.test(r.report) && /what it is called — /.test(r.report) && /"shimmers"/.test(r.report), r.report);
});

t('teach closes a gap for good (on a copy of the vocabulary)', () => {
  const dir = path.join(TMP, 'say');
  fs.mkdirSync(dir);
  for (const f of ['say.eg', 'words.eg', 'taught.eg']) fs.copyFileSync(path.join(SAYDIR, f), path.join(dir, f));
  const r = run(['run', path.join(dir, 'say.eg'), 'teach', 'bump', 'add']);
  ok(r.status === 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  ok(lang.compileSource(out.text, 'taught.eg').errors.length === 0, 'taught.eg would not check');
  fs.writeFileSync(path.join(dir, 'taught.eg'), out.text);
  const s = say('a compartment called Pantry holding jars. bump jars. never negative', dir);
  ok(s.ok && s.source.includes('state.jars += o.change_jars_by') && /"bump" \(you taught it\)/.test(s.report), s.report);
  const again = run(['run', path.join(dir, 'say.eg'), 'teach', 'bump', 'add']);
  ok(again.status !== 0 && /already in your words/.test(again.stderr + again.stdout), 'taught the same phrase twice');
  const bad = run(['run', path.join(dir, 'say.eg'), 'teach', 'zap', 'nothing']);
  ok(bad.status !== 0 && /not one of your words/.test(bad.stderr + bad.stdout), 'taught a phrase as a word that does not exist');
});

t('every word in his vocabulary carries his quote with a date, and no phrase belongs to two words', () => {
  const dir = path.join(TMP, 'audit');
  fs.mkdirSync(dir);
  fs.copyFileSync(path.join(SAYDIR, 'words.eg'), path.join(dir, 'words.eg'));
  const f = path.join(dir, 'audit.eg');
  fs.writeFileSync(f, `use "./words.eg" as lex
var seen = []
var bad = []
for e in lex.words {
  if len(e.forms) == 0 or e.means == "" or len(e.from) == 0 { bad = push(bad, e.does) }
  for q in e.from {
    if q.said == "" or not (q.date matches "^[0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}$" or q.date == "undated") { bad = push(bad, e.does) }
  }
  for fm in e.forms {
    if seen contains fm { bad = push(bad, "two words share " + fm) }
    seen = push(seen, fm)
  }
}
print(len(lex.words), "words", len(bad), "problems", bad)
`);
  const r = run(['run', f]);
  ok(/^28 words 0 problems/.test(r.stdout), r.stdout + r.stderr);
});

// ── 2026-10-31 (say 0.2): his rule and his systems words ──
// James: "only using hardcoded when neccarry, using external node files for data, options, etc." ·
// "leverage. friction. tension. ripples. compound. … what ifs, if thens, else,"
const GARDEN = 'a compartment called Garden with plants, at most 50 plants with friction. when rain falls add 3 to plants, plants compound by 10 percent, ripple to bloom. if plants over 40 then gap the garden is crowded else record it. what if rain falls. tension 0.7. test it';

t('every number he says is a named lever in the node file, never a literal in the code; starting data too', () => {
  const r = say(GARDEN);
  ok(r.ok, r.report);
  const n = JSON.parse(r.node);
  ok(n.envelope === 1 && n.id === 'garden' && n.type === 'options' && Array.isArray(n.tags), 'not his node envelope: ' + r.node);
  const o = n.payload.options;
  ok(o.rain_falls_plants_by === 3 && o.plants_rate === 0.1 && o.rain_falls_plants_over === 40 && o.tension === 0.7 && o.max_plants === 50, JSON.stringify(o));
  ok(n.payload.start.plants === 0, 'starting data is not in the node file');
  const code = r.source.split('\n').filter(l => !l.startsWith('//')).join('\n');
  for (const lit of ['3', '0.1', '40', '0.7', '50']) ok(!new RegExp('[^.\\w]' + lit.replace('.', '\\.') + '(?![\\w.])').test(code), 'a said number is hardcoded: ' + lit);
});

t('friction resists at a cost (a soft gate); compound grows by its rate; a ripple sets off the next event', () => {
  const r = say(GARDEN);
  for (const want of ['constraint plants_at_most soft { state.plants <= o.max_plants }', 'state.plants += state.plants * o.plants_rate', 'emit "garden.bloom" { plants: state.plants }', 'on "garden.bloom" (e) { print("ripple: bloom", e) }'])
    ok(r.source.includes(want), 'missing: ' + want);
});

t('if / then / else becomes a condition; a gap opens with his tension as its pressure', () => {
  const r = say('a compartment called Pot with heat. when fire burns add 10 to heat. if heat over 90 then gap the pot is boiling else ripple to simmer. tension 0.8');
  ok(r.ok, r.report);
  for (const want of ['if state.heat > o.fire_burns_heat_over {', 'gap "the pot is boiling" pressure o.tension', '} else {', 'emit "pot.simmer"'])
    ok(r.source.includes(want), 'missing: ' + want);
  ok(JSON.parse(r.node).payload.options.tension === 0.8, 'tension is not the lever he said');
});

t('what if previews in a fork and leaves the real state untouched', () => {
  const r = say(GARDEN);
  const x = runFile(r.source, 'garden', r.node);
  ok(/what if rain_falls: \{plants: 3\.3\} — still: \{plants: 0\}/.test(x.run.stdout), x.run.stdout + x.run.stderr);
  ok(/1 passed, 0 failed/.test(x.test.stdout), x.test.stdout);
});

t('a lever changed in the node file changes what the code does, with no change to the code', () => {
  const r = say('a compartment called Savings with balance. when payday comes add 100 to balance. balance compounds by 5 percent. never negative');
  ok(r.ok, r.report);
  const a = runFile(r.source, 'savings', r.node).run.stdout;
  ok(/Savings \{balance: 105\}/.test(a), a);
  fs.writeFileSync(path.join(TMP, 'savings.node'), r.node.replace('"payday_balance_by": 100', '"payday_balance_by": 250'));
  const b = run(['run', path.join(TMP, 'savings.eg')]).stdout;
  ok(/Savings \{balance: 262\.5\}/.test(b), b);
});

t('a gap with no tension said still has its pressure in the node file, and the report says so', () => {
  const r = say('a compartment called Shelf with books. when a book arrives add 1 to books. if books over 20 then gap the shelf is full');
  ok(r.ok && JSON.parse(r.node).payload.options.tension === 0.5 && /tension was not said: 0\.5 is in the node file/.test(r.report), r.report);
});

t('a node file is loaded by use, checked by eg check, and copied by eg build', () => {
  const dir = path.join(TMP, 'nodeuse');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'k.node'), '{ "envelope": 1, "id": "k", "payload": { "options": { "n": 2.5 } } }\n');
  fs.writeFileSync(path.join(dir, 'k.eg'), 'use "./k.node" as node\nprint(node.id, node.payload.options.n * 2)\n');
  ok(/k 5/.test(run(['run', path.join(dir, 'k.eg')]).stdout), 'use of a node file');
  const b = run(['build', path.join(dir, 'k.eg'), '-o', path.join(dir, 'out')]);
  ok(b.status === 0 && fs.existsSync(path.join(dir, 'out', 'k.node')), 'build did not copy the node file: ' + b.stderr);
  ok(/k 5/.test(spawnSync(process.execPath, [path.join(dir, 'out', 'k.js')], { encoding: 'utf8' }).stdout), 'built program');
  fs.writeFileSync(path.join(dir, 'k.node'), '{ not json');
  const c = run(['check', path.join(dir, 'k.eg')]);
  ok(c.status !== 0 && /node file:/.test(c.stderr), 'eg check passed a broken node file');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
