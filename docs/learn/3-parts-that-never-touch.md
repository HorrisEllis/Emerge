# 3 · Parts that never touch

**For:** programmers. You know [compartments](2-things-that-remember.md).

## The idea in one line

A **component** listens only through its `in` hooks and speaks only through its `out` hooks. **Wires** join hooks, so the
wiring *is* the architecture, and every shape is checked before anything runs.

## Try it

[`examples/3-alarm.eg`](examples/3-alarm.eg), shortened here (the full file declares both components the same way):

```eg
component Thermometer {
  id = "home.thermometer"
  namespace = "home"
  version = "1.0.0"
  state { last: 0 }
  boundary believable { state.last > -100 }

  in read(r: { celsius: num }) {
    state.last = r.celsius
    emit out reading { celsius: r.celsius }
  }
  out reading: { celsius: num }
}

component Alarm { … in check(r: { celsius: num }) { … emit out alert { celsius: r.celsius } } … }

wire "temperature" -> Thermometer.read       // the outside world → the thermometer
wire Thermometer.reading -> Alarm.check      // the thermometer → the alarm
wire Alarm.alert -> "alert"                  // the alarm → the outside world

on "alert" (a) { print("too hot:", a.celsius) }

emit "temperature" { celsius: 21 }
emit "temperature" { celsius: 35 }
print("the alarm rang", Alarm.state.rang, "time")
```

```
too hot: 35
the alarm rang 1 time
```

## What happened

- The Thermometer never names the Alarm. The Alarm never names the Thermometer. Only the wires know both, so you can
  swap either part for another with the same hook shapes and nothing else changes.
- `{ celsius: num }` is a **shape**: every field, with its type, and nothing extra. It is checked when a hook emits,
  when a payload arrives, and **at compile time across every wire**. Change the Alarm's hook to `{ celsius: string }`
  and `eg check` refuses the program before it runs:

  ```
  bad.eg:33:1: error: seam mismatch on Thermometer.reading->Alarm.check: "celsius" is num on the out side but string on the in side
  ```

- A **boundary** is an identity rule: what must stay true for the part to still be itself (1 to 5 of them).
- `id`, `namespace` and `version` give each component an identity. A uuid is derived from `namespace/id@version`, so
  the same component always has the same uuid. `node lang/eg.js components examples/3-alarm.eg` exports the whole graph
  (components, hooks, wires) as records any tool can read.

## The system view

This is the shape of every large system that lasts: **sovereign parts, explicit interfaces, wiring you can see**. Shapes
on hooks are contracts; a mismatch is found by the compiler, not by a user. The component graph is not a drawing
someone keeps up to date. It is exported from the code itself, so it is always true.

## Your turn

1. Add a `Logger` component with `in note(r: { celsius: num })` that counts readings, and wire
   `Thermometer.reading -> Logger.note` as well. One out hook can feed many in hooks.
2. Break a shape on purpose and read the error.
3. Run `eg components` on your file and find your wire in the output.

**Next:** [4 · Truth and gaps](4-truth-and-gaps.md)
