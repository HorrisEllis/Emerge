# Words

Each word twice: **plainly**, then **exactly**.

| Word | Plainly | Exactly |
|---|---|---|
| **compartment** | A box with its own memory and rules | A unit with `id`, `intent`, `state`, constraints and `on` handlers; changes are proposed and commit or are refused whole |
| **component** | A part you plug into others | A compartment with identity (`id`, `namespace`, `version`, uuid), a boundary, and typed `in`/`out` hooks; no `on` or plain `emit` |
| **state** | What it remembers | The compartment's memory; written only by its own handlers, read from outside as a frozen copy |
| **signal / event** | A note sent to whoever listens | `emit "name" { … }`; delivered FIFO to matching handlers; unhandled ones are recorded as unrouted |
| **constraint** | A rule | `hard`: a break refuses the change; `soft` with `cost`: a break commits and the cost is counted in `spent()` |
| **boundary** | What must stay true for it to still be itself | 1 to 5 identity invariants on a component, checked with its constraints |
| **hook** | A door in or out | `in name(x: shape) { … }` or `out name: shape` |
| **shape** | What a note must look like | Every field with its type, nothing extra; checked at emit, at arrival, and across wires at compile time |
| **wire / road** | A line between two doors | `wire A.out -> B.in`; in CIE-EG a road, the only way an event can travel |
| **gate** | The keeper | CIE-EG §6.2: the ordered checks every event passes before delivery; the first failure writes a gap |
| **ledger** | The notebook nobody can secretly change | Append-only entries `{seq, kind, body, prev, hash}`, each hash sealing every entry before it |
| **gap** | Something missing, written down | A typed record (8 types) with a pressure in [0, 1]; opened, acknowledged, closed; never deleted |
| **pressure** | How much a gap matters | 0 to 1; a gap at or above `block_at` closes its road |
| **whatif** | Try it in pretend | Fork the world (state, ledger, gaps, queue, seed), run, return the last value, restore everything |
| **kind** | What something must be | A schema for a primitive: required hooks, shapes, state, fns, identity; checked at compile time |
| **template** | A cookie cutter | A component with parameters; `spawn` makes instances, `despawn` removes one and its wires |
| **promote** | Say "this is ready", with proof | `promote "x" with proof expr`; a false proof refuses it and opens a gap |
| **seed** | The dice's starting point | `--seed N`; `random()` and `uid()` draw from it, so one program and one seed give one ledger |
| **friction** | Resistance that costs something, but does not stop you | A `soft` constraint: a change that breaks it still commits, and its cost is added to `spent()` (his word; ERAVOS: "an edge exists but its interaction produces resistance") |
| **tension** | How hard something unresolved pulls | A gap's pressure, kept as an option in a node file |
| **ripple** | One change setting off the next | An event emitted by a handler, which another handler hears |
| **compound** | Growth that grows itself | `state.x += state.x * rate`, the rate an option in a node file |
| **lever** | One value that shifts the whole system | A named option in a node file; changed there, never in the code |
| **node file** | The settings and starting data, kept outside the code | His node envelope (`envelope`, `id`, `type`, `payload` …) in JSON form, loaded with `use "./x.node" as node` |
| **eg say** | Write a program by saying it | Reads a sentence against his vocabulary, writes `<name>.eg` and `<name>.node`, shows each word's source quote, names every gap; no AI |
