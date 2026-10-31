'use strict';
// tests/nesting.test.js — a system of systems, the shape of a large project, small (EAS5). Nexus docs/emerge-system.spec MOD-EAS-NESTING.
// James, 2026-10-31: "okay. do it as long as it gets up closer to building large projects, like i want to be buyilding an operating systems"
//
// The tree, every node a sovereign system laid out from the same skeleton (lib/modules.js, "a module is a system"):
//
//   emerge                       the toolchain: its door builds Emerge (POST /lang/build)
//   └─ os                        level 1
//      ├─ kernel                 level 2 — takes a "tick" from a sibling and passes it down
//      │  └─ scheduler           level 3 — its code is written in Emerge, built through emerge's door, served by its own door
//      └─ shell                  level 2 — hands a "tick" to its sibling, the kernel, as a verified file
//
//   NS-01  three levels laid out; each boots with its own code, its nodes match its schemas, it has the component shape
//   NS-02  the scheduler's code is Emerge, built through emerge's door, installed as the scheduler's own component
//   NS-03  the scheduler serves it through its own door (server.js), and holds only its own folder
//   NS-04  shell → kernel (a sibling, declared as a peer) → scheduler (a child): two verified handoffs, the answer from the
//          Emerge-built code, every receipt back with its sender
//   NS-05  a module that fails to boot is named; its parent keeps running (§5.15 rule 3)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { start } = require('../server.js');
const commands = require('../lib/commands.js');
const modules = require('../lib/modules.js');
const handoff = require('../lib/handoff.js');
const env = require('../lib/envelope.js');

const ROOT = path.join(__dirname, '..');

function call(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(s) }); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end(data);
  });
}

/** a capability installed in a system as nodes: its component, capability, and each command with its route and event */
function install(ctx, { name, file, intent, commands: cmds }) {
  const S = ctx.system, comp = `${S}.${name}`, cap = `${S}.${name}.do`;
  env.write(ctx.root, 'component', comp, { file, intent, version: '1.0.0', status: 'built', capabilities: [cap], hooks: [], consumers: [] }, { system: S, summary: intent });
  env.write(ctx.root, 'capability', cap, { component: comp, summary: intent, commands: cmds.map(c => `${S}.${c.id}`) }, { system: S, summary: intent });
  for (const c of cmds) {
    env.write(ctx.root, 'command', `${S}.${c.id}`, { capability: cap, cli: c.id, route: `${S}.${c.id}`, handler: c.handler, events: [`${S}.${c.id}.done`], ...(c.accepts ? { accepts: c.accepts } : {}) }, { system: S, summary: c.id });
    env.write(ctx.root, 'route', `${S}.${c.id}`, { method: 'POST', path: `/${c.id}`, command: `${S}.${c.id}` }, { system: S, summary: `POST /${c.id}` });
    env.write(ctx.root, 'event', `${S}.${c.id}.done`, { command: `${S}.${c.id}`, payload: { command: 'string', result: 'object' } }, { system: S, summary: `${c.id} answered` });
  }
  ctx.listener.sync();
}

// The scheduler, in Emerge: round robin over the ready queue. This is the code the OS runs; nothing here is JavaScript.
const SCHEDULER_EG = `// scheduler.eg — round robin: the process after the current one, wrapping; an empty queue has none
fn next(queue, current) {
  if len(queue) == 0 { return null }
  let i = index_of(queue, current)
  if i < 0 { return queue[0] }
  return queue[(i + 1) % len(queue)]
}

test "round robin" {
  expect next(["init", "shell", "net"], "shell") == "net"
  expect next(["init", "shell", "net"], "net") == "init"
  expect next([], "x") == null
}
`;

// The scheduler's component: calls the Emerge-built module through the runtime the standalone build ships with it.
const SCHEDULER_COMPONENT = `'use strict';
// lib/sched.js — component scheduler.sched: the round-robin scheduler. The logic is Emerge (lib/sched/scheduler.eg, built through
// emerge's door into lib/sched/); this file only calls it.
const { createRuntime } = require('./sched/_emerge/lang/runtime.js');
const api = require('./sched/main.js')(createRuntime({ file: 'scheduler.eg', loadModule: (abs, r) => require(abs.replace(/\\.eg$/, '.js'))(r) }));

function next(args) { return { next: api.next(Array.isArray(args.queue) ? args.queue : [], args.current == null ? null : String(args.current)) }; }

module.exports = { next };
`;

