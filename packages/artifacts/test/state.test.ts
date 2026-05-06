import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseState, readState, updateState } from '../src/state/updater.js';

const FIXTURE = `# State

**Project:** swt-test
**Milestone:** Phase 1 — Setup

## Current Phase
Phase: 1 of 3 (Setup)
Status: ready

## Todos
- one
- two

## Blockers
_(none)_

## Activity Log
- 2026-05-06: started
`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-state-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseState', () => {
  it('extracts project name and sections', () => {
    const parsed = parseState(FIXTURE);
    expect(parsed.project).toBe('swt-test');
    const headings = parsed.sections.map((s) => s.heading);
    expect(headings).toContain('Current Phase');
    expect(headings).toContain('Todos');
    expect(headings).toContain('Activity Log');
  });
});

describe('readState / updateState', () => {
  it('returns undefined when STATE.md is missing', async () => {
    const result = await readState(join(dir, 'STATE.md'));
    expect(result).toBeUndefined();
  });

  it('round-trips through updateState', async () => {
    const path = join(dir, 'STATE.md');
    await writeFile(path, FIXTURE, 'utf8');
    await updateState(path, (current) => {
      expect(current?.project).toBe('swt-test');
      return FIXTURE.replace('## Todos\n- one\n- two', '## Todos\n- one\n- two\n- three');
    });
    const after = await readFile(path, 'utf8');
    expect(after).toContain('- three');
  });
});
