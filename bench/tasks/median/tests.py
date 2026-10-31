from solution import median
test('odd', lambda: median([3, 1, 2]) == 2)
test('even', lambda: median([4, 1, 3, 2]) == 2.5)
test('single', lambda: median([7]) == 7)
def untouched():
    xs = [3, 1, 2]; median(xs); return xs == [3, 1, 2]
test('input untouched', untouched)
test('empty raises', raises(lambda: median([])))
