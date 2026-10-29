A water tank that must stay between 0 and 100 (inclusive). It starts at 50.
Fills and drains that would leave that range are refused and change nothing. Every accepted and every refused change must be recorded, in order, so it can be audited later.
EMERGE: a compartment `Tank` (id "co-tank-001") with state `level`. It handles the signals "fill" and "drain", each carrying `amount`. Use a constraint for the range.
JAVASCRIPT: export a class `Tank` with a `level` property, methods `fill(n)` and `drain(n)` that return true if applied and false if refused, and `history()` returning an array of { kind: 'transition' | 'rejected', signal: 'fill' | 'drain', amount } in order.
