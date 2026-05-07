import { describe, expect, it } from 'vitest';

import {
  RemediationPlanFrontmatterSchema,
  readRemediationPlanFrontmatter,
  writeRemediationPlanFrontmatter,
  type RemediationPlanFrontmatter,
} from '../../src/schemas/remediation-plan.js';
import {
  RemediationResearchFrontmatterSchema,
  readRemediationResearchFrontmatter,
  writeRemediationResearchFrontmatter,
} from '../../src/schemas/remediation-research.js';
import {
  RemediationSummaryFrontmatterSchema,
  readRemediationSummaryFrontmatter,
  writeRemediationSummaryFrontmatter,
  type RemediationSummaryFrontmatter,
} from '../../src/schemas/remediation-summary.js';

describe('RemediationPlanFrontmatterSchema', () => {
  it('parses fail_classifications and known_issues_input arrays', () => {
    const fm = RemediationPlanFrontmatterSchema.parse({
      phase: '03',
      round: '01',
      title: 'Round 1 fixes',
      tasks_total: 3,
      fail_classifications: [
        { id: 'AC2', type: 'code-fix', rationale: 'tests still fail' },
        {
          id: 'AC3',
          type: 'plan-amendment',
          rationale: 'changed approach',
          source_plan: '03-01-PLAN.md',
        },
      ],
      known_issues_input: ['{"test":"login","file":"auth.ts","error":"500"}'],
      known_issue_resolutions: [
        '{"test":"login","file":"auth.ts","error":"500","disposition":"resolved","rationale":"fixed redirect"}',
      ],
    });
    expect(fm.fail_classifications).toHaveLength(2);
    expect(fm.fail_classifications[1]?.source_plan).toBe('03-01-PLAN.md');
  });

  it('round-trips through write + read', () => {
    const fm: RemediationPlanFrontmatter = RemediationPlanFrontmatterSchema.parse({
      phase: '03',
      round: '02',
      title: 'Round 2',
      tasks_total: 1,
      fail_classifications: [
        { id: 'AC1', type: 'process-exception', rationale: 'historical batch commit' },
      ],
      known_issues_input: [],
      known_issue_resolutions: [],
    });
    const rendered = writeRemediationPlanFrontmatter(fm, 'body\n');
    const reparsed = readRemediationPlanFrontmatter(rendered);
    expect(reparsed.frontmatter).toEqual(fm);
  });
});

describe('RemediationSummaryFrontmatterSchema', () => {
  it('round-trips with known_issue_outcomes', () => {
    const fm: RemediationSummaryFrontmatter = RemediationSummaryFrontmatterSchema.parse({
      phase: '03',
      round: '01',
      title: 'Round 1 summary',
      status: 'complete',
      completed: '2026-05-06',
      tasks_completed: 3,
      tasks_total: 3,
      commit_hashes: ['abc1234'],
      files_modified: ['src/auth.ts'],
      deviations: [],
      known_issue_outcomes: [
        '{"test":"login","file":"auth.ts","error":"500","disposition":"resolved","rationale":"fixed"}',
      ],
    });
    const rendered = writeRemediationSummaryFrontmatter(fm, 'body\n');
    const reparsed = readRemediationSummaryFrontmatter(rendered);
    expect(reparsed.frontmatter.known_issue_outcomes).toHaveLength(1);
    expect(reparsed.frontmatter).toEqual(fm);
  });
});

describe('RemediationResearchFrontmatterSchema', () => {
  it('round-trips a remediation research doc', () => {
    const fm = RemediationResearchFrontmatterSchema.parse({
      phase: '03',
      round: '01',
      title: 'Why login fails',
      gathered: '2026-05-06',
      sources_consulted: ['auth.ts log lines 100-200'],
      files_referenced: ['src/auth.ts'],
      findings_summary: 'Redirect URL contains a stray slash that 500s on submit.',
      live_validation_required: true,
    });
    const rendered = writeRemediationResearchFrontmatter(fm, 'body\n');
    const reparsed = readRemediationResearchFrontmatter(rendered);
    expect(reparsed.frontmatter).toEqual(fm);
  });
});
