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

export type {
  AuthMode,
  CredentialRef,
  CredentialBackend,
  CredentialStore,
  CredentialStoreOptions,
} from './types.js';
export type { KeychainProbeResult } from './probe.js';
export type { ResolveCredentialStoreOptions, ResolvedCredentialStore } from './resolve-store.js';
