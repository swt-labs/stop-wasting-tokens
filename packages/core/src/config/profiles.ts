import type { SwtConfig } from './Config.js';

/**
 * Builtin profile identifiers. The schema field for the selected profile is
 * an open string in `ConfigSchema` so that user-saved profile ids from
 * `custom_profiles` are valid — strict narrowing to this 4-id union happens
 * at the UI / dropdown boundary (Phase 02-03).
 */
export type ProfileId = 'default' | 'turbo' | 'quality' | 'prototype';

/**
 * A builtin settings profile preset.
 *
 * `values` is typed as `Readonly<Partial<SwtConfig>>` so that every key MUST
 * exist in `SwtConfig` and every value MUST satisfy its field's type at
 * compile time. This is what makes the cross-schema invariant load-bearing.
 *
 * The `values` object describes only the field overrides this profile
 * applies; the selected-profile-id field is set separately by the Phase 03
 * `handleProfileSelect` handler (`stageProfileValues` in Plan 02-03).
 */
export interface Profile {
  readonly id: ProfileId;
  readonly name: string;
  readonly description: string;
  readonly values: Readonly<Partial<SwtConfig>>;
}

/**
 * Canonical display order for the 4 builtin profile ids. Consumed by the
 * Phase 02-03 `<For each={PROFILE_IDS}>` render loop in the ProfileDropdown.
 */
export const PROFILE_IDS: readonly ProfileId[] = [
  'default',
  'turbo',
  'quality',
  'prototype',
] as const;

/**
 * The 4 builtin profile presets. `as const` makes the record immutable at
 * the type level — no `Object.freeze` needed.
 *
 * Drift-locks (see Plan 02-01 deviations block):
 * - Turbo writes `prefer_teams: 'never'` — the brief's `'serialized'` is a
 *   confirmed typo not in the Phase 01-locked enum `['auto','always','never']`.
 * - The Default profile mirrors schema defaults verbatim — including
 *   `planning_tracking: 'manual'` (NOT the brief's `'ignore'`) so the
 *   profile's own label is honest.
 */
export const BUILTIN_PROFILES: Readonly<Record<ProfileId, Profile>> = {
  default: {
    id: 'default',
    name: 'Default',
    description: 'Schema defaults — balanced settings for general use',
    values: {
      effort: 'balanced',
      autonomy: 'standard',
      auto_commit: true,
      planning_tracking: 'manual',
      auto_push: 'never',
      verification_tier: 'standard',
      skill_suggestions: true,
      auto_install_skills: false,
      discovery_questions: true,
      discussion_mode: 'questions',
      context_compiler: true,
      visual_format: 'unicode',
      max_tasks_per_plan: 5,
      prefer_teams: 'auto',
      branch_per_milestone: false,
      model_profile: 'quality',
      qa_skip_agents: ['docs'],
      worktree_isolation: 'off',
      rolling_summary: false,
      require_phase_discussion: false,
      auto_uat: false,
      max_uat_remediation_rounds: false,
      caveman_style: 'none',
    },
  },
  turbo: {
    id: 'turbo',
    name: 'Turbo Mode',
    description: 'Maximum speed; minimize ceremony',
    values: {
      effort: 'turbo',
      autonomy: 'pure-vibe',
      verification_tier: 'quick',
      model_profile: 'cost',
      auto_commit: true,
      discovery_questions: false,
      require_phase_discussion: false,
      auto_uat: false,
      prefer_teams: 'never',
      context_compiler: true,
      rolling_summary: false,
    },
  },
  quality: {
    id: 'quality',
    name: 'High-quality',
    description: 'Maximum quality; accept slowness',
    values: {
      effort: 'thorough',
      autonomy: 'cautious',
      verification_tier: 'deep',
      model_profile: 'quality',
      auto_commit: false,
      discovery_questions: true,
      require_phase_discussion: true,
      auto_uat: false,
      prefer_teams: 'auto',
      context_compiler: true,
      rolling_summary: true,
    },
  },
  prototype: {
    id: 'prototype',
    name: 'Prototype',
    description: 'Fast iteration with light guardrails',
    values: {
      effort: 'fast',
      autonomy: 'confident',
      verification_tier: 'quick',
      model_profile: 'balanced',
      auto_commit: true,
      planning_tracking: 'ignore',
      discovery_questions: true,
      require_phase_discussion: false,
      auto_uat: false,
      prefer_teams: 'auto',
      context_compiler: true,
    },
  },
} as const;
