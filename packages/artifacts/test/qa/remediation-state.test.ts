import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  advanceRemediationRound,
  getOrInitRemediationState,
  pad2,
  roundUatPath,
} from '../../src/qa/remediation-state.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-remediation-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('remediation state', () => {
  it('initializes round=01 when no file exists', async () => {
    const state = await getOrInitRemediationState(dir, 'major');
    expect(state.round).toBe(1);
    expect(state.layout).toBe('round-dir');
    expect(state.severity).toBe('major');
    expect(state.last_stage).toBe('none');
    expect(state.started).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const persisted = JSON.parse(
      await readFile(join(dir, '.uat-remediation-stage'), 'utf8'),
    );
    expect(persisted.round).toBe(1);
  });

  it('preserves existing state on subsequent reads', async () => {
    const first = await getOrInitRemediationState(dir, 'major');
    const second = await getOrInitRemediationState(dir, 'minor'); // severity arg ignored when state exists
    expect(second.round).toBe(first.round);
    expect(second.severity).toBe('major');
  });

  it('advances the round counter', async () => {
    await getOrInitRemediationState(dir, 'major');
    const next = await advanceRemediationRound(dir);
    expect(next.round).toBe(2);
    const after = await getOrInitRemediationState(dir, 'major');
    expect(after.round).toBe(2);
  });

  it('roundUatPath honors layout', () => {
    const state = {
      version: 1 as const,
      round: 3,
      layout: 'round-dir' as const,
      severity: 'major' as const,
      started: '2026-05-06T00:00:00Z',
      last_stage: 'none' as const,
    };
    expect(roundUatPath('/p', state)).toBe('/p/remediation/uat/round-03/R03-UAT.md');

    const legacy = { ...state, layout: 'legacy' as const };
    expect(roundUatPath('/p', legacy)).toBe('/p/remediation/round-03/R03-UAT.md');
  });

  it('pad2 zero-pads single digits', () => {
    expect(pad2(1)).toBe('01');
    expect(pad2(12)).toBe('12');
  });
});
