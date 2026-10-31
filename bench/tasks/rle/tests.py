from solution import rle
test('basic', lambda: rle('aaabcc') == 'a3b1c2')
test('empty', lambda: rle('') == '')
test('single', lambda: rle('z') == 'z1')
test('long run', lambda: rle('xxxxxxxxxxxx') == 'x12')
test('alternating', lambda: rle('abab') == 'a1b1a1b1')
