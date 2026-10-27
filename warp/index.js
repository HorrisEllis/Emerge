'use strict';
/**
 * warp — pure functional event-driven devkit, decoupled.
 * Event -> Gate -> Stream -> StreamLog, Axiom as an enforced primitive,
 * and unifiedDispatch (exact-cache / pre-generation-filter / population /
 * cascade / axiom-gate / score-retain / escalate).
 *
 * Zero dependencies. Nothing in core/ or dispatch/ imports anything
 * outside this folder — see MANIFEST.json's decoupling_rule and
 * warp.spec for the full contract. This file is the one addition: there
 * was no single top-level entry point before (only core/index.js and
 * dispatch/index.js separately) — this just re-exports both plus
 * plugins, so `require('warp')` works instead of reaching into subpaths.
 */
const core = require('./core');
const dispatch = require('./dispatch');
const population = require('./dispatch/population');
const { FlatFileCrystallizer } = require('./plugins/crystallizer-flatfile');
const { scoreDefault, estimateTokens } = require('./plugins/scorer-default');

module.exports = {
  // core primitives
  Event: core.Event,
  Gate: core.Gate,
  Axiom: core.Axiom,
  Stream: core.Stream,
  StreamLog: core.StreamLog,
  fuseChain: core.fuseChain,
  canFuse: core.canFuse,

  // WARP 2 (EM2) — cause → effect links, expectations, the causal ledger, the engine
  createLink: core.createLink,
  createExpectation: core.createExpectation,
  Ledger: core.Ledger,
  Engine: core.Engine,

  // dispatch
  unifiedDispatch: dispatch.unifiedDispatch,

  // population + promotion policies
  PopulationStore: population.PopulationStore,
  defaultPromotionPolicy: population.defaultPromotionPolicy,
  reuseCountPromotionPolicy: population.reuseCountPromotionPolicy,
  firstSuccessPromotionPolicy: population.firstSuccessPromotionPolicy,
  DEFAULT_PROMOTE_THRESHOLD: population.DEFAULT_PROMOTE_THRESHOLD,
  DEFAULT_FITNESS_MIN: population.DEFAULT_FITNESS_MIN,

  // plugins (reference implementations — swap for your own via Stream.hook())
  FlatFileCrystallizer,
  scoreDefault,
  estimateTokens,
};
