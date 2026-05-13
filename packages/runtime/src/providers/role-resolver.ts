/**
 * Role → tier → model + thinking-level resolution.
 *
 * The methodology layer says: "spawn a Dev role." The role-resolver maps
 * that to a concrete provider + model + Pi `ThinkingLevel` per the
 * canonical chain in TDD2 §7.1.1:
 *
 *   SDLCRole (scout|architect|lead|dev|qa|debugger)
 *     ↓ resolveTierForRole()
 *   Tier (cheap-fast|balanced|quality|reasoning)
 *     ↓ resolveModelForRole()
 *   provider-specific model id (claude-haiku-4-5 | gpt-5 | …)
 *
 *   SDLCRole
 *     ↓ resolveThinkingLevelForRole()           [per-ROLE, not per-tier — §10.5]
 *   ThinkingLevel (off|minimal|low|medium|high|xhigh)
 *     ↓ provider quirks.json `thinkingLevelMap`
 *   provider-specific thinking-effort string (Anthropic "low"/"medium"/"high", OpenAI "minimal"/"low"/…, null = no thinking)
 *
 * Per-role (not per-tier) thinking-level matters because two roles with
 * the same tier (e.g., Architect and Dev both `quality`/`balanced`) can
 * want different thinking budgets — Architect leans into extended
 * thinking for design decisions; Dev is mostly tool-calling.
 */

import defaultTiersJson from './default-tiers.json' with { type: 'json' };
import type { DefaultTierMap, RoleTierMap, SDLCRole, ThinkingLevel, Tier } from './types.js';

/**
 * Default mapping from SDLC role to capability tier. Per TDD2 §10.2 (per-role
 * tier defaults). Project-level overrides go in `.swt-planning/config.json`
 * under `roles[*].tier`; the resolver merges those in via the `overrides.roleTier`
 * argument.
 */
export const DEFAULT_ROLE_TIERS: Required<RoleTierMap> = {
  scout: 'cheap-fast',
  architect: 'quality',
  lead: 'balanced',
  dev: 'balanced',
  qa: 'balanced',
  debugger: 'reasoning',
  // Plan 01-01 T02: docs agent maps to the same balanced tier as dev/lead.
  // Documentation tasks are mostly readable code + prose writing; no extended
  // thinking required.
  docs: 'balanced',
};

/**
 * Per-role thinking-level defaults. The "normal-case" map. Phase-specific
 * or context-aware overrides (e.g., Architect: high for a design-heavy
 * phase) come via the orchestrator's `TaskBrief` in M2+.
 *
 * Per TDD2 §10.5: per-ROLE, not per-tier. Architect (`quality`) and Dev
 * (`balanced`) both use real model power; only Architect wants extended
 * thinking by default. Debugger is the dedicated reasoning role.
 */
export const DEFAULT_ROLE_THINKING_LEVELS: Record<SDLCRole, ThinkingLevel> = {
  scout: 'off', // small, fast reads — no extended thinking
  architect: 'medium', // design decisions benefit from thinking
  lead: 'low', // mostly tool-calling + coordination
  dev: 'low', // bulk implementation; TaskBrief overrides for hard work
  qa: 'low', // static-check ladder first; LLM is `balanced` tier, thinking `low`
  debugger: 'xhigh', // root-cause diving; this is THE reasoning role
  // Plan 01-01 T02: docs writes prose + reads code; no extended thinking.
  docs: 'low',
};

// The JSON import via `with { type: 'json' }` returns an unknown-shaped object;
// cast through a typed alias to satisfy DefaultTierMap's shape contract.
// The `_comment` key in the JSON file is dropped at lookup time (we only access
// provider names).
const DEFAULT_TIERS: DefaultTierMap = defaultTiersJson as unknown as DefaultTierMap;

export function resolveTierForRole(role: SDLCRole, overrides?: RoleTierMap): Tier {
  return overrides?.[role] ?? DEFAULT_ROLE_TIERS[role];
}

export interface ResolveModelOverrides {
  readonly roleTier?: RoleTierMap;
  readonly tierModel?: DefaultTierMap;
}

export function resolveModelForRole(
  role: SDLCRole,
  provider: string,
  overrides?: ResolveModelOverrides,
): string {
  const tier = resolveTierForRole(role, overrides?.roleTier);
  const tierMap = overrides?.tierModel?.[provider] ?? DEFAULT_TIERS[provider];
  if (!tierMap || typeof tierMap !== 'object') {
    throw new Error(
      `resolveModelForRole: provider "${provider}" has no tier map. Known providers: ${Object.keys(
        DEFAULT_TIERS,
      )
        .filter((k) => k !== '_comment')
        .join(', ')}.`,
    );
  }
  const model = tierMap[tier];
  if (!model) {
    throw new Error(
      `resolveModelForRole: provider "${provider}" has no model for tier "${tier}". Known tiers for ${provider}: ${Object.keys(tierMap).join(', ')}.`,
    );
  }
  return model;
}

export function resolveThinkingLevelForRole(role: SDLCRole): ThinkingLevel {
  return DEFAULT_ROLE_THINKING_LEVELS[role];
}

/**
 * Helper: get the full default tier map (test seam; also useful for
 * dashboard panels that want to display "what model would dev get on
 * Anthropic vs OpenAI?" comparisons).
 */
export function getDefaultTierMap(): DefaultTierMap {
  // Return a shallow clone so callers can't mutate the canonical map.
  return JSON.parse(JSON.stringify(DEFAULT_TIERS)) as DefaultTierMap;
}
