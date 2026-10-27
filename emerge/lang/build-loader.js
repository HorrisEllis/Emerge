'use strict';
// emerge/lang/build-loader.js — where the current build of the language lives, and what it holds.
// component_id: emerge.lang.build · spec: emerge/lang/emerge-lang.spec (bootstrap)
//
//   primitives()  → the core rules (from build/primitives.json), read by the parser, checker, runtime and components
//   preludePath() → the compiled standard library the runtime loads into every program, or null
//
// The build directory is EMERGE_BUILD, or lang/build/current. There are no defaults in JavaScript: a missing build is
// a loud error that says to run eg bootstrap. Bootstrap uses setMode() to build from nothing:
//   seed mode — primitives is a guard that throws on any read (primitives.eg must be plain data)
//   then      — the new primitives, no prelude (the prelude is compiled against natives only)

const fs = require('fs');
const path = require('path');

let mode = null;          // { primitives, prelude: path|null } while bootstrapping; null = read the build directory
let cached = null;        // { dir, primitives, prelude }
let generation = 0;       // bumps whenever what primitives() returns may have changed

const buildDir = () => process.env.EMERGE_BUILD ? path.resolve(process.env.EMERGE_BUILD) : path.join(__dirname, 'build', 'current');

const SEED = new Proxy({}, {
  get(_, key) {
    if (typeof key === 'symbol' || key === 'toJSON' || key === 'then') return undefined;
    throw new Error(`seed mode: primitive "${String(key)}" was read while evaluating core/primitives.eg — that file may only hold literal data`);
  },
});

function load() {
  const dir = buildDir();
  if (cached && cached.dir === dir) return cached;
  const pfile = path.join(dir, 'primitives.json');
  if (!fs.existsSync(pfile)) {
    throw new Error(`emerge: no language build at ${dir} — run: node lang/eg.js bootstrap`);
  }
  const prelude = path.join(dir, 'prelude.js');
  cached = { dir, primitives: Object.freeze(JSON.parse(fs.readFileSync(pfile, 'utf8'))), prelude: fs.existsSync(prelude) ? prelude : null };
  generation++;
  return cached;
}

function primitives() { return mode ? mode.primitives : load().primitives; }
function preludePath() { return mode ? mode.prelude : load().prelude; }
function setMode(m) { mode = m; generation++; }
function reset() { mode = null; cached = null; generation++; }
const isSeed = () => !!mode && mode.primitives === SEED;

module.exports = { primitives, preludePath, setMode, reset, buildDir, isSeed, SEED, get generation() { return generation; } };
