'use strict';
// emerge/lang/test/learn.test.js — emerge/spec/learn.spec: lessons that break themselves down.
// James, 2026-10-31: "dynamically breaks lessons down to help comprehention and reduce overwhlem"
const path = require('path');
const { spawnSync } = require('child_process');
const EG = path.join(__dirname, '..', 'eg.js');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('✓ ' + name); } catch (e) { fail++; console.log('✗ ' + name + '\n    ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const learn = (...a) => spawnSync(process.execPath, [EG, 'learn', ...a], { encoding: 'utf8' }).stdout;

t('eg learn lists the lessons', () => ok(/2s\s+2½ · Say it in your words/.test(learn()), learn()));
t('the stub is the idea and one thing to try', () => {
  const v = learn('2', '--stub');
  ok(/the stub/.test(v) && /A compartment keeps its own memory/.test(v) && /Add a `"put"` signal/.test(v), v);
});
t('a step at a time, and m opens a line into its words, plainly and exactly', () => {
  ok(/step 2 of \d+ · one step/.test(learn('2', '--keys', 'n')), 'n');
  const w = learn('2', '--keys', 'm');
  ok(/one word/.test(w) && /plainly: A box with its own memory and rules/.test(w) && /exactly: /.test(w), w);
});
t('code is cut small, and each explanation sits with the code it explains', () => {
  const v = learn('2', '--keys', 'nnn');
  ok(/on "take" \(e\)/.test(v) && /working copy of its memory/.test(v), v);
});
t('opening steps again and again makes the next ones open line by line, and it says so', () => {
  const v = learn('2', '--keys', 'mnnmnnnnnnnn');
  ok(/one line/.test(v) && /You opened the last 2 steps, so from here each step opens line by line/.test(v), v);
});
t('the same keys always give the same view', () => ok(learn('3', '--keys', 'nmnn') === learn('3', '--keys', 'nmnn'), 'differs'));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
