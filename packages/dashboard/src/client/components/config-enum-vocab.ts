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
 * auto_push, discussion_mode, visual_format, caveman_style). Hand-mirrored —
 * same precedent as command-registry-mirror.ts / allowed-verbs.ts (the
 * dashboard ships standalone, no @swt-labs/core runtime dep for these enum
 * lists). Sync when those move.
 *
 * Phase 02 plan 02-02 extends this mirror with the 3 new enum vocabularies
 * (discussion_mode / visual_format / caveman_style), expands
 * SETTINGS_BOOLEAN_FIELDS from 1 → 9 entries, and adds two new exports
 * (SETTINGS_NUMBER_FIELDS / SETTINGS_ARRAY_FIELDS) that drive
 * SettingsValueControl's type-dispatch.
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
  discussion_mode: ['questions', 'assumptions', 'auto'],
  visual_format: ['unicode', 'ascii'],
  caveman_style: ['none', 'aggressive', 'extreme'],
};

/**
 * Boolean config fields the SettingsValueControl renders as an on/off
 * toggle. Phase 02 plan 02-02 expanded this from `['auto_uat']` to the
 * full 9-entry list mirroring every boolean field in Phase 01's settings-v2
 * schema additions (Config.ts). Order matters only for cosmetic stability
 * — `inferControlType` does a `.includes(key)` membership test.
 */
export const SETTINGS_BOOLEAN_FIELDS: ReadonlyArray<string> = [
  'auto_uat',
  'auto_commit',
  'skill_suggestions',
  'auto_install_skills',
  'discovery_questions',
  'context_compiler',
  'branch_per_milestone',
  'rolling_summary',
  'require_phase_discussion',
];

/** Numeric config fields the SettingsValueControl renders as a number input. */
export const SETTINGS_NUMBER_FIELDS: ReadonlyArray<string> = ['max_tasks_per_plan'];

/**
 * Array (`string[]`) config fields the SettingsValueControl renders as a
 * comma-separated text input (Phase 02 v1; Phase 03 may upgrade to a chip
 * picker).
 */
export const SETTINGS_ARRAY_FIELDS: ReadonlyArray<string> = ['qa_skip_agents'];
