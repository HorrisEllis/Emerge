'use strict';
// tests/skeleton.test.js — the skeleton is alive: it boots, indexes its nodes, has the component shape, serves its
// route nodes, runs its command nodes, picks up a node dropped into its folder, and gains a capability from nodes alone.
// It lays out a module — a whole system — from its own template, and that module lays out one of its own; and it hands
// work to its module as a verified file that moves input/ → processing/ → done/, the receipt back in its output/.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { boot } = require('../lib/system.js');
const { start } = require('../server.js');
const commands = require('../lib/commands.js');
const env = require('../lib/envelope.js');
const modules = require('../lib/modules.js');
const handoff = require('../lib/handoff.js');

const get = (port, p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: p }, (res) => {
  let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(s) }));
}).on('error', reject));

(async () => {
  const ctx = boot();
  assert.deepStrictEqual(ctx.index.problems, [], 'every seed node matches its schema');
  assert.deepStrictEqual(ctx.shape(), [], 'every component has a capability, a command and events');
  // sovereign: nothing in the system requires a file outside its own folder; the heartbeat says so when one does
  assert.deepStrictEqual(ctx.boundary(), [], 'the system holds only its own folder');
  assert.ok(ctx.heartbeat.snapshot().ok, 'the heartbeat is clean');
  const leak = ['module.exports = req', "uire('../../else", "where.js');\n"].join('');   // built, so this test's own source holds no such require
  fs.writeFileSync(path.join(ctx.root, 'lib', 'leak.probe.js'), leak);
  try { assert.ok(ctx.heartbeat.snapshot().problems.some(p => /leak\.probe\.js requires \.\.\/\.\.\/elsewhere\.js: outside this system/.test(p)), 'a require that leaves the folder is a problem the heartbeat reports'); }
  finally { fs.unlinkSync(path.join(ctx.root, 'lib', 'leak.probe.js')); }
  assert.ok(ctx.index.get('bundle', 'emerge.core.observe'), 'the listener wrote the capability bundle');
  const st = await commands.run(ctx, 'status');
  assert.strictEqual(st.system, 'emerge');

  const { server, port } = await start({ port: 0 });
  const added = [];
  try {
    assert.strictEqual((await get(port, '/health')).status, 200);
    assert.strictEqual((await get(port, '/status')).json.system, 'emerge');
    const c = (await get(port, '/contract')).json;
    assert.ok(c.resources.some(r => r.path === '/status'), 'the contract carries the route nodes');
    env.write(ctx.root, 'route', 'emerge.probe', { method: 'GET', path: '/probe', command: 'emerge.status' });
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { await new Promise(r => setTimeout(r, 100)); ok = (await get(port, '/probe')).status === 200; }
    assert.ok(ok, 'a route node dropped into its folder is served without a restart');

    // a capability from nodes alone: its capability, command, event and route nodes, and the component node naming it
    const S = 'emerge', cap = `${S}.core.count`;
    const comp = env.read(env.nodePath(ctx.root, 'component', `${S}.core`));
    added.push(['component', `${S}.core`, comp]);
    env.write(ctx.root, 'capability', cap, { component: `${S}.core`, summary: 'count nodes of a type', commands: [`${S}.count`] });
    env.write(ctx.root, 'command', `${S}.count`, { capability: cap, cli: 'count', handler: 'nodes', events: [`${S}.count.done`] });
    env.write(ctx.root, 'event', `${S}.count.done`, { command: `${S}.count`, payload: { command: 'string', result: 'object' } });
    env.write(ctx.root, 'route', `${S}.count`, { method: 'GET', path: '/count/:type', command: `${S}.count` });
    env.write(ctx.root, 'component', `${S}.core`, { ...comp.payload, capabilities: [...comp.payload.capabilities, cap] }, { uuid: comp.uuid, system: comp.system, summary: comp.summary });
    added.push(['capability', cap], ['command', `${S}.count`], ['event', `${S}.count.done`], ['route', `${S}.count`]);
    let got = null;
    for (let i = 0; i < 40 && !(got && got.status === 200); i++) { await new Promise(r => setTimeout(r, 100)); got = await get(port, '/count/event'); }
    assert.ok(got.status === 200 && got.json.nodes.some(n => n.id === `${S}.count.done`), 'a capability added as nodes alone is served');
    assert.deepStrictEqual((await get(port, '/status')).json.shape, [], 'and the shape still holds');

    // recursion: a module is a system — laid out from this system's own template, booted with its own code, and able to
    // lay out a module of its own
    const mod = await commands.run(ctx, 'module', { name: 'Probe Part', description: 'a module of the probe' });
    added.push(['dir', 'modules']);
    assert.strictEqual(mod.module, 'probe-part');
    const child = modules.boot(ctx, 'probe-part');
    assert.strictEqual(child.system, 'probe-part', 'the module is a system with its own name');
    assert.deepStrictEqual(child.index.problems, [], 'its nodes match its schemas');
    assert.deepStrictEqual(child.shape(), [], 'and it has the component shape');
    const grand = await commands.run(child, 'module', { name: 'Probe Leaf' });
    assert.ok(fs.existsSync(path.join(ctx.root, 'modules', 'probe-part', 'modules', 'probe-leaf', 'registry-components.js')), 'a module lays out a module of its own');
    assert.strictEqual(grand.module, 'probe-leaf');
    const listed = (await commands.run(ctx, 'modules')).modules;
    assert.ok(listed.some(m => m.system === 'probe-part' && m.verified && m.modules === 1), 'the parent sees its module, its contract verified, and its nested module');

    // the handoff: verified before it moves, its state the folder it is in, the receipt back with the sender
    const refused = await commands.run(ctx, 'handoff', { to: 'probe-part', kind: 'probe', payload: { n: 1 } });
    assert.strictEqual(refused.state, 'refused', 'the module accepts no "probe" yet — refused, nothing moved');
    assert.ok(/accepts no "probe"/.test(refused.reason));
    assert.ok(!fs.readdirSync(path.join(child.root, 'input')).some(f => f.endsWith('.handoff')), 'nothing landed in its input/');
    env.write(child.root, 'command', 'probe-part.take-probe', { capability: 'probe-part.core.observe', cli: 'take-probe', handler: 'status', accepts: ['probe'], events: ['probe-part.status.reported'] });
    child.listener.sync();
    const nowhere = await commands.run(ctx, 'handoff', { to: 'no-such-system', kind: 'probe', payload: {} });
    assert.ok(nowhere.state === 'refused' && /not in this system's registry/.test(nowhere.reason), 'a target the registry does not know is refused');
    const sent = await commands.run(ctx, 'handoff', { to: 'probe-part', kind: 'probe', payload: { n: 2 } });
    assert.strictEqual(sent.state, 'queued', 'verified: queued in the module\'s input/');
    assert.ok(fs.existsSync(path.join(child.root, 'input', `${sent.id}.handoff`)), 'tangible: the file is in its input/');
    const ran = await handoff.drain(child);
    assert.ok(ran.some(r => r.id === sent.id && r.state === 'done'), 'the module took it, ran the command that accepts it, and it is done');
    assert.ok(fs.existsSync(path.join(child.root, 'done', `${sent.id}.handoff`)), 'tangible: in its done/');
    const receipt = env.read(path.join(ctx.root, 'output', `${sent.id}.handoff`));
    assert.strictEqual(receipt.payload.state, 'done', 'the sender\'s receipt says done');
    assert.deepStrictEqual(receipt.payload.history.map(h => h.state), ['verifying', 'queued', 'taken', 'done'], 'every step it passed through');
    // a crash mid-work: what is left in processing/ goes back to input/ at boot, said
    const stuck = env.read(path.join(child.root, 'done', `${sent.id}.handoff`));
    fs.writeFileSync(path.join(child.root, 'processing', 'stuck-1.handoff'), JSON.stringify({ ...stuck, id: 'stuck-1' }));
    assert.deepStrictEqual(handoff.recover(child), ['stuck-1'], 'recovered at boot');
    assert.ok(fs.existsSync(path.join(child.root, 'input', 'stuck-1.handoff')));
    const hs = await commands.run(ctx, 'handoffs');
    assert.ok(hs.output.some(h => h.id === sent.id && h.state === 'done') && hs.peers['probe-part'] === 'module', 'the handoffs, by folder, and the peers the registry gives');
    assert.ok((await get(port, '/contract')).json.resources.some(r => r.method === 'POST' && r.path === '/handoff'), 'the drawbridge is in the contract');
    assert.ok(Array.isArray((await get(port, '/contract')).json.toasts), 'the contract carries the toasts the registry declares');
    child.stop();
  } finally {
    fs.unlinkSync(env.nodePath(ctx.root, 'route', 'emerge.probe'));
    for (const [type, id, before] of added) {
      if (type === 'dir') { fs.rmSync(path.join(ctx.root, id), { recursive: true, force: true }); for (const d of ['input', 'processing', 'done', 'failed', 'output']) for (const f of fs.readdirSync(path.join(ctx.root, d)).filter(f => f.endsWith('.handoff'))) fs.unlinkSync(path.join(ctx.root, d, f)); try { fs.rmSync(path.join(ctx.root, 'data', 'nodes', 'module'), { recursive: true, force: true }); } catch (_) {} continue; }
      if (before) env.write(ctx.root, type, id, before.payload, { uuid: before.uuid, system: before.system, summary: before.summary });
      else fs.unlinkSync(env.nodePath(ctx.root, type, id));
    }
    server.close();
    ctx.stop();
  }
  console.log('skeleton: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
