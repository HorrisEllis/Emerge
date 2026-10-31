# 2½ · Say it in your words

**For:** anyone who has read [level 2](2-things-that-remember.md). No syntax to learn.

## The idea in one line

Say what you want in plain words; `eg say` writes the Emerge it means, shows you which words it understood, and asks
about the rest. It never guesses.

## Why this exists

Emerge was made for its author first. James Brooks, 2026-10-31: *"Also it's meant for me. To make coding easy for me
using my own language. Ai is additive. Also it's working towards removing the dependency of ai."* And: *"im trying to
remove as much friction from me and the code as possibel."*

So `eg say` uses no AI. It reads a sentence against a vocabulary of his own words, and every word in it carries the quote
of his it came from. Whatever it does not know, it names, and you teach it once.

## Try it

The sentence, in [`examples/2s-garden.say`](examples/2s-garden.say):

```
eg say "a compartment called Garden with plants, at most 50 plants with friction. when rain falls add 3 to plants,
plants compound by 10 percent, ripple to bloom. if plants over 40 then gap the garden is crowded. what if rain falls.
tension 0.7. test it"
```

It answers with what it understood, each word beside his own words (shortened here):

```
understood, in your words:
  "compartment" → a piece of state held apart, guarded by its own rules
      you: "im saying to add that to cos. the conditions. like the intent of compartment is the end state." (2026-10-07, …)
  "with friction" → a gate resists at a cost instead of refusing: the change goes through and its cost is counted
  "compound" → growth in proportion to itself, by a rate (an option in the node file)
  "ripple to" → one change sets off the next event
  "what if" → a preview: try it in a fork and see, the real state untouched
  …
levers, in garden.node (change them there, not in the code):
  rain_falls_plants_by = 3
  plants_rate = 0.1
  rain_falls_plants_over = 40
  tension = 0.7
  max_plants = 50
```

And it writes two files: [`garden.eg`](examples/garden.eg), the code, and [`garden.node`](examples/garden.node), its
levers and starting data. The code:

```eg
use "./garden.node" as node
let o = node.payload.options
let start = node.payload.start
compartment Garden {
  id = "garden.main"
  state { plants: start.plants }
  constraint plants_at_most soft { state.plants <= o.max_plants }
  on "garden.rain_falls" (e) {
    state.plants += o.rain_falls_plants_by
    state.plants += state.plants * o.plants_rate
    emit "garden.bloom" { plants: state.plants }
    if state.plants > o.rain_falls_plants_over {
      gap "the garden is crowded" pressure o.tension
    }
  }
}
on "garden.bloom" (e) { print("ripple: bloom", e) }
let what_if_1 = whatif {
  emit "garden.rain_falls" {}
  Garden.state
}
print("what if rain_falls:", what_if_1, "— still:", Garden.state)
emit "garden.rain_falls" {}
print("Garden", Garden.state)
```

Run it with `node lang/eg.js run ../docs/learn/examples/garden.eg`:

```
ripple: bloom {plants: 3.3}
what if rain_falls: {plants: 3.3} — still: {plants: 0}
ripple: bloom {plants: 3.3}
Garden {plants: 3.3}
```

## What happened

- **Every word became one exact thing.** *Friction* made the gate `soft`: a change that crosses it still goes through,
  but its cost is counted (`spent()`). *Compound* grows the plants by a share of themselves. *Ripple* sends the next
  signal. *Gap* writes down what is wrong instead of hiding it, and *tension* is how hard it pulls. *What if* tries the
  rain in a copy of the world first: the preview shows 3.3 plants while the real garden still has 0.
- **No number is in the code.** His rule, 2026-10-31: *"only using hardcoded when neccarry, using external node files for
  data, options, etc."* Every number in the sentence is a named lever in `garden.node`, and the starting values are
  there too. To change the garden, change the node file; the code stays as it is.
- **Nothing was guessed.** A word it does not know stops it, with the command that teaches it.

## The system view

These are his systems words, from his relationship platform ERAVOS, where *friction* is "an edge [that] exists but its
interaction produces resistance" and a *gap* is missing structure:

| His word | What it is in Emerge | In systems terms |
|---|---|---|
| friction | a `soft` constraint: crossed at a cost | a limit that resists instead of walls |
| tension | a gap's pressure | how much an unknown matters |
| gap | `gap "…" pressure p` | missing structure, written down |
| compound | `state.x += state.x * rate` | a reinforcing loop |
| ripple | an event that sets off the next one | a flow that triggers another flow |
| leverage / lever | a named option in the node file | a parameter: change one value, the system shifts |
| what if | `whatif { … }` | an experiment in a copy |
| if / then / else | a condition in a handler | a branch |

## Your turn

1. Open `garden.node`, change `plants_rate` to `0.5`, and run `garden.eg` again. The code did not change. What did?
2. Say a sentence with a word it does not know, for example `… when sun shines, bump plants`. Read the gap, then
   `eg teach "bump" as add` and say it again.
3. `eg words` lists every word it knows, each with the quote it came from.

**Next:** [3 · Parts that never touch](3-parts-that-never-touch.md)
