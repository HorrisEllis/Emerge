'use strict';
// the IDE's generators must always write .eg that checks clean; its vocabulary must come from the language itself
const assert = require('assert');
const { GENERATORS, vocab, diagnostics } = require('../ide');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };
console.log('\nide: generators and vocabulary');
for (const k of Object.keys(GENERATORS)) {
  t(`gen ${k} checks clean, with no warnings`, () => { const d = diagnostics(GENERATORS[k]('Demo'), 'demo.eg'); assert.deepStrictEqual(d.items, []); });
}
t('vocabulary has keywords, types and builtins read from the language', () => {
  const w = new Set(vocab().map(x => x.w));
  for (const x of ['compartment', 'whatif', 'int', 'push', 'filter', 'len']) assert.ok(w.has(x), x);
});
t('diagnostics report line and column', () => { const d = diagnostics('let x = y\n', 'a.eg'); assert.ok(!d.ok && d.items[0].line === 1); });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
