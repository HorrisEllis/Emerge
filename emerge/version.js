'use strict';
/**
 * version.js — single source of truth for spec-compiler version strings.
 *
 * Every module that needs to report its version reads from here.
 * To bump the system version: change SYSTEM here only.
 * Individual module versions track their own semver independently
 * but are grouped under the system version for coherent reporting.
 */

const pkg = require('./package.json');

const VERSION = {
  // System version — matches package.json
  SYSTEM: pkg.version,

  // Module versions — bumped independently when their interface changes
  SISO:        '1.0.0',
  KG_BUILDER:  '1.0.0',
  TIER:        '1.0.0',
  INVARIANTS:  '1.0.0',
  GAP_FIELD:   '1.0.0',
  REPLY:       '1.0.0',
  PIPELINE:    '1.1.0',  // v2 rewrite as SISO stream + gap field + reply engine wired
  CHUNK:       '1.0.0',
  CORTEX:      '1.0.0',
  WRITEBACK:   '1.0.0',
  EMIT:        '1.0.0',
  BASELINE:    '1.0.0',

  // Compiler stamp used in generated file headers
  COMPILER_ID:     'spec-compiler',
  COMPILER_STAMP:  () => `spec-compiler v${pkg.version}`,
};

module.exports = VERSION;
