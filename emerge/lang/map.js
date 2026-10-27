'use strict';
// emerge/lang/map.js — the map of the language, generated from the language itself.
// component_id: emerge.lang.map · spec: emerge/lang/emerge-lang.spec (modules.map)
//
// `eg map` writes it; lang/MAP.md is its output, and a test fails if the two differ. Everything that can be read from
// the source is read from the source — keywords (lexer), contextual words (parser), primitives (the build), builtins
// and their arities (the runtime + prelude), ledger kinds (runtime), the ontology (emerge.spec). Only the one-line
// meanings below are written by hand, and a test fails if a keyword or contextual word has none.

const fs = require('fs');
const path = require('path');
const { KEYWORDS } = require('./lexer');
const { TYPES } = require('./parser');
const { createRuntime, VERSION } = require('./runtime');
const build = require('./build-loader');

// ── layer → word → meaning · where it is enforced (P parser, C checker, R runtime) ─────────────────────────────────
const LAYERS = [
  ['values', 'what a program computes with', {
    true: 'bool literal', false: 'bool literal', null: 'the empty value; a missing map key reads as null',
    fn: 'a function: fn f(x) { … } · fn f(x) = expr · fn(x) = expr as a value',
  }],
  ['operators', 'lowest precedence first: |> ?? or and not · comparisons · .. · + - · * / % · ** · unary - · call . []', {
    and: 'both must be true (short-circuits; truth.strict decides what counts as true)', or: 'either is true (short-circuits)', not: 'negation',
    in: 'x in list/map/string · also the for-loop separator', contains: 'list/map/string contains x', starts_with: 'string prefix', ends_with: 'string suffix', matches: 'string matches a regular expression',
  }],
  ['statements', 'what runs, in order', {
    let: 'a fixed binding · let x: type = …', var: 'a binding that can change; contents of maps/lists change only through a var',
    if: 'if cond { } else if … { } else { }', else: 'the other branch of if / the handler of try', while: 'loop while true', for: 'for x in xs · for i, x in xs · for k, v in map',
    break: 'leave the loop', skip: 'next iteration', return: 'leave a fn with a value (bare return in handlers and tests)',
    try: 'try { } else e { } — the else may not be empty (NO_SILENT_DROP) · P C', expect: 'expect cond, "message" — halts a run, fails a test',
    with: 'emit/record/send … with <expr> as payload · promote … with proof',
  }],
  ['the world', 'what a program changes — all of it recorded in the ledger', {
    emit: 'raise a signal { payload }; inside a handler it waits for the transition to commit · R',
    record: 'append an entry to the hash-chained ledger · R',
    gap: 'gap "msg" pressure 0..1 [type t] — missing structure, first-class; emits gap.opened · P C R',
    promote: 'promote x with proof <bool> — refused + logical gap when the proof is false · P R',
    whatif: 'whatif { … } — fork the world, run, restore; its value is the last expression · C R',
  }],
  ['containers', 'state that changes only through constrained, recorded transitions', {
    compartment: 'id + state + constraints + on handlers + lens fns · C R',
    state: 'state { field: value } in a declaration · state.field in its handlers (read-write) and fns (read-only)',
    constraint: 'constraint name [type] [cost n] { bool } — types come from primitives.constraint_types · R',
    invariant: 'invariant name { bool } — a hard constraint',
    on: 'on "signal" (payload) { … } — a handler; "prefix*" matches by prefix',
    axiom: 'axiom NAME { bool } — checked after every top-level statement; a violation halts · R',
  }],
  ['components', 'containers you compose: identity, boundary, typed hooks, wires', {
    component: 'a compartment with namespace, version, boundary and in/out hooks · C R',
    wire: 'wire A.out -> B.in · "signal" -> B.in · A.out -> "signal"; shapes checked · C R',
    send: 'send Comp.hook { payload } — feed an in hook directly · C R',
  }],
  ['dynamic primitives', 'schemas for primitives, and instances made at run time', {
    template: 'template T(params) [is K] { … } — a component with parameters · C',
    spawn: 'spawn T("id", args…) — a live instance named T(id) · C R',
    despawn: 'despawn x — remove a spawned instance and its wires · C R',
  }],
  ['program', 'files, modules and tests', {
    use: 'use "./file.eg" as name — its top-level fns, lets and components', as: 'names a used module',
    test: 'test "name" { … } — runs under eg test, each in its own whatif fork',
  }],
];

const CONTEXTUAL = {
  id: 'identity: compartment/component id (a template gets it at spawn)', intent: 'identity: what it is for',
  namespace: 'identity: component/template namespace (required)', version: 'identity: semver (required for components/templates)',
  uuid: 'identity: optional; derived from namespace/id@version when absent',
  boundary: 'boundary name { bool } — 1..boundary_max identity invariants of a component (hard)',
  out: 'out hook: shape — a component output · emit out hook { … }', each: 'optional: for each x in xs',
  cost: 'constraint … cost n — what a permitted violation adds to spent()', pressure: 'gap … pressure n', type: 'gap … type t',
  proof: 'promote … with proof <bool>', is: 'component/template/kind X is K, …', kind: 'kind K [is …] { … } — a schema for a primitive',
  require: 'kind: identity fields an implementation must declare', boundary_count: 'kind: how many boundary invariants (lo..hi)',
};

