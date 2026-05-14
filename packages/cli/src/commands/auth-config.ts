/**
 * Phase 2 — the additive `auth` config block: schema types + the
 * `parseAuthConfig` pure parser.
 *
 * The `auth` block answers *"how does each provider authenticate"* — a concern
 * deliberately SEPARATE from `providers.strategy` (which answers *"which
 * provider for this task"*). They have different lifecycles (re-auth without
 * re-routing; re-route without re-auth), so per research §4 the schema is its
 * own ADDITIVE block, NOT new fields on `providers`. Nothing in this module
 * references `parseProvidersConfig`, `parseStrategy`, `CookProvidersConfig`, or
 * `provider-router` — the `auth` block is structurally independent.
 *
 * This is a standalone module, NOT an edit to `cook.ts`, so the whole of Phase
 * 2 touches `cook.ts` in exactly one plan (02-04, which imports
 * {@link parseAuthConfig} and calls it on `parsed['auth']` alongside the
 * existing `parseProvidersConfig(parsed['providers'])`).
 *
 * Architect risk register:
 *
 * - **Risk 2 — SWT owns OAuth refresh; the schema enables it.** An
 *   {@link AuthProviderEntry} stores `{mode, credentialRef}` ONLY — never an
 *   inline token, never an `expires`. The credential VALUE (an API-key string
 *   today; a serialized `OAuthCredentials` JSON blob in Phase 4) lives
 *   exclusively in the keychain under `credentialRef`. Because nothing about
 *   the persisted token lives in `config.json`, Phase 4 can adopt
 *   SWT-owns-refresh with zero schema change. `parseAuthConfig` accepts the
 *   `'oauth'` `AuthMode` today precisely so the schema needs no Phase 4 churn.
 * - **Risk 3 — per-project selection, global credential; global
 *   `credentialRef` naming.** The `auth` block lives per-project in
 *   `.swt-planning/config.json`; the keychain entry `credentialRef` names is
 *   global (one per user/machine). `credentialRef` naming is the global
 *   `swt:<provider>:<authMode>` namespace Phase 1's `encodeAccount` produces —
 *   NOT project-scoped. `credentialRef` is OPTIONAL in the schema; when
 *   omitted, the cook spawn callsite (02-04) derives the default
 *   `swt:<provider>:<mode>`. `credentialRef`, when present, is a keychain key
 *   NAME — NEVER the secret value.
 * - **Risk 8 — provider + auth-mode only.** An {@link AuthProviderEntry} has
 *   NO `model` field. Model resolution is Pi's job (its `ModelRegistry` +
 *   `model-resolver.ts`). A model-picker is a documented fast-follow, out of
 *   this milestone.
 */

import type { AuthMode } from '@swt-labs/runtime';

/**
 * Re-export so the cli auth-config schema's `AuthMode` is byte-identical to
 * Phase 1's `credentials/types.ts` `AuthMode` and the two can never drift.
 */
export type { AuthMode };

/**
 * One provider's auth entry in the `.swt-planning/config.json` `auth` block.
 * `mode` is required. `credentialRef` is OPTIONAL — when omitted, the cook
 * spawn callsite (02-04) derives the global default `swt:<provider>:<mode>`
 * via Phase 1's `encodeAccount` (Risk 3). `credentialRef`, when present, is a
 * keychain key NAME — NEVER the secret value.
 */
export interface AuthProviderEntry {
  readonly mode: AuthMode;
  readonly credentialRef?: string;
}

/**
 * The whole `auth` block: provider id -> auth entry. Additive + SEPARATE
 * from `providers.strategy` (which is routing, not credentials).
 */
export interface AuthConfig {
  readonly [provider: string]: AuthProviderEntry;
}

/**
 * Empty default — no `auth` block configured. Phase 2 behaviour is then
 * byte-identical to pre-Phase-2: the cook callsite resolves nothing and
 * `createSession` falls through to Pi's own auth.json + env-var resolution.
 */
export const DEFAULT_AUTH_CONFIG: AuthConfig = {};
