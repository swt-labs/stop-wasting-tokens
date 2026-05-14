/**
 * Phase 1 — Keychain Credential Adapter: the `swt:<provider>:<authMode>`
 * namespace codec.
 *
 * Two pure functions plus a constant map `(provider, authMode)` <-> the
 * keychain `account` string. The full namespace is `swt:<provider>:<authMode>`:
 * `service = 'swt'` (the {@link SWT_KEYCHAIN_SERVICE} constant) is the fixed
 * other half, and `account = '<provider>:<authMode>'` is what
 * {@link encodeAccount} produces. (Research §6 — keychain entry naming.)
 *
 * Collision-safe by construction:
 *  - {@link encodeAccount} throws if `provider` contains a `:` — a `:` in the
 *    provider id would make {@link decodeAccount} ambiguous.
 *  - {@link decodeAccount} throws on a malformed account (no `:`, empty
 *    provider, unknown authMode) so a corrupt keychain entry surfaces loudly
 *    rather than silently mis-decoding.
 *
 * Both functions are deterministic — no clock / random / env / IO reads.
 */

import type { AuthMode, CredentialRef } from './types.js';

/**
 * The keychain `service` value for every SWT credential entry. The full
 * namespace is `swt:<provider>:<authMode>` — `service='swt'`, and the
 * `account` half is `<provider>:<authMode>` (see {@link encodeAccount}).
 * Research §6.
 */
export const SWT_KEYCHAIN_SERVICE = 'swt';

/**
 * The closed set of valid {@link AuthMode} values, used by
 * {@link decodeAccount} to validate the right half of an account string.
 * Kept in sync with the `AuthMode` union in `./types.ts`.
 */
const KNOWN_AUTH_MODES: readonly AuthMode[] = ['api_key', 'oauth'];

/**
 * Encode `(provider, authMode)` -> the keychain `account` string
 * `'<provider>:<authMode>'`.
 *
 * @throws {Error} if `provider` is empty or whitespace-only.
 * @throws {Error} if `provider` contains a `:` — a `:` in the provider id
 *   would make {@link decodeAccount} ambiguous (collision prevention).
 */
export function encodeAccount(provider: string, authMode: AuthMode): string {
  if (provider.trim().length === 0) {
    throw new Error('encodeAccount: provider must be a non-empty string.');
  }
  if (provider.includes(':')) {
    throw new Error(
      `encodeAccount: provider must not contain ':' (got "${provider}") — ` +
        'it would make the namespace key ambiguous to decode.',
    );
  }
  return `${provider}:${authMode}`;
}

/**
 * Decode a keychain `account` string -> {@link CredentialRef}. Splits on the
 * FIRST `:` so a provider id never bleeds into the authMode half.
 *
 * @throws {Error} on a malformed account (no `:`, empty provider, or an
 *   unknown authMode) — a corrupt keychain entry surfaces loudly rather than
 *   mis-decoding silently.
 */
export function decodeAccount(account: string): CredentialRef {
  const idx = account.indexOf(':');
  if (idx === -1) {
    throw new Error(
      `decodeAccount: malformed account "${account}" — expected "<provider>:<authMode>".`,
    );
  }
  const provider = account.slice(0, idx);
  const rawMode = account.slice(idx + 1);
  if (provider.length === 0) {
    throw new Error(`decodeAccount: malformed account "${account}" — empty provider.`);
  }
  if (!KNOWN_AUTH_MODES.includes(rawMode as AuthMode)) {
    throw new Error(
      `decodeAccount: unknown authMode "${rawMode}" in account "${account}" ` +
        `(expected one of ${KNOWN_AUTH_MODES.join(', ')}).`,
    );
  }
  return { provider, authMode: rawMode as AuthMode };
}
