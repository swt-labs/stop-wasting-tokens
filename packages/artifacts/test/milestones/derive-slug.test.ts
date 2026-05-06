import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deriveMilestoneSlug } from '../../src/milestones/derive-slug.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-derive-slug-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('deriveMilestoneSlug', () => {
  it('builds a numbered kebab slug from roadmap phase headings', async () => {
    await writeFile(
      join(dir, 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '## Phase 1: Setup API Layer',
        'Goal: bootstrap',
        '',
        '## Phase 2: Build Core Engine',
        'Goal: orchestration',
        '',
      ].join('\n'),
      'utf8',
    );
    const slug = await deriveMilestoneSlug({ planningDir: dir, today: () => '2026-05-06' });
    expect(slug).toBe('01-setup-api-layer-build-core-engine');
  });

  it('falls back to milestone-{date} when no phases are present', async () => {
    await writeFile(join(dir, 'ROADMAP.md'), '# Roadmap\n\n_(no phases)_\n', 'utf8');
    const slug = await deriveMilestoneSlug({ planningDir: dir, today: () => '2026-05-06' });
    expect(slug).toBe('milestone-2026-05-06');
  });

  it('falls back to milestone-{date} when ROADMAP.md is missing', async () => {
    const slug = await deriveMilestoneSlug({ planningDir: dir, today: () => '2026-05-06' });
    expect(slug).toBe('milestone-2026-05-06');
  });

  it('increments the milestone index across existing milestone dirs', async () => {
    await writeFile(
      join(dir, 'ROADMAP.md'),
      ['# Roadmap', '', '## Phase 1: New Work', 'Goal: x', ''].join('\n'),
      'utf8',
    );
    await mkdir(join(dir, 'milestones', '01-old-work'), { recursive: true });
    await mkdir(join(dir, 'milestones', '02-older-work'), { recursive: true });
    const slug = await deriveMilestoneSlug({ planningDir: dir, today: () => '2026-05-06' });
    expect(slug.startsWith('03-')).toBe(true);
  });
});
