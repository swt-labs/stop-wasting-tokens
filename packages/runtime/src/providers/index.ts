/**
 * Public surface for the provider layer (runtime → Pi adapter side).
 *
 * Consumers (orchestration's PiSpawnerEnvironment, methodology's spawn
 * request builders, dashboard's per-provider cost panel) import resolver
 * helpers and shape types from here. The raw JSON files (quirks.json,
 * default-tiers.json) are intentionally NOT re-exported as values — they
 * are read through the resolver functions so future migrations (build-time
 * generation, dynamic provider catalogue loading) keep the same surface.
 */

export {
  resolveModelForRole,
  resolveTierForRole,
  resolveThinkingLevelForRole,
  getDefaultTierMap,
  DEFAULT_ROLE_TIERS,
  DEFAULT_ROLE_THINKING_LEVELS,
  type ResolveModelOverrides,
} from './role-resolver.js';
export {
  TIERS,
  SDLC_ROLES,
  isTier,
  isSDLCRole,
  type Tier,
  type SDLCRole,
  type ThinkingLevel,
  type RoleTierMap,
  type DefaultTierMap,
  type ProviderQuirk,
  type ProviderQuirks,
} from './types.js';
