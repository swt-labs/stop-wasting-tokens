/**
 * Public surface for the SWT keychain credential adapter (Phase 1).
 *
 * `resolveCredentialStore` is the Phase 2+ entry point — it probes the OS
 * keychain and returns a store backed by either the native keychain backend
 * or the read-only env-var fallback. `createCredentialStore` is the
 * lower-level primitive for callers that already hold a backend.
 *
 * This sub-barrel is itself native-dep-free: the native module is imported
 * only by `keychain-backend.ts` + `probe.ts` (the `layering.test.ts`
 * invariant). The barrel re-exports `createKeychainBackend` / `probeKeychain`
 * by name but never imports the native module directly.
 */
export { createCredentialStore } from './credential-store.js';
export { createInMemoryBackend } from './in-memory-backend.js';
export { createKeychainBackend } from './keychain-backend.js';
export { createEnvFallbackBackend } from './env-fallback-backend.js';
export { probeKeychain } from './probe.js';
export { resolveCredentialStore } from './resolve-store.js';
export { encodeAccount, decodeAccount, SWT_KEYCHAIN_SERVICE } from './namespace.js';
// Plan 01-01 (Milestone 12) — auth-config schema + parser moved from
// @swt-labs/cli to @swt-labs/runtime so the dashboard L7 chat route can
// consume them without violating the layer rules.
export { parseAuthConfig, DEFAULT_AUTH_CONFIG } from './auth-config.js';
export type { AuthConfig, AuthProviderEntry } from './auth-config.js';
// Plan 01-01 (Milestone 12) — `resolveSpawnCredential` moved from
// @swt-labs/cli `cook.ts:2349-2413` to @swt-labs/runtime so the L7 chat
// route can resolve credentials without importing L6 cli (layer rule).
export { resolveSpawnCredential } from './resolve-spawn-credential.js';
// Plan 01-01 (Milestone 12) — `readProjectAuthConfig` is the auth-block
// slice of `loadCookConfig`. The dashboard L7 chat route needs only the
// auth block, not providers/budget/qa_gate_overrides — those stay in
// @swt-labs/cli's `loadCookConfig`.
export { readProjectAuthConfig } from './read-project-auth-config.js';
// alpha.37 fix — chat route used `Object.keys(authConfig)[0]` as the
// active provider, silently ignoring the TopBar Provider dropdown's pin
// (`config.providers.strategy.provider`). `resolveActiveProvider` reads
// the same config.json ONCE and returns BOTH the auth block AND the
// pinned-or-first-authed provider id + the model from `config.model`.
export { resolveActiveProvider } from './resolve-active-provider.js';
export type { ActiveProviderSelection, ActiveProviderSource } from './resolve-active-provider.js';

export type {
  AuthMode,
  CredentialRef,
  CredentialBackend,
  CredentialStore,
  CredentialStoreOptions,
} from './types.js';
export type { KeychainProbeResult } from './probe.js';
export type { ResolveCredentialStoreOptions, ResolvedCredentialStore } from './resolve-store.js';
