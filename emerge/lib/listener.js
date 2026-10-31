'use strict';
// lib/listener.js — a node dropped into its folder goes live without a restart: the listener sees data/nodes change,
// reindexes, emits <system>.node.changed per change, and rewrites each capability's bundle (references to every
// node related to it — never copies). fs.watch where the platform has a recursive watch, a poll where it does not.
const fs = require('fs');
const path = require('path');
const env = require('./envelope.js');

class Listener {
  constructor({ root, system, index, bus, pollMs = 2000 }) {
    Object.assign(this, { root, system, index, bus, pollMs });
    this.timer = null; this.watcher = null; this.poller = null;
  }

  // Each capability's bundle: its component, its commands, their events and routes, the hooks of its component.
  bundles() {
    const written = [];
    for (const cap of this.index.list('capability')) {
      const comps = this.index.list('component', { capabilities: cap.id });
      const cmds = this.index.list('command', { capability: cap.id });
      const ids = new Set(cmds.map(c => c.id));
      const members = [
        ...comps.map(c => `component/${c.id}`),
        ...cmds.map(c => `command/${c.id}`),
        ...this.index.list('event').filter(e => ids.has(e.command)).map(e => `event/${e.id}`),
        ...this.index.list('route').filter(r => ids.has(r.command)).map(r => `route/${r.id}`),
        ...this.index.list('hook').filter(h => comps.some(c => c.id === h.component)).map(h => `hook/${h.id}`),
      ].sort();
      const old = this.index.get('bundle', cap.id);
      if (old && JSON.stringify(old.members) === JSON.stringify(members)) continue;
      env.write(this.root, 'bundle', cap.id, { capability: cap.id, members }, { system: this.system, summary: `everything related to ${cap.id}` });
      written.push(cap.id);
    }
    return written;
  }

  sync() {
    let r = this.index.reindex();
    if (this.bundles().length) r = { changes: [...r.changes, ...this.index.reindex().changes], problems: r.problems };
    for (const c of r.changes) this.bus.emit(`${this.system}.node.changed`, c);
    return r;
  }

  _soon() { clearTimeout(this.timer); this.timer = setTimeout(() => { try { this.sync(); } catch (e) { this.bus.emit(`${this.system}.listener.failed`, { error: e.message }); } }, 150); }

  start() {
    const dir = path.join(this.root, 'data', 'nodes');
    fs.mkdirSync(dir, { recursive: true });
    try { this.watcher = fs.watch(dir, { recursive: true }, () => this._soon()); }
    catch (_) { this.poller = setInterval(() => this._soon(), this.pollMs); }
    return this;
  }

  stop() { clearTimeout(this.timer); if (this.watcher) this.watcher.close(); if (this.poller) clearInterval(this.poller); }
}

module.exports = { Listener };
