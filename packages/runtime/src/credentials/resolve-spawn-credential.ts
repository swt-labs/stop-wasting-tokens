/**
 * `resolveSpawnCredential` — the runtime-layer (L2) credential resolver for
 * a single `(provider, authConfig)` pair. Returns the keychain-resolved secret
 * shaped for a Pi session spawn (`{provider, resolvedCredential: {authMode,
 * secret}}`), or `undefined` on any graceful-degrade path.
 *
 * Moved from `packages/cli/src/commands/cook.ts` (Plan 02-04 / Phase 2-04
 * origin; Plan 04-04 OAuth refresh path) to `@swt-labs/runtime` in Plan 01-01
 * (Milestone 12 — Free-talk mode) so the dashboard L7 chat route can call it
 * without violating the layer rules (dashboard cannot import cli).
 *
 * Behaviour is BYTE-IDENTICAL to the alpha.20 cook implementation:
 *
 *  - `'api_key'` arm — keychain `get(provider, mode)` → `{authMode: 'api_key',
 *    secret}`.
 *  - `'oauth'` arm (Plan 04-04) — keychain secret is a serialized
 *    `OAuthCredentials` JSON blob. Spawn-time lazy-refresh (Risk 2):
 *    parse → `refreshOAuthCredentialsIfNeeded` (writes refreshed blob back to
 *    keychain) → re-serialize into `resolvedCredential.secret`. A corrupt blob
 *    degrades to `undefined`; an `OAuthRefreshError` (revoked token / network
 *    failure) degrades to the existing stale blob with a non-secret stderr
 *    breadcrumb — a refresh failure never crashes the spawn turn.
 *  - Any other unexpected error → `undefined` (graceful degrade, never throws).
 *
 * `AuthConfig` / `AuthMode` live next to this module in `./auth-config.ts`
 * and `./types.ts` — both moved here in Plan 01-01 alongside this function.
 */

import type { AuthConfig } from './auth-config.js';
import {
  OAuthRefreshError,
  refreshOAuthCredentialsIfNeeded,
  type OAuthCredentials,
} from './oauth/index.js';
import { resolveCredentialStore } from './resolve-store.js';
import type { AuthMode } from './types.js';

/**
 * Resolve the spawn credential for a single `provider` from the project's
 * `auth` config block. The function consults the keychain via
 * `resolveCredentialStore` and, for `'oauth'` entries, runs the
 * SWT-owns-refresh check (`refreshOAuthCredentialsIfNeeded`) before
 * re-serializing the (possibly refreshed) blob into the returned `secret`.
 *
 * Returns `undefined` (graceful degrade, never throws) whenever:
 *   - the `authConfig` has no entry for `provider`,
 *   - the keychain has no secret for `(provider, mode)`,
 *   - the `'oauth'` blob is non-JSON (corrupt),
 *   - any unexpected error is raised by the keychain layer or by an
 *     `'oauth'` refresh path other than `OAuthRefreshError`.
 *
 * The one NON-degrade-to-undefined branch on the `'oauth'` arm is
 * `OAuthRefreshError` — the function emits a non-secret stderr breadcrumb
 * (`swt cook: provider ${provider} — OAuth token refresh failed, using
 * existing credential\n`) and degrades to the EXISTING stale blob rather
 * than `undefined`. Preserving the alpha.20 fix.
 */
export async function resolveSpawnCredential(
  provider: string,
  authConfig: AuthConfig,
): Promise<
  { provider: string; resolvedCredential: { authMode: AuthMode; secret: string } } | undefined
> {
  const entry = authConfig[provider];
  if (entry === undefined) return undefined; // no auth block for this provider — degrade

  try {
    // `resolveCredentialStore()` is Phase 1's Phase-2 entry point: it probes
    // the OS keychain and returns a keychain-backed store when available, the
    // read-only env-var fallback otherwise (headless hosts). Neither the probe
    // nor `store.get` throws — but the try/catch is the belt-and-braces net.
    const { store } = await resolveCredentialStore();
    // `store.get(provider, mode)` does the `encodeAccount(provider, mode)`
    // derivation internally — so the omitted-`credentialRef` case (the common
    // case) needs nothing more than the provider + mode.
    const secret = await store.get(provider, entry.mode);
    if (secret === undefined || secret.length === 0) return undefined; // keychain miss — degrade

    // Plan 04-04 — for an 'oauth' authMode entry, the keychain secret is a
    // serialized OAuthCredentials JSON blob. Spawn-time lazy-refresh
    // (Risk 2): parse it, refresh-if-near-expiry (which writes the refreshed
    // blob back to the keychain via storeOAuthCredentials), re-serialize.
    // The OAuthCredentials blob is NEVER logged — the refresh-failed
    // breadcrumb carries only the provider id + a status string.
    if (entry.mode === 'oauth') {
      let oauthCredentials: OAuthCredentials;
      try {
        oauthCredentials = JSON.parse(secret) as OAuthCredentials;
      } catch {
        return undefined; // corrupt blob — graceful degrade, never throw
      }
      let effective = oauthCredentials;
      try {
        effective = await refreshOAuthCredentialsIfNeeded(provider, oauthCredentials);
      } catch (err) {
        // OAuthRefreshError — refresh failed (revoked token, network). Degrade
        // to the existing (stale) blob rather than crashing the spawn turn; if
        // it is genuinely dead, Pi surfaces the auth error downstream.
        if (err instanceof OAuthRefreshError) {
          process.stderr.write(
            `swt cook: provider ${provider} — OAuth token refresh failed, using existing credential\n`,
          );
          effective = oauthCredentials;
        } else {
          return undefined; // unexpected — degrade
        }
      }
      return {
        provider,
        resolvedCredential: { authMode: 'oauth', secret: JSON.stringify(effective) },
      };
    }

    // 'api_key' — unchanged from Phase 2-04.
    return { provider, resolvedCredential: { authMode: entry.mode, secret } };
  } catch {
    // resolveCredentialStore / store.get should not throw (Phase 1's probe
    // never throws; the env-fallback's get never throws) — but if anything
    // unexpected does, degrade gracefully rather than failing the spawn turn.
    return undefined;
  }
}
