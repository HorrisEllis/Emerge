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
const runFile = (src, name) => {
  const f = path.join(TMP, name + '.eg');
  fs.writeFileSync(f, src);
  return { run: run(['run', f]), test: run(['test', f]) };
};

const INBOX = 'a compartment called Inbox with messages, never negative. when a message comes in add 1 to messages. record it, test it. the end state is every message counted once';

t('a sentence in his words becomes a compartment that checks, runs and passes its own test', () => {
  const r = say(INBOX);
  ok(r.ok && r.name === 'inbox', JSON.stringify(r).slice(0, 300));
  ok(lang.compileSource(r.source, 'inbox.eg').errors.length === 0, 'checker errors');
  for (const want of ['compartment Inbox', 'intent = "every message counted once"', 'constraint messages_never_negative hard', 'on "inbox.message"', 'record "inbox.message"', 'test "Inbox keeps its gates"'])
    ok(r.source.includes(want), 'missing: ' + want);
  const x = runFile(r.source, 'inbox');
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
  for (const want of ['component Vault', 'namespace = "vault"', 'boundary coins_at_most_100', 'in input(x: { value: num })', 'record "vault.input"', 'wire "vault.in" -> Vault.input', 'wire Vault.result -> "vault.out"'])
    ok(r.source.includes(want), 'missing: ' + want);
  ok(runFile(r.source, 'vault').run.status === 0, 'vault does not run');
});

t('events on a component, add and remove by a number, and its test checks the gate', () => {
  const r = say('a component called Meter with level. when a tick arrives add 5 to level. when a drain comes remove 2 from level. never negative. test first');
  ok(r.ok, r.report);
  for (const want of ['in tick(x: { value: num })', 'state.level += 5', 'state.level -= 2', 'boundary level_never_negative', 'expect Meter.state.level >= 0'])
    ok(r.source.includes(want), 'missing: ' + want);
  const x = runFile(r.source, 'meter');
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
  ok(s.ok && s.source.includes('state.jars += 1') && /"bump" \(you taught it\)/.test(s.report), s.report);
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
  ok(/^15 words 0 problems/.test(r.stdout), r.stdout + r.stderr);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
