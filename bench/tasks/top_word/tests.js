const { top_word } = require('./solution');
test('simple', a => a.equal(top_word('a b a'), 'a'));
test('case', a => a.equal(top_word('Go go GO stop'), 'go'));
test('tie alphabetical', a => a.equal(top_word('pear apple pear apple fig'), 'apple'));
test('empty', a => a.equal(top_word(''), null));
test('spaces only', a => a.equal(top_word('   '), null));
test('extra spaces', a => a.equal(top_word('  x  y  x '), 'x'));
