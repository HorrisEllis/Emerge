from solution import Tank
def fd():
    t = Tank(); t.fill(20); t.drain(5); return t.level == 65
test('fill and drain', fd)
def over():
    t = Tank(); return t.fill(60) is False and t.level == 50
test('overflow refused', over)
def under():
    t = Tank(); return t.drain(51) is False and t.level == 50
test('underflow refused', under)
def edges():
    t = Tank(); a = t.fill(50) is True and t.level == 100; return a and t.drain(100) is True and t.level == 0
test('edges allowed', edges)
def audit():
    t = Tank(); t.fill(10); t.fill(90); t.drain(20)
    return [e['kind'] for e in t.history()] == ['transition', 'rejected', 'transition'] and \
           [e['signal'] for e in t.history()] == ['fill', 'fill', 'drain']
test('audit trail', audit)
