/**
 * Plan 04-02 (Phase 4) — OAuth login flow: the `pi-ai` OAuth subsystem
 * driver (`runOAuthLoginFlow` bridges `pi-ai`'s `OAuthLoginCallbacks` onto
 * SWT emitter callbacks) + the keychain `OAuthCredentials` storage helpers
 * (`storeOAuthCredentials` / `readOAuthCredentials` persist the serialized
 * blob under `swt:<provider>:oauth` via Phase 1's `CredentialStore`).
 *
 * Plan 04-04 (Phase 4 / Risk 2) — the SWT-owns-refresh module
 * (`refreshOAuthCredentialsIfNeeded` — spawn-time lazy-refresh: checks
 * `OAuthCredentials.expires`, calls `pi-ai`'s `refreshToken` when
 * near-expiry, and writes the refreshed blob back to the keychain via
 * `storeOAuthCredentials`).
 *
 * `getOAuthProvider` is re-exported from `@earendil-works/pi-ai/oauth` so the
 * dashboard's `/api/provider-auth/oauth/*` route can run its up-front
 * "is this provider supported?" check through the existing
 * `@swt-labs/runtime` edge — the dashboard never imports `@earendil-works/pi-ai`
 * directly.
 */
export {
  runOAuthLoginFlow,
  type OAuthLoginFlowOptions,
  type OAuthLoginFlowHandle,
} from './oauth-flow.js';
export { storeOAuthCredentials, readOAuthCredentials } from './oauth-credentials-store.js';
export { refreshOAuthCredentialsIfNeeded, OAuthRefreshError } from './oauth-refresh.js';
export { getOAuthProvider } from '@earendil-works/pi-ai/oauth';
export type { OAuthCredentials, OAuthProviderInterface } from '@earendil-works/pi-ai/oauth';
export { mapToOAuthProviderId, SWT_TO_PI_OAUTH_PROVIDER_ID } from './provider-id-map.js';
