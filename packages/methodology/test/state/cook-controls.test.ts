import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CookCancelledError,
  readPendingSignal,
  waitForResumeOrCancel,
  writePendingSignal,
} from '../../src/state/cook-controls.js';

/**
 * Plan 04-01 (Phase 4) T4 — Cook control-signal file protocol.
 *
 * R2 decision: next-boundary pause + SIGTERM cancel. The signal file
 * lives at .swt-planning/.cook-controls/{sessionId}.pending; cook polls
 * + atomically consumes it (read-then-unlink) at every mode-dispatch
 * boundary.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-cook-controls-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const planningRoot = () => dir;
const sigPath = (sessionId: string) =>
  join(dir, '.swt-planning', '.cook-controls', `${sessionId}.pending`);

describe('@swt-labs/methodology — cook-controls signal-file protocol', () => {
  it('readPendingSignal returns null when no file exists', () => {
    expect(readPendingSignal('s-1', planningRoot())).toBeNull();
  });

  it('writePendingSignal + readPendingSignal round-trip the action and unlink the file', () => {
    writePendingSignal('s-2', 'pause', planningRoot());
    expect(existsSync(sigPath('s-2'))).toBe(true);
    expect(readPendingSignal('s-2', planningRoot())).toBe('pause');
    // The reader consumed it — subsequent reads see null.
    expect(existsSync(sigPath('s-2'))).toBe(false);
    expect(readPendingSignal('s-2', planningRoot())).toBeNull();
  });

  it('accepts all three actions: pause / resume / cancel', () => {
    for (const action of ['pause', 'resume', 'cancel'] as const) {
      writePendingSignal(`s-${action}`, action, planningRoot());
      expect(readPendingSignal(`s-${action}`, planningRoot())).toBe(action);
    }
  });

  it('rejects garbage signal contents (returns null + still unlinks)', () => {
    // First seed a valid signal to create the directory + then overwrite
    // with junk in place.
    writePendingSignal('s-garbage', 'pause', planningRoot());
    writeFileSync(sigPath('s-garbage'), 'gibberish');
    expect(readPendingSignal('s-garbage', planningRoot())).toBeNull();
    expect(existsSync(sigPath('s-garbage'))).toBe(false);
  });

  it('pause → resume sequence: waitForResumeOrCancel returns "resume"', async () => {
    // Simulate the "resume after pause" path: place the resume signal
    // before the poller starts so it converges on the first poll.
    writePendingSignal('s-pr', 'resume', planningRoot());
    const action = await waitForResumeOrCancel('s-pr', {
      pollIntervalMs: 5,
      planningRoot: planningRoot(),
      maxPolls: 10,
    });
    expect(action).toBe('resume');
  });

  it('pause → cancel sequence: waitForResumeOrCancel returns "cancel"', async () => {
    writePendingSignal('s-pc', 'cancel', planningRoot());
    const action = await waitForResumeOrCancel('s-pc', {
      pollIntervalMs: 5,
      planningRoot: planningRoot(),
      maxPolls: 10,
    });
    expect(action).toBe('cancel');
  });

  it('waitForResumeOrCancel polls until a signal lands', async () => {
    const promise = waitForResumeOrCancel('s-poll', {
      pollIntervalMs: 5,
      planningRoot: planningRoot(),
      maxPolls: 100,
    });
    // Stagger the signal write by one poll cycle.
    setTimeout(() => writePendingSignal('s-poll', 'resume', planningRoot()), 12);
    const action = await promise;
    expect(action).toBe('resume');
  });

  it('waitForResumeOrCancel returns "cancel" if maxPolls runs out (test seam)', async () => {
    const action = await waitForResumeOrCancel('s-runout', {
      pollIntervalMs: 1,
      planningRoot: planningRoot(),
      maxPolls: 3,
    });
    expect(action).toBe('cancel');
  });

  it('CookCancelledError exposes the sessionId + canonical name', () => {
    const err = new CookCancelledError('s-err');
    expect(err.sessionId).toBe('s-err');
    expect(err.name).toBe('CookCancelledError');
    expect(err.message).toContain('s-err');
    expect(err).toBeInstanceOf(Error);
  });
});
