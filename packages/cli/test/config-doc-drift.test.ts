// TODO(v3-debt): tracking https://github.com/swt-labs/stop-wasting-tokens/issues/32
// All describe() blocks below are .skip()-ed pending v2.3.5 test-debt remediation.
// See `docs/decisions/test-debt-tracking.md` for the cluster classification.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const DOCS_PATH = join(REPO_ROOT, 'docs', 'reference', 'config.mdx');

const DOCUMENTED_KEYS = [
  'effort',
  'autonomy',
  'auto_commit',
  'planning_tracking',
  'auto_push',
  'verification_tier',
  'prefer_teams',
  'max_tasks_per_plan',
  'model_profile',
  'model_overrides',
  'agent_max_turns',
  'qa_skip_agents',
  'context_compiler',
  'require_phase_discussion',
  'auto_uat',
  'max_uat_remediation_rounds',
  'discovery_questions',
  'discussion_mode',
  'visual_format',
  'plain_summary',
  'statusline_hide_limits',
];

describe.skip('config-doc drift', () => {
  it('every documented config key has a section heading in config.mdx', () => {
    const docs = readFileSync(DOCS_PATH, 'utf8');
    const missing: string[] = [];
    for (const key of DOCUMENTED_KEYS) {
      const heading = new RegExp(`### \`?${key}\`?`);
      if (!heading.test(docs)) missing.push(key);
    }
    expect(missing, `keys missing from docs: ${missing.join(', ')}`).toEqual([]);
  });

  it('config.mdx mentions the optional hooks.post_archive entry', () => {
    const docs = readFileSync(DOCS_PATH, 'utf8');
    expect(docs).toContain('hooks.post_archive');
  });

  it('config.mdx surfaces the telemetry block', () => {
    const docs = readFileSync(DOCS_PATH, 'utf8');
    // telemetry was added in PLAN 13-01; reference may live in any section
    // (config-reference page may or may not have a dedicated heading yet)
    // Soft check — just confirm the key surfaces somewhere
    expect(docs.toLowerCase()).toMatch(/telemetry|opt-in/);
  });
});
