/**
 * Auth config schema + the `parseAuthConfig` pure parser.
 *
 * Moved from `packages/cli/src/commands/auth-config.ts` (Plan 02-01 origin)
 * to `@swt-labs/runtime` in Plan 01-01 (Milestone 12) so the dashboard L7
 * chat route can consume them without violating the layer rules (Layer L7
 * cannot import L6 cli; runtime is L2 so the chat route can import freely).
 *
 * The `auth` block answers *"how does each provider authenticate"* — a concern
 * deliberately SEPARATE from `providers.strategy` (which answers *"which
 * provider for this task"*). They have different lifecycles (re-auth without
 * re-routing; re-route without re-auth), so per the original Phase-2 research
 * §4 the schema is its own ADDITIVE block, NOT new fields on `providers`.
 *
 * Architect risk register (preserved from the Phase-2 origin):
 *
 * - **Risk 2 — SWT owns OAuth refresh; the schema enables it.** An
 *   {@link AuthProviderEntry} stores `{mode, credentialRef}` ONLY — never an
 *   inline token, never an `expires`. The credential VALUE (an API-key string
 *   today; a serialized `OAuthCredentials` JSON blob in Phase 4) lives
 *   exclusively in the keychain under `credentialRef`. Because nothing about
 *   the persisted token lives in `config.json`, Phase 4 adopts
 *   SWT-owns-refresh with zero schema change. `parseAuthConfig` accepts the
 *   `'oauth'` `AuthMode` today precisely so the schema needs no Phase 4 churn.
 * - **Risk 3 — per-project selection, global credential; global
 *   `credentialRef` naming.** The `auth` block lives per-project in
 *   `.swt-planning/config.json`; the keychain entry `credentialRef` names is
 *   global (one per user/machine). `credentialRef` naming is the global
 *   `swt:<provider>:<authMode>` namespace Phase 1's `encodeAccount` produces —
 *   NOT project-scoped. `credentialRef` is OPTIONAL in the schema; when
 *   omitted, the cook spawn callsite derives the default
 *   `swt:<provider>:<mode>`. `credentialRef`, when present, is a keychain key
 *   NAME — NEVER the secret value.
 * - **Risk 8 — provider + auth-mode only.** An {@link AuthProviderEntry} has
 *   NO `model` field. Model resolution is Pi's job (its `ModelRegistry` +
 *   `model-resolver.ts`). A model-picker is a documented fast-follow.
 */

import type { AuthMode } from './types.js';

/**
 * One provider's auth entry in the `.swt-planning/config.json` `auth` block.
 * `mode` is required. `credentialRef` is OPTIONAL — when omitted, the spawn
 * callsite derives the global default `swt:<provider>:<mode>` via Phase 1's
 * `encodeAccount` (Risk 3). `credentialRef`, when present, is a keychain key
 * NAME — NEVER the secret value.
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
 * Empty default — no `auth` block configured. Behaviour is then byte-identical
 * to pre-Phase-2: the cook callsite resolves nothing and `createSession`
 * falls through to Pi's own auth.json + env-var resolution.
 */
export const DEFAULT_AUTH_CONFIG: AuthConfig = {};

/**
 * Pure, total, defensive parser for the `auth` block. NEVER throws — returns
 * {@link DEFAULT_AUTH_CONFIG} on malformed input and silently drops individual
 * invalid entries (mirrors `cook.ts`'s `parseProvidersConfig` discipline:
 * misconfigured values never crash the cook handler — they fall back to
 * defaults).
 *
 * Per-entry contract:
 *  - A `provider` key that is empty/whitespace, or contains a `':'`, is
 *    dropped — `credentialRef` defaults to `swt:<provider>:<mode>`, so such a
 *    provider id would be ambiguous (mirrors Phase 1 `encodeAccount`'s
 *    collision-safety constraint). Drop, don't throw.
 *  - An `entry` that is not a plain object (null / array / primitive) is
 *    dropped.
 *  - `entry.mode` must be exactly `'api_key'` or `'oauth'`; anything else
 *    drops the entry.
 *  - `credentialRef` is included ONLY when it is a non-empty string
 *    (whitespace-only / non-string ⇒ omitted, so the callsite derives
 *    the default `swt:<provider>:<mode>` via Phase 1's `encodeAccount`). It is
 *    omitted as a KEY, never surfaced as `credentialRef: undefined`.
 *
 * The returned object is always a fresh plain object — never the input by
 * reference. Deterministic — no clock / random / env / IO reads.
 *
 * It is handed ONLY the `auth` sub-object — it never reads or references the
 * `providers` block. It does NOT touch the keychain, does NOT call
 * `resolveCredentialStore`, and does NOT validate that the named credential
 * entry exists — that is a runtime concern at the spawn callsite.
 */
export function parseAuthConfig(raw: unknown): AuthConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return DEFAULT_AUTH_CONFIG;
  }
  const out: Record<string, AuthProviderEntry> = {};
  for (const [provider, entryRaw] of Object.entries(raw as Record<string, unknown>)) {
    // Collision-safety — credentialRef defaults to `swt:<provider>:<mode>`,
    // so a provider id with ':' or empty would be ambiguous (mirrors Phase 1
    // encodeAccount's constraint). Drop, don't throw.
    if (provider.trim().length === 0 || provider.includes(':')) continue;
    if (typeof entryRaw !== 'object' || entryRaw === null || Array.isArray(entryRaw)) continue;
    const entry = entryRaw as Record<string, unknown>;
    const mode = entry['mode'];
    // Closed set — only Phase 1's two AuthMode values pass. 'oauth' is
    // accepted today so the schema needs no churn when Phase 4 lands.
    if (mode !== 'api_key' && mode !== 'oauth') continue;
    const credentialRefRaw = entry['credentialRef'];
    const credentialRef =
      typeof credentialRefRaw === 'string' && credentialRefRaw.trim().length > 0
        ? credentialRefRaw
        : undefined;
    out[provider] = credentialRef !== undefined ? { mode, credentialRef } : { mode };
  }
  return out;
}
