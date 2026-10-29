const { rle } = require('./solution');
test('basic', a => a.equal(rle('aaabcc'), 'a3b1c2'));
test('empty', a => a.equal(rle(''), ''));
test('single', a => a.equal(rle('z'), 'z1'));
test('long run', a => a.equal(rle('xxxxxxxxxxxx'), 'x12'));
test('alternating', a => a.equal(rle('abab'), 'a1b1a1b1'));
