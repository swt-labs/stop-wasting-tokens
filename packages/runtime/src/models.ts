/**
 * Pi `ModelRegistry` → SWT `ModelInfo[]` projection.
 *
 * Exposed at the runtime layer (not dashboard) because per the Phase 1
 * Principle-1 invariant, only `@swt-labs/runtime` is allowed to
 * value-level-import `@earendil-works/pi-coding-agent`. The dashboard
 * server's `GET /api/models` route delegates here.
 *
 * Pi's registry is essentially a typed wrapper over a static list of
 * providers + models (built-in + per-config overrides). A fresh in-memory
 * `AuthStorage` is fine here — `getAll()` returns the registry's models
 * regardless of auth state (that's `getAvailable()`'s job). Metadata-only
 * shape: no secrets, no auth status.
 */

import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

export interface ModelInfo {
  /** Canonical model id (matches `config.model` writes). */
  readonly id: string;
  /** Owning provider id ('anthropic', 'openai', etc.). */
  readonly provider: string;
  /** Human display name when richer than the id alone, or null. */
  readonly name: string | null;
  /** Pi `contextWindow` token budget (0 when Pi doesn't carry it). */
  readonly contextWindow: number;
  /** True for reasoning/extended-thinking models. */
  readonly reasoning: boolean;
}

/**
 * List every model Pi's registry knows about. Built-in entries only when
 * called without a config — load custom-provider entries by passing the
 * project's `.swt-planning/config.json` path. alpha.35 keeps it simple
 * with the in-memory variant; the route can switch to
 * `ModelRegistry.create(authStorage, configPath)` later if per-project
 * custom providers need to surface in the dropdown.
 */
export function listAllModels(): ModelInfo[] {
  // AuthStorage constructor is private — use the static `inMemory()`
  // factory (Pi 0.74 auth-storage.d.ts:58). Empty data is fine here:
  // ModelRegistry.getAll() doesn't filter on auth state.
  const authStorage = AuthStorage.inMemory();
  const registry = ModelRegistry.inMemory(authStorage);
  return registry.getAll().map((m) => ({
    id: m.id,
    provider: m.provider,
    name: m.name ?? null,
    contextWindow: m.contextWindow ?? 0,
    reasoning: m.reasoning ?? false,
  }));
}
