# 4 · Truth and gaps

**For:** engineers. You know [components](3-parts-that-never-touch.md).

## The idea in one line

Every program writes a **ledger** that can be proven, writes down what is **missing** as gaps, and can try a future in a
copy of the world (`whatif`) without touching the real one.

## Try it

[`examples/4-truth.eg`](examples/4-truth.eg):

```eg
compartment Tank {
  id = "tank.water"
  intent = "hold water, never more than 100"
  state { level: 10 }
  constraint not_over hard { state.level <= 100 }
  on "fill" (e) { state.level += e.amount }
}

record "decision" { chose: "start small" }                    // write a fact into the ledger
gap "we do not know the tank's real size" pressure 0.4 type evidential   // write down what is missing

let imagined = whatif {          // try something in a copy of the world, then throw the copy away
  emit "fill" { amount: 50 }
  Tank.state.level
}
print("if we filled 50, the level would be", imagined)
print("but really it is still", Tank.state.level)

print("open gaps:", len(gaps()))
print("is the history untouched?", ledger_verify())
```

```
if we filled 50, the level would be 60
but really it is still 10
open gaps: 1
is the history untouched? true
--- stderr
[emerge] 1 unrouted signal(s) logged to the ledger: gap.opened
```

## What happened

- **The ledger.** Every entry has `seq`, `kind`, `body`, `prev` and `hash`. `hash` is SHA-256 over the entry and the
  previous entry's hash, so each entry seals everything before it. Here are the first two entries of a run:

  ```
  1 genesis  c1c734732bcf…  prev 000000000000…
  2 decision 02326cb4da12…  prev c1c734732bcf…
  ```

  `ledger_verify()` recomputes every hash and link. Edit, delete or reorder one entry and it returns false.
- **A gap** is a missing thing with a **pressure** from 0 to 1 and a **type** (logical, evidential, temporal, assumption,
  contradiction, structural, contextual, causal). Opening one emits a `gap.opened` signal.
- **Nothing is dropped silently.** Nobody in this program listens for `gap.opened`, so Emerge records it as *unrouted*
  and says so on stderr. That line is not an error. It is the language keeping its promise.
- **`whatif`** forks the world (state, ledger, gaps, queue, seed), runs the block, returns its last value, and restores
  everything. The real tank never moved.
- **Same input, same history.** The runtime never reads the clock. `random()` and `uid()` draw from the run's seed, so
  one program with one seed writes a byte-identical ledger every time, in both the interpreter and the compiled build.

## The system view

Most systems lose their own history, hide their unknowns, and test changes in production. Emerge reverses all three: the
history proves itself, the unknowns are first-class records with a weight, and futures are tried in a copy.
`promote "x" with proof …` goes one step further: nothing is promoted without a proof that is true, or the promotion is
refused and a gap is opened.

## Your turn

1. Add `on "gap.opened" (g) { print("gap:", g.type, g.pressure) }` as the **first** line of the file and run it again. It
   prints `gap: evidential 0.4`, and the stderr line is gone: the signal now has a listener. Put the same line at the
   **end** of the file instead: the stderr line comes back, because a handler hears only what happens after it exists.
2. Inside a `whatif`, fill the tank by 200. What does the hard rule do inside the copy?
3. Print `ledger()` and find your `decision` entry and the entry before it.

**Next:** [5 · Systems](5-systems.md)
