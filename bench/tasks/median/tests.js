const { median } = require('./solution');
test('odd', a => a.equal(median([3, 1, 2]), 2));
test('even', a => a.equal(median([4, 1, 3, 2]), 2.5));
test('single', a => a.equal(median([7]), 7));
test('input untouched', a => { const xs = [3, 1, 2]; median(xs); a.deepEqual(xs, [3, 1, 2]); });
test('empty raises', a => a.throws(() => median([])));