// ── the ontology: emerge.spec's vocabulary, as the kernel reads it ───────────────────────────────────────────────────
function ontology() {
  const file = path.join(__dirname, '..', 'emerge.spec');
  if (!fs.existsSync(file)) return null;
  const domains = new Map();
  let cur = null;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const d = /^domain\s+"?([^"]+)"?/.exec(line);
    if (d) { cur = d[1]; domains.set(cur, new Map()); continue; }
    const k = /^(\w+)\s*=\s*(\S+)/.exec(line);
    if (k && cur) domains.get(cur).set(k[1], k[2]);
    const g = /^gap\.(\w+)/.exec(line);
    if (g && cur) domains.get(cur).set('gap.' + g[1], 'gap type');
  }
  return domains;
}

function arityText(a) {
  if (Array.isArray(a)) return a[1] === -1 ? `${a[0]}+` : a[0] === a[1] ? `${a[0]}` : `${a[0]}–${a[1]}`;
  return String(a);
}

function generate() {
  const P = build.primitives();
  const natives = createRuntime({ prelude: false, out: () => {}, err: () => {} }).b;
  const all = createRuntime({ out: () => {}, err: () => {} }).b;
  const preludeNames = Object.keys(all).filter(n => all[n].__eg.prelude);
  const nativeNames = Object.keys(natives).filter(n => !preludeNames.includes(n));
  const ledgerKinds = [...new Set([...fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8').matchAll(/append\('([a-z_]+)'/g)].map(m => m[1]))].sort();

  const o = [];
  const w = (s = '') => o.push(s);
  w(`# Emerge — the map`);
  w();
  w(`Generated from the language itself (emerge ${VERSION}) by \`eg map\`, and again by every \`eg bootstrap\`. Do not edit it:`);
  w('change the source and run `node lang/eg.js map --out lang/MAP.md` (a test fails when this file is out of date).');
  w();
  w('## The layers');
  w();
  w('```');
  w('build      lang/core/primitives.eg · prelude.eg · selftest.eg  ──eg bootstrap──▶  lang/build/current');
  w('program    use · fn · let/var · test');
  w('kinds      kind K { require · in · out · state · boundary_count · fn }          schemas for primitives');
  w('templates  template T(params) is K  ──spawn──▶  instance T(id)  ──despawn──▶ ✕');
  w('components component C is K { id · namespace · version · boundary · in · out }  ──wire──▶  hooks');
  w('containers compartment { id · state · constraint · invariant · on · fn }');
  w('world      emit · record · gap · promote · whatif · axiom   →   signals, ledger, gaps');
  w('values     num · string · bool · null · list · map · fn · instance · module');
  w('```');
  w();
  w('Where a rule is enforced: **P** parser · **C** checker (compile time) · **R** runtime (run time).');
  for (const [layer, about, words] of LAYERS) {
    w();
    w(`## ${layer[0].toUpperCase() + layer.slice(1)} — ${about}`);
    w();
    w('| word | meaning |');
    w('|---|---|');
    for (const [k, v] of Object.entries(words)) w(`| \`${k}\` | ${v} |`);
  }
  w();
  w('## Contextual words (keywords only where they appear)');
  w();
  w('| word | meaning |');
  w('|---|---|');
  for (const [k, v] of Object.entries(CONTEXTUAL)) w(`| \`${k}\` | ${v} |`);
  w();
  w('## Types');
  w();
  w(`Annotations (\`: type\`, \`?\` for nullable) on let/var, params, returns and hook shapes: ${[...TYPES].map(t => `\`${t}\``).join(' · ')}.`);
  w();
  w('## Primitives — `lang/core/primitives.eg`, as built');
  w();
  w('| constraint type | permits a violation | default cost |');
  w('|---|---|---|');
  for (const [k, t] of Object.entries(P.constraint_types)) w(`| \`${k}\` | ${t.permits_violation ? 'yes' : 'no'} | ${t.default_cost} |`);
  w();
  w(`- **gap types:** ${P.gaps.types.map(t => `\`${t}\``).join(' · ')} (default \`${P.gaps.default_type}\`, pressure ${P.gaps.pressure_min}..${P.gaps.pressure_max})`);
  w(`- **constraint gap:** pressure ${P.gaps.constraint_gap.pressure}, \`${P.gaps.constraint_gap.type}\` · **refused promotion:** pressure ${P.gaps.promotion_refused.pressure}, \`${P.gaps.promotion_refused.type}\``);
  w(`- **runtime signals:** rejected → \`"${P.signals.rejected}"\` · gap opened → \`"${P.signals.gap_opened}"\` · promoted → \`"${P.signals.promoted}"\``);
  w(`- **truth:** ${P.truth.strict ? 'strict — conditions need a real bool' : 'truthy — null, false, 0, "", [] and {} are false'}`);
  w(`- **dispatch:** unrouted signals are \`${P.dispatch.unrouted}\`; at most ${P.dispatch.max_deliveries} deliveries per drain`);
  w(`- **transitions:** a refused transition ${P.transitions.discard_emits_on_refusal ? 'discards' : 'still sends'} its emits`);
  w(`- **components:** boundary of 1..${P.components.boundary_max} invariants; hooks export as \`${P.components.hook_type}\``);
  w(`- **diagnostics:** ${Object.entries(P.diagnostics).map(([k, v]) => `${k} = ${v}`).join(' · ')}`);
  w();
  w('## Builtins');
  w();
  w('Native (JavaScript) — name/arity:');
  w();
  w(nativeNames.map(n => `\`${n}/${arityText(natives[n].__eg.arity)}\``).join(' · '));
  w();
  w('Prelude (Emerge, `lang/core/prelude.eg`) — name/arity:');
  w();
  w(preludeNames.map(n => `\`${n}/${arityText(all[n].__eg.arity)}\``).join(' · '));
  w();
  w('## Ledger entry kinds');
  w();
  w(`Written by the runtime: ${ledgerKinds.map(k => `\`${k}\``).join(' · ')}; and any kind your program passes to \`record\`.`);
  w();
  w('## Axioms');
  w();
  w('| axiom | compile time | run time |');
  w('|---|---|---|');
  w('| NO_SILENT_DROP | try needs a non-empty else | unrouted, aborted and discarded signals are recorded |');
  w('| SIGNAL_MUST_ROUTE_OR_LOG | emit nobody handles, unwired out hook, unfed in hook | unrouted is recorded (or an error, per primitives) |');
  w('| GAP_IS_FIRST_CLASS | gap needs pressure in range and a known type | gaps(), gap.opened, constraint gaps |');
  w('| EXECUTION_IS_TRACEABLE | id (+ namespace, version for components) | every error names file and line |');
  w('| RECORD_IS_TRUTH | — | the hash-chained ledger |');
  w('| PROOF_REQUIRED_FOR_PROMOTION | promote needs with proof | a false proof refuses and opens a gap |');
  w('| GRAMMAR_APPLIES_TO_ITSELF | partly: the rules and the library are Emerge (lang/core); the grammar and engine are JavaScript | — |');
  const onto = ontology();
  if (onto) {
    // syntax words only — a builtin that shares a name (split, find, get…) is a coincidence, not a mapping
    const syntax = new Set([...KEYWORDS, ...Object.keys(CONTEXTUAL), ...Object.keys(P.constraint_types), ...P.gaps.types.map(t => 'gap.' + t), 'signal', 'ledger', 'seam']);
    w();
    w('## The ontology — emerge.spec, and the words the language shares with it');
    w();
    const total = [...onto.values()].reduce((s, d) => s + d.size, 0);
    const rows = [];
    for (const [d, words] of onto) for (const [word, meaning] of words) if (syntax.has(word)) rows.push([d, word, meaning]);
    w(`emerge.spec names ${total} words in ${onto.size} domains; ${rows.length} of them are also words of the language's syntax. The ontology's`);
    w('meaning is shown beside each, so a shared word with a different meaning is visible rather than assumed. The rest of');
    w('the vocabulary stays what it is: names for concepts, not syntax.');
    w();
    w('| domain | word | ontology meaning |');
    w('|---|---|---|');
    for (const [d, word, meaning] of rows) w(`| ${d} | \`${word}\` | ${meaning.replace(/_/g, ' ')} |`);
  }
  w();
  w('## Files');
  w();
  w('| file | role |');
  w('|---|---|');
  for (const [f, r] of [
    ['lexer.js', 'source → tokens'], ['parser.js', 'tokens → syntax tree'], ['checker.js', 'names, compile-time rules, kind conformance'],
    ['runtime.js', 'values, operators, natives, the world: compartments, signals, ledger, gaps, whatif, spawn'],
    ['interpreter.js', 'runs the tree (eg run)'], ['emitter.js', 'tree → CommonJS (eg build)'],
    ['components.js', 'component/hook/wire records, shapes, schema validation'], ['build-loader.js', 'which language build is in use'],
    ['bootstrap.js', 'eg bootstrap'], ['map.js', 'this map'], ['eg.js', 'the command line'],
    ['core/primitives.eg', 'the core rules (data)'], ['core/prelude.eg', 'the standard library (Emerge)'], ['core/selftest.eg', 'what every build must pass'],
    ['emerge-lang.spec', 'the contract'], ['README.md', 'the guide'], ['examples/', 'programs, one per feature'],
  ]) w(`| \`${f}\` | ${r} |`);
  return o.join('\n') + '\n';
}

/** words the lexer or parser knows that have no meaning written here → [] when the map is complete */
function unmapped() {
  const described = new Set(LAYERS.flatMap(([, , words]) => Object.keys(words)));
  const missing = [...KEYWORDS].filter(k => !described.has(k));
  const src = fs.readFileSync(path.join(__dirname, 'parser.js'), 'utf8');
  for (const m of src.matchAll(/isWord\('([a-z_]+)'\)/g)) if (!CONTEXTUAL[m[1]]) missing.push(m[1]);
  return [...new Set(missing)];
}

module.exports = { generate, unmapped };
