'use strict';
// lib/bus.js — the one way an event moves: logged to the ledger, then handed to whoever listens. An event that no
// event node declares is still delivered, and marked undeclared in the ledger so the gap shows.
const { EventEmitter } = require('events');

class Bus extends EventEmitter {
  constructor(ledger, declared = () => true) { super(); this.ledger = ledger; this.declared = declared; this.setMaxListeners(100); }

  emit(event, data = null) {
    if (this.ledger) this.ledger.append(event, this.declared(event) ? data : { undeclared: true, data });
    super.emit('*', event, data);
    return super.emit(event, data);
  }
}

module.exports = { Bus };
