const { Tank } = require('./solution');
test('fill and drain', a => { const t = new Tank(); t.fill(20); t.drain(5); a.equal(t.level, 65); });
test('overflow refused', a => { const t = new Tank(); a.equal(t.fill(60), false); a.equal(t.level, 50); });
test('underflow refused', a => { const t = new Tank(); a.equal(t.drain(51), false); a.equal(t.level, 50); });
test('edges allowed', a => { const t = new Tank(); a.equal(t.fill(50), true); a.equal(t.level, 100); a.equal(t.drain(100), true); a.equal(t.level, 0); });
test('audit trail', a => {
  const t = new Tank(); t.fill(10); t.fill(90); t.drain(20);
  a.deepEqual(t.history().map(e => e.kind), ['transition', 'rejected', 'transition']);
  a.deepEqual(t.history().map(e => e.signal), ['fill', 'fill', 'drain']);
});
