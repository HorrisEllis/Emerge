# 5 · Systems

**For:** systems engineers. You know [ledgers and gaps](4-truth-and-gaps.md).

## The idea in one line

A **kind** says what something must be. A **template** makes as many as you need. Read together, a program is a system of
stocks, flows, limits and feedback, and Emerge makes each one explicit.

## Try it

[`examples/5-factory.eg`](examples/5-factory.eg):

```eg
kind Stage {
  require version
  in take(x: { v: num })
  out give: { v: num }
}

template Scale(factor: num) is Stage {
  namespace = "line"
  version = "1.0.0"
  state { seen: 0 }
  boundary positive { factor > 0 }
  in take(x: { v: num }) {
    state.seen += 1
    emit out give { v: x.v * factor }
  }
  out give: { v: num }
}

let a = spawn Scale("double", 2)        // build one from the template
let b = spawn Scale("triple", 3)        // and another, with a different setting
wire "input" -> a.take
wire a.give -> b.take                   // a feeds b
wire b.give -> "output"

on "output" (o) { print("out:", o.v) }

emit "input" { v: 1 }                   // 1 × 2 × 3
emit "input" { v: 5 }
print("each one is a Stage?", is_kind(a, "Stage"), is_kind(b, "Stage"))
print("how many Scales are alive:", len(instances("Scale")))
```

```
out: 6
out: 30
each one is a Stage? true true
how many Scales are alive: 2
```

## What happened

- `kind Stage` is a schema for a primitive: it requires a `version`, an `in take` and an `out give` with those shapes.
- `template Scale(factor) is Stage` claims the kind. **Conformance is checked at compile time**: hooks, shapes,
  required state, boundary count, required fns and identity fields.
- `spawn` makes live instances at run time, each with its own id and a uuid derived from it. `despawn` removes one and
  its wires. Spawning, wiring and despawning are recorded in the ledger, and `whatif` can undo all of it.

## The system view: reading any system in Emerge

| Systems thinking | In Emerge |
|---|---|
| **Stock** (what accumulates) | a compartment's `state` |
| **Flow** (what changes it) | signals, and the handlers they reach |
| **Limit** | a `hard` constraint; a `soft` one is a limit with a cost (`spent()`) |
| **Identity** (what must stay true for it to be itself) | `boundary` |
| **Interface** | hooks and their shapes |
| **Structure** | wires; exported as a graph with `eg components` |
| **Feedback loop** | a wire path that returns to where it started (`examples/primitives.eg` wires a loop) |
| **Delay and unknowns** | gaps, with type and pressure |
| **Memory** | the ledger |
| **Experiment** | `whatif` |
| **Leverage point** | a kind, a template, or the language's own primitives ([level 6](6-the-core.md)): change one, and everything built from it changes |

Leverage rises as you go down that table's last row: a value changes one thing, a template changes every instance, a kind
changes everything that claims it, and a primitive changes the language.

## Your turn

1. Spawn a third `Scale` and put it in the middle of the line.
2. Write a kind `Filter is Stage` that also requires `fn passed()`, and a template that implements it.
3. Read [`emerge/lang/examples/primitives.eg`](../../emerge/lang/examples/primitives.eg): it builds a pipeline from data,
   wires a loop, and tries a different wiring inside a `whatif`.

**Next:** [6 · The core](6-the-core.md)
