/**
 * The single hand-curated source for the SettingsTable's Description column.
 * Brief Locked Decision #9 (Option2.md §B): hardcoded map rather than Zod
 * docstring introspection — lets descriptions diverge from internal docs and
 * keeps the dashboard's rendering path simple.
 *
 * Display order is hardcoded separately by SETTINGS_DISPLAY_ORDER (Brief
 * Locked Decision #10). A regression test in settings-table.test.ts asserts
 * one-to-one between the two: every key in the order array has a description
 * entry AND every description key is in the order array.
 *
 * Scope: 24 user-facing fields (mirrors the brief's screenshot exactly).
 * `backend` is INTENTIONALLY EXCLUDED — not user-facing in this context
 * (Scout RESEARCH.md §5 + the brief's screenshot which omits it). The
 * pre-existing `backend` enum drift in `CONFIG_ENUM_OPTIONS` is carried
 * forward unchanged; the SettingsTable simply never renders a row for it.
 */
export const SETTING_DESCRIPTIONS: Readonly<Record<string, string>> = {
  effort: 'Planning + verification depth',
  autonomy: 'Phase-by-phase confirmation',
  auto_commit: 'Auto-commit Execute tasks',
  planning_tracking: '.vbw-planning/ out of git',
  auto_push: 'Never auto-push',
  verification_tier: 'QA verification depth',
  skill_suggestions: 'Suggest skills during work',
  auto_install_skills: 'Skills require approval',
  discovery_questions: 'Ask during bootstrap',
  discussion_mode: 'Discuss vs assumptions mode',
  context_compiler: 'Pre-compile agent contexts',
  visual_format: 'Banner glyph set',
  max_tasks_per_plan: 'Plan task budget',
  prefer_teams: 'Team vs serialized routing',
  branch_per_milestone: 'Work directly on main',
  active_profile: 'Settings profile name',
  model_profile: 'Agent model preset',
  qa_skip_agents: 'QA skips these roles',
  worktree_isolation: 'No agent worktrees',
  rolling_summary: 'No rolling milestone summary',
  require_phase_discussion: 'Discussion optional',
  auto_uat: 'UAT manual gate',
  max_uat_remediation_rounds: 'Unlimited rounds',
  caveman_style: 'No caveman commits/reviews',
};

/**
 * Settings table row order — matches the brief screenshot (Option2.md
 * §"Settings table rows" lines 67-90). Adding a new field requires updating
 * BOTH this array AND SETTING_DESCRIPTIONS. A regression test asserts the
 * two stay one-to-one.
 */
export const SETTINGS_DISPLAY_ORDER: ReadonlyArray<string> = [
  'effort',
  'autonomy',
  'auto_commit',
  'planning_tracking',
  'auto_push',
  'verification_tier',
  'skill_suggestions',
  'auto_install_skills',
  'discovery_questions',
  'discussion_mode',
  'context_compiler',
  'visual_format',
  'max_tasks_per_plan',
  'prefer_teams',
  'branch_per_milestone',
  'active_profile',
  'model_profile',
  'qa_skip_agents',
  'worktree_isolation',
  'rolling_summary',
  'require_phase_discussion',
  'auto_uat',
  'max_uat_remediation_rounds',
  'caveman_style',
];
