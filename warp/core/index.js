'use strict';
const { Event } = require('./Event');
const { Gate } = require('./Gate');
const { Axiom } = require('./Axiom');
const { Stream } = require('./Stream');
const { StreamLog } = require('./StreamLog');
const { fuseChain, canFuse } = require('./GateFusion');
// WARP 2 (EM2) — the link, the expectation, the causal ledger and the engine. 1.x stays beside it, unchanged.
const { createLink } = require('./Link');
const { createExpectation, gapOf } = require('./Expectation');
const { Ledger } = require('./Ledger');
const { Engine } = require('./Engine');

module.exports = { Event, Gate, Axiom, Stream, StreamLog, fuseChain, canFuse, createLink, createExpectation, gapOf, Ledger, Engine };