// The kernel's component: a tick from anyone goes down to its scheduler, as a verified file.
const KERNEL_COMPONENT = `'use strict';
// lib/tick.js — component kernel.tick: a tick goes down to the scheduler (a module of the kernel) as a handoff.
const handoff = require('./handoff.js');

async function tick(args, ctx) {
  const { handoff: _from, ...payload } = args;
  return handoff.send(ctx, { to: 'scheduler', kind: 'tick', payload });
}

module.exports = { tick };
`;

let passed = 0, failed = 0;
async function t(id, desc, fn) { try { await fn(); console.log(`  ✓ ${id} ${desc}`); passed++; } catch (e) { console.error(`  ✗ ${id} ${desc}\n    ${e.stack.split('\n').slice(0, 5).join('\n    ')}`); failed++; } }

(async () => {
  console.log('\nnesting — a system of systems, three levels deep');
  const OS_DIR = path.join(ROOT, 'modules', 'os');
  if (fs.existsSync(OS_DIR)) throw new Error(`${OS_DIR} exists: remove it (a previous run did not finish)`);
  const { server, ctx, port } = await start({ port: 0, root: ROOT });
  const booted = [];
  let schedServer = null;
  const tree = {};
  try {
    await t('NS-01', 'three levels laid out; each boots, matches its schemas, has the component shape', async () => {
      await commands.run(ctx, 'module', { name: 'OS', description: 'an operating system, small' });
      tree.os = modules.boot(ctx, 'os'); booted.push(tree.os);
      await commands.run(tree.os, 'module', { name: 'Kernel' });
      await commands.run(tree.os, 'module', { name: 'Shell' });
      tree.kernel = modules.boot(tree.os, 'kernel'); booted.push(tree.kernel);
      tree.shell = modules.boot(tree.os, 'shell'); booted.push(tree.shell);
      await commands.run(tree.kernel, 'module', { name: 'Scheduler' });
      tree.scheduler = modules.boot(tree.kernel, 'scheduler'); booted.push(tree.scheduler);
      assert.ok(fs.existsSync(path.join(ROOT, 'modules', 'os', 'modules', 'kernel', 'modules', 'scheduler', 'server.js')), 'level 3 is on disk with its own door');
      for (const [name, c] of Object.entries(tree)) {
        assert.strictEqual(c.system, name);
        assert.deepStrictEqual(c.index.problems, [], `${name}: its nodes match its schemas`);
        assert.deepStrictEqual(c.shape(), [], `${name}: the component shape`);
      }
      const listed = (await commands.run(tree.os, 'modules')).modules.map(m => `${m.system}:${m.verified}:${m.modules}`).sort();
      assert.deepStrictEqual(listed, ['kernel:true:1', 'shell:true:0'], 'os sees its two modules, verified, and the kernel\'s own');
    });

    await t('NS-02', 'the scheduler\'s code is Emerge, built through emerge\'s door, installed as its own component', async () => {
      const r = (await call(port, 'POST', '/lang/test', { source: SCHEDULER_EG })).body;
      assert.strictEqual(r.ok, true, `its test blocks pass first: ${r.stdout}${r.stderr}`);
      const b = (await call(port, 'POST', '/lang/build', { source: SCHEDULER_EG, standalone: true })).body;
      assert.strictEqual(b.ok, true, b.stderr);
      const lib = path.join(tree.scheduler.root, 'lib');
      for (const [n, text] of Object.entries(b.files)) { const p = path.join(lib, 'sched', n); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
      fs.writeFileSync(path.join(lib, 'sched', 'scheduler.eg'), SCHEDULER_EG);
      fs.writeFileSync(path.join(lib, 'sched.js'), SCHEDULER_COMPONENT);
      install(tree.scheduler, { name: 'sched', file: 'lib/sched.js', intent: 'round-robin scheduling, written in Emerge', commands: [{ id: 'next', handler: 'next', accepts: ['tick'] }] });
      assert.deepStrictEqual(tree.scheduler.index.problems, []);
      assert.deepStrictEqual(tree.scheduler.shape(), [], 'still the component shape with the new component');
      assert.deepStrictEqual(await commands.run(tree.scheduler, 'next', { queue: ['init', 'shell', 'net'], current: 'shell' }), { next: 'net' });
    });

    await t('NS-03', 'the scheduler serves it through its own door, and holds only its own folder', async () => {
      const s = await require(path.join(tree.scheduler.root, 'server.js')).start({ port: 0, root: tree.scheduler.root });
      schedServer = s.server;
      const got = await call(s.port, 'POST', '/next', { queue: ['init', 'shell', 'net'], current: 'net' });
      assert.deepStrictEqual(got.body, { next: 'init' });
      const c = (await call(s.port, 'GET', '/contract')).body;
      assert.strictEqual(c.id, 'scheduler');
      assert.ok(c.resources.some(r => r.method === 'POST' && r.path === '/next'), 'its contract carries the new route');
      assert.deepStrictEqual(tree.scheduler.boundary(), [], 'the built Emerge and its runtime are inside the scheduler\'s folder');
      assert.deepStrictEqual(tree.os.boundary(), [], 'and os holds only its own (a module is checked by its own boundary)');
    });

    await t('NS-04', 'shell → kernel (sibling) → scheduler (child): verified handoffs, the Emerge answer, every receipt back', async () => {
      fs.writeFileSync(path.join(tree.kernel.root, 'lib', 'tick.js'), KERNEL_COMPONENT);
      install(tree.kernel, { name: 'tick', file: 'lib/tick.js', intent: 'a tick goes down to the scheduler', commands: [{ id: 'tick', handler: 'tick', accepts: ['tick'] }] });
      // the shell declares the kernel as a peer in its own config: the registry, not a guess, says who it can reach
      const cfgFile = path.join(tree.shell.root, 'shell.config.json');
      const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, peers: { kernel: { dir: '../kernel' } } }, null, 2) + '\n');
      tree.shell.config.peers = { kernel: { dir: '../kernel' } };

      const refused = await commands.run(tree.shell, 'handoff', { to: 'scheduler', kind: 'tick', payload: {} });
      assert.strictEqual(refused.state, 'refused', 'the shell cannot reach into the kernel\'s module: not its peer');

      const sent = await commands.run(tree.shell, 'handoff', { to: 'kernel', kind: 'tick', payload: { queue: ['init', 'shell', 'net'], current: 'init' } });
      assert.strictEqual(sent.state, 'queued', JSON.stringify(sent));
      const k = await handoff.drain(tree.kernel);
      assert.deepStrictEqual(k.map(x => x.state), ['done'], JSON.stringify(k));
      const down = env.read(path.join(tree.kernel.root, 'done', `${sent.id}.handoff`)).payload.result;
      assert.strictEqual(down.state, 'queued', 'the kernel passed it down to its scheduler');
      const s = await handoff.drain(tree.scheduler);
      assert.deepStrictEqual(s.map(x => x.state), ['done'], JSON.stringify(s));
      const answer = env.read(path.join(tree.scheduler.root, 'done', `${down.id}.handoff`)).payload.result;
      assert.deepStrictEqual(answer, { next: 'shell' }, 'the answer came from the Emerge-built scheduler');
      const shellReceipt = env.read(path.join(tree.shell.root, 'output', `${sent.id}.handoff`)).payload;
      assert.deepStrictEqual(shellReceipt.history.map(h => h.state), ['verifying', 'queued', 'taken', 'done'], 'the shell\'s receipt: every step');
      const kernelReceipt = env.read(path.join(tree.kernel.root, 'output', `${down.id}.handoff`)).payload;
      assert.strictEqual(kernelReceipt.state, 'done');
      assert.deepStrictEqual(kernelReceipt.result, { next: 'shell' }, 'the kernel\'s receipt carries the scheduler\'s answer');
    });

    await t('NS-05', 'a module that fails to boot is named; its parent keeps running', async () => {
      await commands.run(tree.os, 'module', { name: 'Broken' });
      const broken = path.join(tree.os.root, 'modules', 'broken');
      fs.writeFileSync(path.join(broken, 'broken.config.json'), '{ not json');
      let err = null;
      try { booted.push(modules.boot(tree.os, 'broken')); } catch (e) { err = e; }
      assert.ok(err, 'booting it throws');
      assert.match(`${err.message} ${err.stack}`, /broken/, 'the error names the module');
      assert.strictEqual((await call(port, 'GET', '/health')).body.ok, true, 'emerge still answers');
      assert.deepStrictEqual(await commands.run(tree.scheduler, 'next', { queue: ['a', 'b'], current: 'a' }), { next: 'b' }, 'and the rest of the tree still works');
    });
  } finally {
    if (schedServer) schedServer.close();
    for (const c of booted.reverse()) { try { c.stop(); } catch (_) {} }
    server.close();
    fs.rmSync(OS_DIR, { recursive: true, force: true });
    try { fs.unlinkSync(env.nodePath(ROOT, 'module', 'os')); } catch (_) {}
    try { fs.rmdirSync(path.join(ROOT, 'data', 'nodes', 'module')); } catch (_) {}
    try { fs.rmdirSync(path.join(ROOT, 'modules')); } catch (_) {}
  }
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
