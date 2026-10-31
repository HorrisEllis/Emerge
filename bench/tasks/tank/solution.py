class Tank:
    def __init__(self):
        self.level, self._h = 50, []

    def _apply(self, signal, amount, nxt):
        ok = 0 <= nxt <= 100
        self._h.append({"kind": "transition" if ok else "rejected", "signal": signal, "amount": amount})
        if ok:
            self.level = nxt
        return ok

    def fill(self, n): return self._apply("fill", n, self.level + n)
    def drain(self, n): return self._apply("drain", n, self.level - n)
    def history(self): return [dict(e) for e in self._h]
