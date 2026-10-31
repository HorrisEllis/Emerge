# 2 · Things that remember

**For:** beginners who know [level 1](1-first-words.md).

## The idea in one line

A **compartment** keeps its own memory, changes only when a signal arrives, and refuses any change that breaks its rules.

## Try it

[`examples/2-jar.eg`](examples/2-jar.eg):

```eg
compartment Jar {
  id = "jar.cookies"
  intent = "hold cookies, and never have fewer than zero"
  state { cookies: 3 }

  constraint never_negative hard { state.cookies >= 0 }

  on "take" (e) {
    state.cookies -= e.count
    emit "taken" { left: state.cookies }
  }
}

on "taken" (e) { print("cookies left:", e.left) }
on "rejected" (r) { print("refused by rule:", r.constraint) }

emit "take" { count: 2 }     // allowed: 3 - 2 = 1
emit "take" { count: 5 }     // would make -4: the rule refuses it, nothing changes
print("the jar holds", Jar.state.cookies)
```

```
cookies left: 1
refused by rule: never_negative
the jar holds 1
```

## What happened

1. `emit "take" { count: 2 }` sends a **signal**. The jar's `on "take"` handler runs on a **working copy** of its memory.
2. When the handler finishes, the copy is **proposed**. Every constraint is checked. `1 >= 0` holds, so the change
   **commits**, and the `taken` signal it emitted goes out.
3. The second `take` would leave `-4`. The **hard** constraint breaks, so the copy is thrown away: the memory is
   unchanged, the `taken` signal is discarded, and a `rejected` signal says which rule refused it.
4. `Jar.state` can be read from outside, but never written. It is a frozen copy.

| Word | Meaning |
|---|---|
| `id` | Its name. Required, so every change can be traced back to it |
| `intent` | What it is for, in words |
| `state` | Its memory |
| `constraint … hard` | A rule that can never break. A `soft` rule may break, but its `cost` is counted |
| `on` | What it does when a signal arrives |
| `emit` | Send a signal. Inside a handler, it waits until the change commits |

## The system view

The jar's memory is a **stock**. Signals are **flows** into and out of it. The constraint is a **limit**. Because a
change is a proposal that commits or is refused whole, the jar is never half-changed. Every step is either all done or
not done at all, and you are told which.

## Your turn

1. Add a `"put"` signal that adds cookies.
2. Add `constraint fits hard { state.cookies <= 10 }` and try to overfill the jar.
3. Make `fits` a `soft` rule with `cost 2` and print `spent()` at the end. What changed?

**Next:** [2½ · Say it in your words](2s-say-it.md)
