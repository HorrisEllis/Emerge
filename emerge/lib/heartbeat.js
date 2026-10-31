'use strict';
// lib/heartbeat.js — the system's pulse: every interval, <system>.heartbeat with its uptime, each node type's count
// and the problems the index refused. An index behind its files shows here as drift. checks: more problems the system
// knows about itself (lib/system.js passes the boundary: a require that leaves the system's folder).
class Heartbeat {
  constructor({ system, index, bus, intervalMs = 30000, checks = [] }) {
    Object.assign(this, { system, index, bus, intervalMs, checks });
    this.startedAt = Date.now(); this.beats = 0; this.timer = null;
  }

  snapshot() {
    const own = [];
    for (const c of this.checks) { try { own.push(...c()); } catch (e) { own.push(`a check failed: ${e.message}`); } }
    const problems = [...this.index.problems, ...own];
    return { system: this.system, ok: !problems.length, uptimeMs: Date.now() - this.startedAt, beats: this.beats,
      counts: this.index.counts(), problems: problems.slice(0, 20) };
  }

  beat() { this.beats++; const s = this.snapshot(); this.bus.emit(`${this.system}.heartbeat`, s); return s; }

  start() { if (!this.timer && this.intervalMs > 0) { this.timer = setInterval(() => this.beat(), this.intervalMs); this.timer.unref(); } return this; }

  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = { Heartbeat };
