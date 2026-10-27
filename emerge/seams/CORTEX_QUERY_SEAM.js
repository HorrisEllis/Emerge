'use strict';
/**
 * SEAM: CORTEX_QUERY_SEAM
 * version: 1.0.0
 * status: active
 * between: [spec-compiler] → [cortex-3748]
 * description: Everything the compiler is allowed to ask Cortex before generating.
 *
 * AXIOM: Query before generate. Cortex is the truth.
 * If Cortex already has it, the compiler does not emit it.
 * This is the token floor. Everything beneath this line was already paid for.
 *
 * §2.1  Cortex is append-only. Compiler reads only. No writes through this seam.
 * §1.2  Every query result is typed. Missing fields = explicit null, never undefined.
 * §1.1  Nothing exists until Cortex confirms it. Compiler never assumes prior state.
 */

const CORTEX_QUERY_SEAM = {
  name:        'CORTEX_QUERY_SEAM',
  version:     '1.0.0',
  status:      'active',
  between:     ['spec-compiler', 'cortex-3748'],
  description: 'Compiler queries Cortex to determine what already exists before generating anything.',

  // ── What the compiler sends ───────────────────────────────────────────────
  contract: {
    commands: {

      // Does this module exist in project_registry?
      'cortex.query.project': {
        payload:    { name: 'string' },
        returns:    { exists: 'boolean', uuid: 'string|null', version: 'string|null', lastSeenAt: 'number|null' },
        errors:     [{ code: 'CORTEX_UNREACHABLE', fatal: false, fallback: 'assume_empty' }],
        idempotent: true,
        timeout_ms: 3000,
      },

      // What files does Cortex already have for this module in versionium_file_index?
      'cortex.query.files': {
        payload:    { project: 'string' },
        returns:    { files: 'FileRecord[]' },
        errors:     [{ code: 'CORTEX_UNREACHABLE', fatal: false, fallback: 'assume_empty' }],
        idempotent: true,
        timeout_ms: 3000,
      },

      // What open gaps exist for this module or path?
      'cortex.query.gaps': {
        payload:    { path: 'string', severity: 'string|null' },
        returns:    { gaps: 'GapRecord[]' },
        errors:     [{ code: 'CORTEX_UNREACHABLE', fatal: false, fallback: 'assume_empty' }],
        idempotent: true,
        timeout_ms: 3000,
      },

      // What seam records exist for a named seam?
      'cortex.query.seams': {
        payload:    { name: 'string' },
        returns:    { records: 'SeamRecord[]', verified: 'boolean' },
        errors:     [{ code: 'CORTEX_UNREACHABLE', fatal: false, fallback: 'assume_empty' }],
        idempotent: true,
        timeout_ms: 3000,
      },

      // What does Cortex memory say about a term? (crystals + memory_index)
      'cortex.query.memory': {
        payload:    { q: 'string' },
        returns:    { results: 'MemoryRecord[]', crystals: 'CrystalRecord[]' },
        errors:     [{ code: 'CORTEX_UNREACHABLE', fatal: false, fallback: 'assume_empty' }],
        idempotent: true,
        timeout_ms: 3000,
      },

      // Full pre-build check: project + files + gaps in one call
      'cortex.query.preflight': {
        payload: {
          moduleName:  'string',   // e.g. "spec-parser"
          specPath:    'string',   // e.g. "spec-parser.spec"
          outputDir:   'string',   // where T0/T1 will emit
        },
        returns: {
          project:     'ProjectRecord|null',
          existingFiles: 'FileRecord[]',       // files already in versionium
          openGaps:    'GapRecord[]',          // open gaps for this module
          seamRecords: 'SeamRecord[]',         // verified seams touching this module
          memory:      'MemoryRecord[]',       // cortex memory hits for module name
          skipGeneration: 'boolean',           // true if all files already exist + no open gaps
          staleFiles:  'string[]',             // files that exist but are older than spec
          summary:     'string',              // human-readable: what compiler found
        },
        errors:     [{ code: 'CORTEX_UNREACHABLE', fatal: false, fallback: 'assume_empty' }],
        idempotent: true,
        timeout_ms: 5000,
      },
    },

    // ── What Cortex emits (compiler listens via SSE) ──────────────────────
    events: {
      'cortex.gap.found':     { payload: { gapUuid: 'string', path: 'string', type: 'string', severity: 'string' }, ordering: 'best-effort' },
      'cortex.gap.resolved':  { payload: { gapUuid: 'string', resolvedBy: 'string' }, ordering: 'best-effort' },
      'cortex.memory.updated':{ payload: { table: 'string', uuid: 'string' }, ordering: 'best-effort' },
    },
  },

  // ── Isolation rules ───────────────────────────────────────────────────────
  isolation: {
    rules: [
      'spec-compiler never writes to Cortex through this seam — read-only',
      'spec-compiler never imports cortex modules directly',
      'All cortex communication through HTTP to :3748 only',
      'Cortex unavailability is non-fatal — compiler falls back to assume_empty and logs a gap',
      'No shared mutable state across this boundary',
    ],
    verified_by: 'runtime',
  },

  // ── Return type shapes ────────────────────────────────────────────────────
  types: {
    FileRecord: {
      hash:      'string',
      name:      'string',
      project:   'string|null',
      mime:      'string',
      sizeBytes: 'number',
      createdAt: 'number',
    },
    GapRecord: {
      uuid:      'string',
      path:      'string',
      type:      'string',
      severity:  'string',   // high | medium | low
      body:      'string',
      status:    'string',   // pending | needs_manual | resolved
      createdAt: 'number',
    },
    SeamRecord: {
      uuid:       'string',
      name:       'string',
      version:    'string',
      verified:   'boolean',
      verifiedAt: 'number|null',
    },
    ProjectRecord: {
      uuid:      'string',
      name:      'string',
      version:   'string|null',
      lastSeenAt:'number',
    },
    MemoryRecord: {
      uuid:      'string',
      content:   'string',
      source:    'string',
      tier:      'string',   // working | short | long
      ts:        'number',
    },
    CrystalRecord: {
      uuid:      'string',
      content:   'string',
      state:     'string',   // stable | candidate | decaying
      weight:    'number',
    },
  },

  // ── Fallback when Cortex is unreachable ───────────────────────────────────
  fallback: {
    strategy: 'assume_empty',
    description: 'All queries return empty results. Compiler generates as if nothing exists. Logs a gap: cortex_unreachable.',
    gap_written: true,
    gap_type:    'cortex_unreachable',
    gap_severity:'medium',
  },

  // ── Test spec ─────────────────────────────────────────────────────────────
  test: {
    mock_cortex: [
      'Return { exists: false } for cortex.query.project → verify compiler proceeds with full generation',
      'Return { exists: true, files: [all target files] } → verify compiler sets skipGeneration: true',
      'Return { openGaps: [{ severity: "high" }] } → verify gaps appear in chunk payload',
      'Simulate timeout → verify compiler logs cortex_unreachable gap and falls back to assume_empty',
    ],
    mock_compiler: [
      'Send cortex.query.preflight with known module → verify correct HTTP calls are made to :3748',
    ],
  },
};

module.exports = CORTEX_QUERY_SEAM;
