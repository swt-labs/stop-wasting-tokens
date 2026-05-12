import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  harvestTaskResult,
  harvestTaskResultFromEntries,
  MissingTaskResultError,
  readSessionEntries,
  type PiSessionEntryLike,
} from '../src/result-harvest.js';

const validResult = {
  schema_version: 1 as const,
  task_id: 'T-001',
  status: 'success' as const,
  summary: 'ok',
  files_changed: [],
  must_haves: [{ id: 'M-1', status: 'passed' as const }],
};

describe('@swt-labs/orchestration — harvestTaskResultFromEntries', () => {
  it('returns the parsed TaskResult when a valid entry is present', () => {
    const entries: PiSessionEntryLike[] = [
      { type: 'message', data: { text: 'hi' } },
      { type: 'custom', customType: 'swt-task-result', data: validResult },
    ];
    const result = harvestTaskResultFromEntries(entries);
    expect(result.task_id).toBe('T-001');
    expect(result.status).toBe('success');
  });

  it('throws MissingTaskResultError when no swt-task-result entry exists', () => {
    expect(() =>
      harvestTaskResultFromEntries([
        { type: 'message', data: {} },
        { type: 'custom', customType: 'task-context', data: { taskId: 'T-1' } },
      ]),
    ).toThrow(MissingTaskResultError);
  });

  it('throws on validation when the entry is malformed', () => {
    expect(() =>
      harvestTaskResultFromEntries([
        {
          type: 'custom',
          customType: 'swt-task-result',
          data: { schema_version: 1, status: 'bogus' }, // missing required fields
        },
      ]),
    ).toThrow();
  });

  it('returns the LAST entry when multiple are present (defensive placeholder race)', () => {
    const entries: PiSessionEntryLike[] = [
      {
        type: 'custom',
        customType: 'swt-task-result',
        data: { ...validResult, task_id: 'T-old' },
      },
      {
        type: 'custom',
        customType: 'swt-task-result',
        data: { ...validResult, task_id: 'T-new' },
      },
    ];
    expect(harvestTaskResultFromEntries(entries).task_id).toBe('T-new');
  });

  it('ignores non-`custom` entries even with customType=swt-task-result', () => {
    const entries: PiSessionEntryLike[] = [
      { type: 'message', customType: 'swt-task-result', data: validResult }, // wrong type field
    ];
    expect(() => harvestTaskResultFromEntries(entries)).toThrow(MissingTaskResultError);
  });
});

describe('@swt-labs/orchestration — readSessionEntries + harvestTaskResult (file)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'swt-harvest-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reads JSONL and harvests the last swt-task-result entry', () => {
    const path = join(tmp, 'session.jsonl');
    const lines = [
      JSON.stringify({ type: 'agent_start', sessionId: 's1' }),
      JSON.stringify({ type: 'message', data: { role: 'assistant' } }),
      JSON.stringify({ type: 'custom', customType: 'swt-task-result', data: validResult }),
    ];
    writeFileSync(path, lines.join('\n') + '\n', 'utf8');
    const result = harvestTaskResult(path);
    expect(result.task_id).toBe('T-001');
  });

  it('tolerates blank lines + malformed JSON (best-effort recovery)', () => {
    const path = join(tmp, 'session.jsonl');
    writeFileSync(
      path,
      [
        '',
        JSON.stringify({ type: 'agent_start', sessionId: 's1' }),
        '{not valid json',
        '',
        JSON.stringify({ type: 'custom', customType: 'swt-task-result', data: validResult }),
      ].join('\n'),
      'utf8',
    );
    expect(harvestTaskResult(path).task_id).toBe('T-001');
  });

  it('readSessionEntries returns [] for an empty file', () => {
    const path = join(tmp, 'empty.jsonl');
    writeFileSync(path, '', 'utf8');
    expect(readSessionEntries(path)).toEqual([]);
  });

  it('harvestTaskResult throws MissingTaskResultError when no entry found', () => {
    const path = join(tmp, 'no-result.jsonl');
    writeFileSync(path, JSON.stringify({ type: 'agent_start', sessionId: 's1' }) + '\n', 'utf8');
    expect(() => harvestTaskResult(path)).toThrow(MissingTaskResultError);
  });
});
