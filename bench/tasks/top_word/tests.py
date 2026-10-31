from solution import top_word
test('simple', lambda: top_word('a b a') == 'a')
test('case', lambda: top_word('Go go GO stop') == 'go')
test('tie alphabetical', lambda: top_word('pear apple pear apple fig') == 'apple')
test('empty', lambda: top_word('') is None)
test('spaces only', lambda: top_word('   ') is None)
test('extra spaces', lambda: top_word('  x  y  x ') == 'x')
