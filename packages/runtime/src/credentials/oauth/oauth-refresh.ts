/**
 * Plan 04-04 (Phase 4 / Risk 2) — the SWT-owns-refresh module.
 *
 * This is the spawn-time lazy-refresh half of "SWT owns refresh". Phase 2
 * locked the decision and built the forward-compatible seam (the `auth`
 * config block stores `{mode, credentialRef}` only; the credential VALUE
 * lives exclusively in the OS keychain under `swt:<provider>:oauth`;
 * `createSession` injects via an `InMemoryAuthStorageBackend`-backed
 * `AuthStorage` — RAM-only). Phase 4 implements the refresh half.
 *
 * `refreshOAuthCredentialsIfNeeded` checks `OAuthCredentials.expires`
 * against `Date.now()` + a ~60s safety margin. When the credential is
 * still valid it is returned UNCHANGED — no refresh, no keychain write.
 * When it is near-expiry or already expired it calls `pi-ai`'s
 * `getOAuthProvider(provider).refreshToken(credentials)` for a fresh blob,
 * writes the fresh blob BACK to the keychain via 04-02's
 * `storeOAuthCredentials`, and returns the fresh blob.
 *
 * Pi's own `AuthStorage` auto-refresh is NEVER relied on: the injected
 * backend is in-memory and freshly built per spawn, so even if Pi did
 * auto-refresh, the refreshed token would live only in that ephemeral RAM
 * store. SWT does the refresh + keychain write-back itself, BEFORE
 * injecting — no write-back loop to Pi's plaintext `auth.json` is possible.
 *
 * Never-log invariant: this module NEVER logs the `OAuthCredentials` blob
 * (no `console.*`) and NEVER writes it anywhere but the keychain (via
 * `storeOAuthCredentials`). A `refreshToken()` rejection is surfaced as a
 * clear `OAuthRefreshError` — the cook callsite catches it and degrades to
 * the existing credential rather than crashing the cook turn.
 */

import { getOAuthProvider } from '@earendil-works/pi-ai/oauth';
import type { OAuthCredentials } from '@earendil-works/pi-ai/oauth';

import { storeOAuthCredentials } from './oauth-credentials-store.js';

/** A ~60s safety margin — a credential expiring within this window of
 *  Date.now() is refreshed BEFORE injection so it cannot expire mid-spawn. */
const DEFAULT_MARGIN_MS = 60_000;

/** Thrown when pi-ai's refreshToken() rejects (network error, revoked
 *  refresh token). The caller (the cook callsite) catches this and degrades
 *  to the existing credential rather than crashing the cook turn. */
export class OAuthRefreshError extends Error {
  constructor(
    message: string,
    readonly provider: string,
  ) {
    super(message);
    this.name = 'OAuthRefreshError';
  }
}

/**
 * SWT-owns-refresh (Risk 2). Returns the input `credentials` unchanged when
 * they are still valid (expires more than `marginMs` out). When near-expiry
 * or expired: calls pi-ai's getOAuthProvider(provider).refreshToken(creds)
 * for a fresh blob, writes it BACK to the keychain via storeOAuthCredentials,
 * and returns the fresh blob. getOAuthProvider returning undefined (no pi-ai
 * OAuth provider for this id) -> return the input unchanged (cannot refresh;
 * the caller degrades). A refreshToken() rejection -> throws OAuthRefreshError.
 * NEVER logs the OAuthCredentials blob.
 */
export async function refreshOAuthCredentialsIfNeeded(
  provider: string,
  credentials: OAuthCredentials,
  opts?: { marginMs?: number },
): Promise<OAuthCredentials> {
  const margin = opts?.marginMs ?? DEFAULT_MARGIN_MS;
  const nearExpiry =
    typeof credentials.expires === 'number' &&
    credentials.expires <= Date.now() + margin;
  if (!nearExpiry) return credentials; // still valid — no refresh, no keychain write

  const oauthProvider = getOAuthProvider(provider);
  if (oauthProvider === undefined) return credentials; // cannot refresh — degrade

  let refreshed: OAuthCredentials;
  try {
    refreshed = await oauthProvider.refreshToken(credentials);
  } catch (err) {
    throw new OAuthRefreshError(
      `OAuth token refresh failed for '${provider}': ${
        err instanceof Error ? err.message : String(err)
      }`,
      provider,
    );
  }
  await storeOAuthCredentials(provider, refreshed); // SWT-owns-refresh write-back
  return refreshed;
}
