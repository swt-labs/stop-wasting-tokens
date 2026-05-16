/**
 * Plan 01-01 (Milestone 12) — the auth-config schema + parser moved to
 * `@swt-labs/runtime` (L2). This module is now a thin re-export shim so
 * existing CLI call sites and test files (importing from
 * `./auth-config.js` or `../../src/commands/auth-config.js`) keep working
 * with zero edits.
 *
 * The function bodies + JSDoc + risk-register prose live in
 * `packages/runtime/src/credentials/auth-config.ts` — see that file for the
 * Phase 2 origin context (Risk 2 / Risk 3 / Risk 8).
 *
 * Originally introduced as a standalone CLI module by Plan 02-01 (Phase 2 /
 * Selection → Spawn Wiring); promoted to runtime in Plan 01-01 so the
 * dashboard L7 chat route can consume it without violating the layer rules.
 */

export {
  parseAuthConfig,
  DEFAULT_AUTH_CONFIG,
  type AuthConfig,
  type AuthProviderEntry,
  type AuthMode,
} from '@swt-labs/runtime';
