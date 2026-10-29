// Runs a tests.js file against a solution.js in the same folder. Prints "N passed, M failed".
const assert = require('assert');
const path = require('path');
const dir = path.resolve(process.argv[2]);
let passed = 0, failed = 0;
global.test = (name, fn) => {
  try { fn(assert); passed++; console.log('✓ ' + name); }
  catch (e) { failed++; console.log('✗ ' + name + ' — ' + String(e.message).split('\n')[0]); }
};
try { require(path.join(dir, 'tests.js')); }
catch (e) { failed++; console.log('✗ load error — ' + String(e.message).split('\n')[0]); }
console.log(passed + ' passed, ' + failed + ' failed');
