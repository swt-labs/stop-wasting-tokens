import { describe, expect, it } from 'vitest';

import {
  parseMilestoneContext,
  parsePhaseContext,
  renderMilestoneContext,
  renderPhaseContext,
  type MilestoneContextDoc,
  type PhaseContextDoc,
} from '../../src/schemas/context.js';

describe('PhaseContext schema', () => {
  it('round-trips a phase context with notes/decisions/deferred', () => {
    const doc: PhaseContextDoc = {
      frontmatter: {
        phase: '03',
        slug: 'core-abstractions',
        name: 'Core Abstractions',
        goal: 'Define HookHost / AgentSpawner / PermissionGate / MemoryStore.',
        requirements: ['REQ-02'],
        success_criteria: ['All four interfaces have Zod schemas + tests'],
        pre_seeded: false,
      },
      notes: 'Prefer minimal surface area; defer hook event taxonomy to PLAN 02.',
      decisions: 'AgentSpawner receives an AgentSpec — no role-keyed registry.',
      deferred_ideas: 'Hook deduplication / debouncing.',
    };
    const rendered = renderPhaseContext(doc);
    const reparsed = parsePhaseContext(rendered);
    expect(reparsed.frontmatter).toEqual(doc.frontmatter);
    expect(reparsed.notes).toBe(doc.notes);
    expect(reparsed.decisions).toBe(doc.decisions);
    expect(reparsed.deferred_ideas).toBe(doc.deferred_ideas);
  });

  it('honors pre_seeded=true (remediation phase)', () => {
    const doc: PhaseContextDoc = {
      frontmatter: {
        phase: '11',
        slug: 'remediation-login',
        name: 'Remediation: login',
        goal: 'Fix login regression.',
        requirements: [],
        success_criteria: [],
        pre_seeded: true,
      },
      notes: '',
      decisions: '',
      deferred_ideas: '',
    };
    const rendered = renderPhaseContext(doc);
    expect(rendered).toContain('pre_seeded: true');
    const reparsed = parsePhaseContext(rendered);
    expect(reparsed.frontmatter.pre_seeded).toBe(true);
  });
});

describe('MilestoneContext schema', () => {
  it('round-trips with all six body sections', () => {
    const doc: MilestoneContextDoc = {
      frontmatter: {
        milestone_name: 'mvp',
        gathered: '2026-05-06',
        calibration: 'architect',
      },
      scope_boundary: 'Bootstrap-through-archive lifecycle.',
      decomposition_decisions: 'Two phases: setup, foundation.',
      scope_coverage: 'In: monorepo + CI. Out: docs site.',
      requirement_mapping: 'Phase 01: REQ-01. Phase 02: REQ-02.',
      key_decisions: 'TS + pnpm + tsup.',
      deferred_ideas: 'plugin marketplace.',
    };
    const rendered = renderMilestoneContext(doc);
    expect(rendered).toContain('## Decomposition Decisions');
    expect(rendered).toContain('### Scope Coverage');
    const reparsed = parseMilestoneContext(rendered);
    expect(reparsed.frontmatter).toEqual(doc.frontmatter);
    expect(reparsed.scope_boundary).toBe(doc.scope_boundary);
    expect(reparsed.scope_coverage).toBe(doc.scope_coverage);
    expect(reparsed.key_decisions).toBe(doc.key_decisions);
  });
});
