/**
 * Provider-tuning-pack registry — Phase 17 plan 01-01 Task 3.
 *
 * Singleton resolver: `getProviderTuningPack(providerId, installRoot)` returns
 * a cached `ProviderTuningPack` instance keyed by `(providerId, installRoot)`.
 * The cache means tests and production share pack instances within a process
 * for any (id, root) pair they've previously resolved — packs are stateless
 * apart from their `installRoot`, so caching is safe.
 *
 * Mappings:
 *   - 'openai'                       → CodexViaOverlayPack
 *   - 'anthropic' | unknown | undef  → AnthropicViaPiPack
 *
 * Unknown providers fall through to `AnthropicViaPiPack` (the most no-op
 * pack) so a previously-unmapped provider id (e.g. an experimental Bedrock
 * config, or `undefined` from a non-router caller) preserves the current
 * behavior (no overlay, no `apply_patch`). This matches the pre-refactor
 * shape: `readProviderOverlay(installRoot, role, undefined)` returns
 * `undefined`, and the `includeApplyPatch` check was strictly
 * `opts.provider === 'openai'`.
 */

import type { ProviderTuningPack } from '../provider-tuning-pack.js';

import { AnthropicViaPiPack } from './anthropic-via-pi.js';
import { CodexViaOverlayPack } from './codex-via-overlay.js';

const CACHE = new Map<string, ProviderTuningPack>();

/**
 * Returns the pack for `(providerId, installRoot)`. Caches per-tuple so
 * repeated lookups within a process share instances.
 */
export function getProviderTuningPack(
  providerId: string | undefined,
  installRoot: string,
): ProviderTuningPack {
  const key = `${providerId ?? 'anthropic'}|${installRoot}`;
  const cached = CACHE.get(key);
  if (cached !== undefined) return cached;

  let pack: ProviderTuningPack;
  switch (providerId) {
    case 'openai':
      pack = new CodexViaOverlayPack(installRoot);
      break;
    case 'anthropic':
    default:
      // Unknown / undefined providerId → fall through to the most no-op
      // pack so wire-level behavior matches pre-refactor for any provider
      // id the registry doesn't recognize.
      pack = new AnthropicViaPiPack(installRoot);
      break;
  }
  CACHE.set(key, pack);
  return pack;
}

/**
 * Returns the full list of known provider tuning packs, sharing the
 * same per-(providerId, installRoot) cache as getProviderTuningPack().
 * Order is deterministic: anthropic, openai. New packs are added here
 * AND in getProviderTuningPack()'s switch — keep the two surfaces in
 * sync (one-place change is "add to the switch + add to the array").
 *
 * Used by `swt provider-tuning-sources` to enumerate all packs at the
 * CLI layer without leaking the provider id list outside L3.
 */
export function getAllPacks(installRoot: string): readonly ProviderTuningPack[] {
  return Object.freeze([
    getProviderTuningPack('anthropic', installRoot),
    getProviderTuningPack('openai', installRoot),
  ]);
}

/**
 * Test-only — clears the pack cache. Use in test `beforeEach` hooks if you
 * need to assert against a fresh pack instance per test case. Production
 * code MUST NOT call this; the cache is benign for a single process and
 * resetting it can cause hard-to-debug identity surprises.
 */
export function _resetProviderTuningPackRegistry(): void {
  CACHE.clear();
}
