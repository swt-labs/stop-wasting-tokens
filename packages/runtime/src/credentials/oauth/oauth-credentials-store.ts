/**
 * Plan 04-02 (Phase 4) — keychain `OAuthCredentials` storage.
 *
 * The keychain persistence layer for the OAuth credential blob — a thin
 * wrapper over Phase 1's authMode-agnostic `CredentialStore`
 * (`resolveCredentialStore()` → `store.set/get(provider, 'oauth', ...)`).
 *
 * Research §6 (security — never-log / never-persist): the serialized
 * `OAuthCredentials` JSON blob is the ONLY persistence of an OAuth
 * credential. It lives ONLY in the OS keychain under `swt:<provider>:oauth`
 * (the namespace Phase 1's `encodeAccount` produces for the `'oauth'`
 * authMode). It is NEVER written to `.swt-planning/` / `.vbw-planning/`
 * (transcripts + events JSONL included), NEVER logged, NEVER returned to the
 * SPA.
 *
 * 04-04's SWT-owns-refresh module reads/writes the refreshed blob through
 * these SAME helpers — they are the single keychain access point for the
 * OAuth credential.
 */

import type { OAuthCredentials } from '@earendil-works/pi-ai/oauth';

import { resolveCredentialStore } from '../resolve-store.js';

/**
 * Persist an `OAuthCredentials` blob to the OS keychain under
 * `swt:<provider>:oauth`. The blob is JSON-stringified — the keychain stores
 * opaque strings and Phase 1's `CredentialStore` is authMode-agnostic. The
 * blob is NEVER logged, NEVER written anywhere but the keychain.
 *
 * On a headless host with no keychain, Phase 1's read-only env-fallback
 * backend's `set` rejects with a clear "Keychain unavailable…" message; that
 * rejection propagates — an OAuth login on a host with no keychain genuinely
 * cannot persist, and the caller (the `/oauth/start` route) surfaces it as an
 * `oauth.error` event.
 */
export async function storeOAuthCredentials(
  provider: string,
  credentials: OAuthCredentials,
): Promise<void> {
  const { store } = await resolveCredentialStore();
  await store.set(provider, 'oauth', JSON.stringify(credentials));
}

/**
 * Read an `OAuthCredentials` blob back from the OS keychain. Returns
 * `undefined` when there is no entry OR when the stored JSON is corrupt — a
 * corrupt blob degrades to `undefined` rather than throwing (mirrors the
 * credentials module's defensive discipline). Logs nothing — this is a
 * library.
 */
export async function readOAuthCredentials(
  provider: string,
): Promise<OAuthCredentials | undefined> {
  const { store } = await resolveCredentialStore();
  const raw = await store.get(provider, 'oauth');
  if (raw === undefined || raw.length === 0) return undefined;
  try {
    return JSON.parse(raw) as OAuthCredentials;
  } catch {
    return undefined;
  }
}
