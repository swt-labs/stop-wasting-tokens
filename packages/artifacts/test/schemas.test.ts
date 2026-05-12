import { describe, expect, it } from 'vitest';

import { ProjectFrontmatterSchema } from '../src/schemas/project.js';
import { RequirementsFrontmatterSchema } from '../src/schemas/requirements.js';
import { PhaseEntrySchema, RoadmapSchema } from '../src/schemas/roadmap.js';
import { StateSchema } from '../src/schemas/state.js';

describe('artefact schemas', () => {
  it('project frontmatter accepts a minimal shape', () => {
    expect(() =>
      ProjectFrontmatterSchema.parse({ name: 'swt', core_value: 'Token discipline' }),
    ).not.toThrow();
  });

  it('requirements parse with an empty list', () => {
    expect(() => RequirementsFrontmatterSchema.parse({ defined: '2026-05-06' })).not.toThrow();
  });

  it('phase entry rejects an invalid position', () => {
    expect(() =>
      PhaseEntrySchema.parse({
        position: '1',
        slug: 'foo',
        name: 'Foo',
        goal: 'do foo',
      }),
    ).toThrow();
  });

  it('phase entry accepts the canonical shape and applies defaults', () => {
    const entry = PhaseEntrySchema.parse({
      position: '01',
      slug: 'foundation',
      name: 'Foundation',
      goal: 'Set up workspace',
    });
    expect(entry.requirements).toEqual([]);
    expect(entry.success_criteria).toEqual([]);
    expect(entry.status).toBe('pending');
  });

  it('roadmap accepts an empty phases array (post-bootstrap, pre-scope)', () => {
    // M2 PR-15: relaxed from `.min(1)` to `.min(0)` so the bootstrap handler
    // can write a valid ROADMAP.md before any phases are scoped. Scope mode
    // adds phases; the schema permits the in-between state.
    const parsed = RoadmapSchema.parse({ project_name: 'swt', phases: [] });
    expect(parsed.phases).toEqual([]);
  });

  it('state schema preserves unknown keys via passthrough', () => {
    const parsed = StateSchema.parse({
      project: 'swt',
      milestone: 'mvp',
      todos: [],
      blockers: [],
      activity_log: [],
      extra_field: 'kept',
    });
    expect((parsed as unknown as { extra_field: string }).extra_field).toBe('kept');
  });
});
