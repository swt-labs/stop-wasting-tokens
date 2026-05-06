import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  writeMilestoneContext,
  writePhaseContext,
  writeProject,
  writeRequirements,
  writeRoadmap,
  writeState,
} from '../../src/bootstrap/index.js';
import { EMPTY_DISCOVERY } from '../../src/bootstrap/discovery.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-bootstrap-'));
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeProject', () => {
  it('emits a PROJECT.md with name, description, core_value', async () => {
    const path = await writeProject({
      planningDir: dir,
      name: 'swt',
      description: 'Token-disciplined SDLC',
      core_value: 'Stop wasting tokens',
    });
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('# swt');
    expect(raw).toContain('Token-disciplined SDLC');
    expect(raw).toContain('**Core value:** Stop wasting tokens');
    expect(raw).toContain('## Requirements');
    expect(raw).toContain('## Constraints');
    expect(raw).toContain('## Key Decisions');
  });

  it('falls back to description when core_value is omitted', async () => {
    const path = await writeProject({ planningDir: dir, name: 'x', description: 'hello' });
    expect(await readFile(path, 'utf8')).toContain('**Core value:** hello');
  });
});

describe('writeRequirements', () => {
  it('numbers REQ-IDs from the answered + inferred lists', async () => {
    const path = await writeRequirements({
      planningDir: dir,
      project_name: 'swt',
      core_value: 'discipline',
      discovery: {
        answered: ['Cross-platform', 'TypeScript only'],
        inferred: [{ text: 'CI matrix', priority: 'must-have' }],
        deferred: ['Multi-tenant'],
      },
      defined: '2026-05-06',
    });
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('Defined: 2026-05-06');
    expect(raw).toContain('REQ-01');
    expect(raw).toContain('Cross-platform');
    expect(raw).toContain('TypeScript only');
    expect(raw).toContain('CI matrix');
    expect(raw).toContain('Multi-tenant');
  });

  it('writes a no-requirements placeholder when discovery is empty', async () => {
    const path = await writeRequirements({
      planningDir: dir,
      project_name: 'swt',
      core_value: 'x',
      discovery: EMPTY_DISCOVERY,
    });
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('_(none captured yet — run `swt vibe` to discuss)_');
  });
});

describe('writeRoadmap', () => {
  it('emits a roadmap with progress table and per-phase sections', async () => {
    const path = await writeRoadmap({
      planningDir: dir,
      project_name: 'swt',
      goal: 'ship',
      phases: [
        {
          position: '01',
          slug: 'setup',
          name: 'Setup',
          goal: 'Stand up the workspace',
          requirements: ['REQ-01'],
          success_criteria: ['CI green'],
          status: 'pending',
        },
        {
          position: '02',
          slug: 'foundation',
          name: 'Foundation',
          goal: 'Compile + test',
          requirements: [],
          success_criteria: [],
          status: 'pending',
        },
      ],
    });
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('# swt Roadmap');
    expect(raw).toContain('| 01 | Pending | 0 | 0 | 0 |');
    expect(raw).toContain('| 02 | Pending | 0 | 0 | 0 |');
    expect(raw).toContain('## Phase 1: Setup');
    expect(raw).toContain('**Requirements:** REQ-01');
    expect(raw).toContain('## Phase 2: Foundation');
  });
});

describe('writeState', () => {
  it('writes a fresh STATE.md with phase_count rendered', async () => {
    const path = await writeState({
      planningDir: dir,
      project_name: 'swt',
      milestone_name: 'mvp',
      phase_count: 3,
      date: '2026-05-06',
    });
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('**Project:** swt');
    expect(raw).toContain('**Milestone:** mvp');
    expect(raw).toContain('Phase: 1 of 3');
    expect(raw).toContain('- **Phase 1:** Pending');
    expect(raw).toContain('- **Phase 3:** Pending');
    expect(raw).toContain('- 2026-05-06: Project bootstrapped');
  });

  it('handles phase_count=0 gracefully', async () => {
    const path = await writeState({
      planningDir: dir,
      project_name: 'swt',
      phase_count: 0,
      date: '2026-05-06',
    });
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('Phase: 0 of 0');
    expect(raw).toContain('_(no phases yet');
  });
});

describe('writePhaseContext + writeMilestoneContext', () => {
  it('writes a per-phase CONTEXT.md with frontmatter + Goal', async () => {
    await mkdir(join(dir, 'phases', '01-setup'), { recursive: true });
    const path = await writePhaseContext({
      planningDir: dir,
      position: '01',
      slug: 'setup',
      name: 'Setup',
      goal: 'Stand up the workspace',
      gathered: '2026-05-06',
    });
    const raw = await readFile(path, 'utf8');
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain('phase: "01"');
    expect(raw).toContain('gathered: "2026-05-06"');
    expect(raw).toContain('# Phase 1: Setup');
    expect(raw).toContain('**Goal:** Stand up the workspace');
  });

  it('writes a milestone CONTEXT.md with scope + decomposition + mapping', async () => {
    const path = await writeMilestoneContext({
      planningDir: dir,
      milestone_name: 'mvp',
      scope_boundary: 'Cover bootstrap-through-archive',
      decomposition_rationale: 'Two-phase split: setup vs. foundation',
      requirement_mapping: [
        { phase: '01', reqs: ['REQ-01'] },
        { phase: '02', reqs: ['REQ-02', 'REQ-03'] },
      ],
      key_decisions: [{ decision: 'pnpm workspaces', rationale: 'cross-platform' }],
      deferred_ideas: ['multi-backend driver'],
      gathered: '2026-05-06',
    });
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('# mvp');
    expect(raw).toContain('**Gathered:** 2026-05-06');
    expect(raw).toContain('Cover bootstrap-through-archive');
    expect(raw).toContain('Two-phase split');
    expect(raw).toContain('Phase 01: REQ-01');
    expect(raw).toContain('**pnpm workspaces** — cross-platform');
    expect(raw).toContain('multi-backend driver');
  });
});
