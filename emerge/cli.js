#!/usr/bin/env node
'use strict';
// cli.js — the CLI runs the command nodes, the same ones the server's routes run.
//   node cli.js                      list the commands
//   node cli.js status               run a command by its cli name or id
//   node cli.js nodes --type event   flags become the command's arguments
const { boot } = require('./lib/system.js');
const commands = require('./lib/commands.js');

function parse(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2), v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    args[k] = v;
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const ctx = boot();
  const [name, ...rest] = argv;
  if (!name || name === 'list') {
    for (const c of ctx.index.list('command')) console.log(`${String(c.cli).padEnd(16)} ${c.id}`);
    return 0;
  }
  try { console.log(JSON.stringify(await commands.run(ctx, name, parse(rest)), null, 2)); return 0; }
  catch (e) { console.error(e.message); return 1; }
}

if (require.main === module) main().then((code) => process.exit(code));

module.exports = { main, parse };
