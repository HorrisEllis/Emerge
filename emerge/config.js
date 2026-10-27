'use strict';
/**
 * emerge/config.js — real, distinct config for emerge's static
 * defaults. Matches the pattern established by guardian/config.js,
 * copilot/config.js, etc. — but genuinely scoped differently, checked
 * directly rather than forced to match: emerge-ide.js's real PORT and
 * DEF_MODEL support CLI flag overrides (--port, --model) via a real
 * getArg() helper that reads process.argv. A static config file can't
 * represent "the value unless a CLI flag says otherwise" — that
 * genuinely CLI-aware logic stays in emerge-ide.js itself. This file
 * only centralizes the real, static fallback DEFAULTS those CLI flags
 * fall back to, plus BUS_LOG_MAX (no CLI/env override exists for it).
 */

module.exports = {
  DEFAULT_PORT: parseInt(process.env.EMERGE_PORT || '4242', 10),
  BUS_LOG_MAX: 200,
};
