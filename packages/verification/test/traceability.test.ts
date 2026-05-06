import { describe, expect, it } from 'vitest';

import { checkTraceability } from '../src/traceability.js';

describe('checkTraceability', () => {
  it('reports a clean state when everything maps', () => {
    const report = checkTraceability({
      requirements: ['REQ-01', 'REQ-02'],
      plans: [
        { phase: '01', plan: '01', requirements: ['REQ-01'], must_haves: ['m'] },
        { phase: '02', plan: '01', requirements: ['REQ-02'], must_haves: ['m'] },
      ],
      summaries: [
        { phase: '01', plan: '01', status: 'complete' },
        { phase: '02', plan: '01', status: 'complete' },
      ],
    });
    expect(report.ok).toBe(true);
  });

  it('flags requirements that no plan references', () => {
    const report = checkTraceability({
      requirements: ['REQ-01', 'REQ-02', 'REQ-03'],
      plans: [{ phase: '01', plan: '01', requirements: ['REQ-01'], must_haves: ['m'] }],
      summaries: [{ phase: '01', plan: '01', status: 'complete' }],
    });
    expect(report.ok).toBe(false);
    expect(report.unmapped_requirements).toEqual(['REQ-02', 'REQ-03']);
  });

  it('flags plans that reference unknown requirements', () => {
    const report = checkTraceability({
      requirements: ['REQ-01'],
      plans: [{ phase: '01', plan: '01', requirements: ['REQ-99'], must_haves: ['m'] }],
      summaries: [{ phase: '01', plan: '01', status: 'complete' }],
    });
    expect(report.dangling_requirement_refs).toEqual([
      { phase: '01', plan: '01', reference: 'REQ-99' },
    ]);
  });

  it('flags plans without a SUMMARY', () => {
    const report = checkTraceability({
      requirements: [],
      plans: [{ phase: '03', plan: '01', requirements: [], must_haves: ['m'] }],
      summaries: [],
    });
    expect(report.plans_without_summary).toEqual(['03-01']);
  });

  it('flags summaries for unknown plans', () => {
    const report = checkTraceability({
      requirements: [],
      plans: [],
      summaries: [{ phase: '07', plan: '01', status: 'complete' }],
    });
    expect(report.summaries_for_unknown_plans).toEqual(['07-01']);
  });
});
