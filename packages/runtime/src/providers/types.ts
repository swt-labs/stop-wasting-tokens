/**
 * Provider-layer types for the v3 vendor-neutral provider abstraction.
 *
 * These types live in `runtime/` (Layer 1) because they describe how
 * runtime maps SWT's tier vocabulary to Pi's `ProviderModelConfig` /
 * `ThinkingLevel`. The methodology layer (Layer 3) speaks only `Role`
 * and `Tier`; the orchestration layer (Layer 2) hands off via
 * `AgentSpawner`; runtime resolves them into a concrete model + thinking
 * level + provider overrides.
 *
 * Per TDD2 §7.1.1 (the canonical SWT-tier → Pi-ThinkingLevel → provider-string
 * chain) and §7.5 (the quirks JSON shape).
 */

import type { ThinkingLevel } from '@swt-labs/shared';

/**
 * SWT capability tier — the methodology-facing vocabulary. v3 declines to
 * mention concrete model IDs at the methodology layer.
 *
 * - `cheap-fast`: small, cheap, fast models for Scout-style reads. Examples:
 *   claude-haiku-4-5, gpt-5-mini, gemini-2.5-flash, deepseek-v3.
 * - `balanced`: workhorse models for Lead/Dev/QA. Examples: claude-sonnet-4-6,
 *   gpt-5, gemini-2.5-pro.
 * - `quality`: maximum-quality models reserved for Architect / hard
 *   Debugger work. Examples: claude-opus-4-7, gpt-5-pro.
 * - `reasoning`: extended-thinking models for novel architectural decisions
 *   or deep debugging. Same physical models as `quality` typically but
 *   with the highest `ThinkingLevel` (`xhigh`).
 */
export type Tier = 'cheap-fast' | 'balanced' | 'quality' | 'reasoning';

export const TIERS: readonly Tier[] = ['cheap-fast', 'balanced', 'quality', 'reasoning'] as const;

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

/**
 * The 6 SDLC roles that perform actual model calls. `orchestrator` (in
 * `AgentRole` from `@swt-labs/shared`) is intentionally excluded — the
 * orchestrator dispatches; it doesn't prompt models itself.
 */
export type SDLCRole = 'scout' | 'architect' | 'lead' | 'dev' | 'qa' | 'debugger';

export const SDLC_ROLES: readonly SDLCRole[] = [
  'scout',
  'architect',
  'lead',
  'dev',
  'qa',
  'debugger',
] as const;

export function isSDLCRole(value: unknown): value is SDLCRole {
  return typeof value === 'string' && (SDLC_ROLES as readonly string[]).includes(value);
}

/** Re-export `ThinkingLevel` from shared for ergonomic provider-layer access. */
export type { ThinkingLevel };

/**
 * Per-role tier override. Set per project in `.swt-planning/config.json`
 * (under a future `roles[*].tier` field). The role-resolver falls back to
 * `DEFAULT_ROLE_TIERS` when not overridden.
 */
export type RoleTierMap = Partial<Record<SDLCRole, Tier>>;

/**
 * Per-provider, per-tier model map. v3 ships an illustrative default at
 * `runtime/src/providers/default-tiers.json`; future versions may
 * generate it at build time from Pi's provider registry.
 *
 * Schema is intentionally loose (`Record<string, string>`) so adding a
 * provider doesn't require a TS change — just a JSON entry.
 */
export type DefaultTierMap = Record<string, Record<Tier, string>>;

/**
 * Per-provider quirks. Keyed by provider id. Each provider has:
 * - `models[modelGlob]`: model-specific overrides
 * - `compat` (per-model): Pi's per-provider compatibility flags
 *   (`thinkingFormat`, `maxTokensField`, `supportsDeveloperRole`,
 *   `supportsReasoningEffort`, `supportsLongCacheRetention`)
 * - `thinkingLevelMap` (per-model): maps Pi `ThinkingLevel` values to
 *   provider-specific strings. **Keys are Pi ThinkingLevel values
 *   (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`), NOT SWT tier names.**
 *   This is the bug TDD2 originally had that the audit caught.
 */
export interface ProviderQuirk {
  readonly models?: Record<
    string,
    {
      readonly thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
      readonly compat?: {
        readonly thinkingFormat?: string;
        readonly maxTokensField?: string;
        readonly supportsDeveloperRole?: boolean;
        readonly supportsReasoningEffort?: boolean;
        readonly supportsLongCacheRetention?: boolean;
        readonly streamSimple?: boolean;
      };
    }
  >;
  readonly compat?: {
    readonly supportsLongCacheRetention?: boolean;
  };
}

export type ProviderQuirks = Record<string, ProviderQuirk>;
