exports.Tank = class Tank {
  constructor() { this.level = 50; this._h = []; }
  _apply(signal, amount, next) {
    if (next < 0 || next > 100) { this._h.push({ kind: 'rejected', signal, amount }); return false; }
    this.level = next; this._h.push({ kind: 'transition', signal, amount }); return true;
  }
  fill(n) { return this._apply('fill', n, this.level + n); }
  drain(n) { return this._apply('drain', n, this.level - n); }
  history() { return this._h.map(e => ({ ...e })); }
};
