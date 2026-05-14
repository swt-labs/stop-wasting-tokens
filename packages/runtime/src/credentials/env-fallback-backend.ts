/**
 * Phase 1 — Keychain Credential Adapter: the read-only env-var fallback backend.
 *
 * `createEnvFallbackBackend()` is the **headless** path (Risk 4, Lead risk
 * register). When `probeKeychain()` reports the OS keychain unavailable — CI
 * runners, headless Linux with no Secret Service daemon, login keychains
 * locked over SSH — `resolveCredentialStore` wires THIS backend instead.
 *
 * It is **read-only**:
 *  - `getSecret` resolves `<PROVIDER>_API_KEY`-style env vars (the same
 *    canonical upper-snake resolution as `pi-ai`'s `getEnvApiKey`). OAuth
 *    accounts always resolve to `undefined` — OAuth tokens are never in env
 *    vars (the same exclusion `pi-ai`'s `getEnvApiKey` documents).
 *  - `setSecret` / `deleteSecret` **both throw a clear, actionable `Error`** —
 *    they NEVER silently drop a write and NEVER write a SWT-owned plaintext
 *    file (research §3 / Risk 4). The message tells the operator exactly which
 *    env var to set.
 *  - `listAccounts` returns the encoded accounts for exactly those providers
 *    that have a resolvable `<PROVIDER>_API_KEY` env var, so `list()` still
 *    reflects reality in headless mode.
 *
 * It imports ONLY `./types.ts` + `./namespace.ts` — no native module. (The
 * native module is touched only by `keychain-backend.ts` and `probe.ts`.)
 */

import { decodeAccount, encodeAccount } from './namespace.js';
import type { CredentialBackend } from './types.js';

/**
 * The provider-id -> environment-variable-name mapping. Mirrors `pi-ai`'s
 * `getEnvApiKey` resolution: the canonical `<PROVIDER>_API_KEY` upper-snake
 * form (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, ...). This is
 * the SINGLE source of truth for env-var names in the fallback path — and it
 * round-trips cleanly with the `listAccounts` reverse-mapping below for the
 * single-word providers in play this milestone (`anthropic`, `openai`,
 * `google`). Non-alphanumeric chars collapse to `_`.
 */
function envVarNameFor(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}

/** The clear, actionable rejection message shape for `set`/`delete`. */
function fallbackRejectHint(provider: string): string {
  return (
    `Keychain unavailable on this host — cannot persist a credential for ${provider}. ` +
    `Set ${envVarNameFor(provider)} in your environment instead.`
  );
}

/** Decode a provider id from an encoded account, falling back to the raw
 *  account string if it does not decode — used only to shape the rejection
 *  message, never to read a secret. */
function safeProvider(account: string): string {
  try {
    return decodeAccount(account).provider;
  } catch {
    return account;
  }
}

/**
 * Build the read-only env-var-passthrough {@link CredentialBackend} — the
 * headless fallback (Risk 4). See the module doc for the read-only contract.
 */
export function createEnvFallbackBackend(): CredentialBackend {
  return {
    async getSecret(account: string): Promise<string | undefined> {
      let ref;
      try {
        ref = decodeAccount(account);
      } catch {
        // A malformed / non-SWT account never resolves to an env secret.
        return undefined;
      }
      // OAuth tokens are never in env vars — mirror pi-ai's getEnvApiKey
      // exclusion.
      if (ref.authMode === 'oauth') return undefined;
      const value = process.env[envVarNameFor(ref.provider)];
      return value != null && value.length > 0 ? value : undefined;
    },

    async setSecret(account: string): Promise<void> {
      // Read-only backend: NEVER silently drop the write, NEVER write a
      // SWT-owned plaintext file — throw a clear, actionable error.
      throw new Error(fallbackRejectHint(safeProvider(account)));
    },

    async deleteSecret(account: string): Promise<boolean> {
      // Read-only backend: same clear rejection as setSecret.
      throw new Error(fallbackRejectHint(safeProvider(account)));
    },

    async listAccounts(): Promise<string[]> {
      // Return encoded accounts for providers with a resolvable
      // <PROVIDER>_API_KEY env var, so list() reflects reality in headless
      // mode. Derive the candidate provider list from env var names matching
      // the *_API_KEY pattern.
      const accounts: string[] = [];
      for (const [name, value] of Object.entries(process.env)) {
        if (value == null || value.length === 0) continue;
        const match = /^([A-Z0-9_]+)_API_KEY$/.exec(name);
        if (match == null || match[1] == null) continue;
        const provider = match[1].toLowerCase();
        if (provider.length === 0) continue;
        accounts.push(encodeAccount(provider, 'api_key'));
      }
      return accounts;
    },
  };
}
