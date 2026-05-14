/**
 * The SINGLE client-side mirror of the per-project config enum vocabularies.
 * Extracted from ConfigPanel.tsx (v2.3 Phase 03) so ConfigPanel's raw-tree
 * editor AND the Options dropdown's SettingsSection share ONE source — no
 * second copy that can drift (Dashboard Options Menu milestone, research §3
 * fact 5 / R3).
 *
 * Source of truth: packages/core/src/types/effort.ts, autonomy.ts,
 * verification.ts, plus the inline enums in packages/core/src/config/Config.ts
 * (model_profile, backend, prefer_teams, worktree_isolation, planning_tracking,
 * auto_push). Hand-mirrored — same precedent as command-registry-mirror.ts /
 * allowed-verbs.ts (the dashboard ships standalone, no @swt-labs/core runtime
 * dep for these enum lists). Sync when those move.
 */
export const CONFIG_ENUM_OPTIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  effort: ['thorough', 'balanced', 'fast', 'turbo'],
  autonomy: ['cautious', 'standard', 'confident', 'pure-vibe'],
  verification_tier: ['quick', 'standard', 'deep'],
  model_profile: ['quality', 'balanced', 'cost'],
  backend: ['codex', 'claude-code', 'ollama'],
  prefer_teams: ['auto', 'always', 'never'],
  worktree_isolation: ['off', 'on', 'auto'],
  planning_tracking: ['manual', 'ignore', 'commit'],
  auto_push: ['never', 'after_phase', 'always'],
};

/**
 * The exact enum fields the Options dropdown's SettingsSection renders as
 * segmented controls, in display order. `backend` is intentionally EXCLUDED
 * (research §2.3 — single-value / display-only); ConfigPanel still shows it
 * in its raw tree via CONFIG_ENUM_OPTIONS.
 */
export const SETTINGS_FIELD_ORDER: ReadonlyArray<string> = [
  'effort',
  'autonomy',
  'verification_tier',
  'model_profile',
  'prefer_teams',
  'worktree_isolation',
  'planning_tracking',
  'auto_push',
];

/** Boolean config fields the SettingsSection renders as a toggle. */
export const SETTINGS_BOOLEAN_FIELDS: ReadonlyArray<string> = ['auto_uat'];
