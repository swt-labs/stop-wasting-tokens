import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addIssue,
  deferIssue,
  readKnownIssues,
  resolveIssue,
  writeKnownIssues,
  type KnownIssue,
} from '../../src/qa/known-issues.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-known-issues-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('known-issues lifecycle', () => {
  it('returns empty array when file is missing', async () => {
    expect(await readKnownIssues(dir)).toEqual([]);
  });

  it('round-trips through write + read', async () => {
    const issue: KnownIssue = {
      id: 'KI-01-AC2',
      severity: 'major',
      summary: 'CODE_OF_CONDUCT.md missing',
      opened_at: '2026-05-06',
      status: 'open',
    };
    await writeKnownIssues(dir, [issue]);
    const raw = await readFile(join(dir, 'known-issues.json'), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ version: 1, issues: [issue] });
    expect(await readKnownIssues(dir)).toEqual([issue]);
  });

  it('addIssue, resolveIssue, deferIssue mutate the list correctly', async () => {
    const a: KnownIssue = {
      id: 'KI-A',
      severity: 'minor',
      summary: 'A',
      opened_at: '2026-05-06',
      status: 'open',
    };
    const b: KnownIssue = {
      id: 'KI-B',
      severity: 'major',
      summary: 'B',
      opened_at: '2026-05-06',
      status: 'open',
    };
    let issues = addIssue([], a);
    issues = addIssue(issues, b);
    expect(issues).toHaveLength(2);

    issues = resolveIssue(issues, 'KI-A', 1);
    expect(issues.find((i) => i.id === 'KI-A')?.status).toBe('resolved');
    expect(issues.find((i) => i.id === 'KI-A')?.resolution_round).toBe(1);

    issues = deferIssue(issues, 'KI-B');
    expect(issues.find((i) => i.id === 'KI-B')?.status).toBe('deferred');

    // Idempotent add of an existing id replaces in place.
    const updated = { ...a, summary: 'updated', status: 'open' as const };
    issues = addIssue(issues, updated);
    expect(issues.find((i) => i.id === 'KI-A')?.summary).toBe('updated');
    expect(issues.filter((i) => i.id === 'KI-A')).toHaveLength(1);
  });

  it('writes issues sorted by id for deterministic diffs', async () => {
    await writeKnownIssues(dir, [
      {
        id: 'KI-Z',
        severity: 'minor',
        summary: 'Z',
        opened_at: '2026-05-06',
        status: 'open',
      },
      {
        id: 'KI-A',
        severity: 'minor',
        summary: 'A',
        opened_at: '2026-05-06',
        status: 'open',
      },
    ]);
    const out = await readKnownIssues(dir);
    expect(out.map((i) => i.id)).toEqual(['KI-A', 'KI-Z']);
  });
});
