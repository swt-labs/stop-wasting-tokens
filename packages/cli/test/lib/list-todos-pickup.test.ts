/**
 * Plan 15-04-01 T5 — unit tests for the `list-todos-pickup` helper
 * module (`packages/cli/src/lib/list-todos-pickup.ts`). Covers:
 *
 *   readSnapshotForPickup
 *     1.  Returns null when snapshot file does not exist (ENOENT).
 *     2.  Returns null when JSON.parse fails (truncated input).
 *     3.  Returns null when Zod validation fails (missing `refs` field).
 *     4.  Returns the snapshot when fresh + unfiltered + guards both ON.
 *     5.  requireFresh=true + stale → null + logger invoked once with `stale`.
 *     6.  requireFresh=false + stale → returns snapshot (escape-hatch path).
 *     7.  requireUnfiltered=true + filtered → null + logger invoked once with
 *         `filtered`.
 *     8.  requireUnfiltered=false + filtered → returns snapshot.
 *     9.  Both guards off + fresh unfiltered → returns snapshot, no logger.
 *     10. Logger undefined + null-return path → no crash (regression).
 *
 *   loadTodoDetailForRef
 *     11. Returns the TodoDetail when hash is present in todo-details.json.
 *     12. Returns undefined when hash is absent from the file.
 *     13. Returns undefined when todo-details.json does not exist
 *         (readTodoDetails substitutes the empty default).
 *     14. Throws a Zod error when todo-details.json is malformed (caller
 *         swallows + logs per plan T4).
 *
 * Test harness: vitest, tmpdir + mkdtemp per-test sandbox, fixtures
 * written via node:fs/promises. No mocking — exercises the real
 * filesystem + Zod schemas + Phase 02 `readTodoDetails` helper.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LIST_TODOS_SNAPSHOT_TTL_MS,
  type ListTodosSnapshot,
  type TodoDetail,
  type TodoDetailsFile,
} from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadTodoDetailForRef,
  readSnapshotForPickup,
} from '../../src/lib/list-todos-pickup.js';

const SNAPSHOT_REL = '.swt-planning/.cache/list-todos-snapshot.json';
const DETAILS_REL = '.swt-planning/todo-details.json';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-list-todos-pickup-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function writeSnapshot(snapshot: ListTodosSnapshot): Promise<void> {
  const path = join(cwd, SNAPSHOT_REL);
  await mkdir(join(cwd, '.swt-planning', '.cache'), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf8');
}

async function writeRawSnapshot(raw: string): Promise<void> {
  const path = join(cwd, SNAPSHOT_REL);
  await mkdir(join(cwd, '.swt-planning', '.cache'), { recursive: true });
  await writeFile(path, raw, 'utf8');
}

async function writeDetails(detail: TodoDetailsFile): Promise<void> {
  const path = join(cwd, DETAILS_REL);
  await mkdir(join(cwd, '.swt-planning'), { recursive: true });
  await writeFile(path, JSON.stringify(detail, null, 2), 'utf8');
}

async function writeRawDetails(raw: string): Promise<void> {
  const path = join(cwd, DETAILS_REL);
  await mkdir(join(cwd, '.swt-planning'), { recursive: true });
  await writeFile(path, raw, 'utf8');
}

function buildSnapshot(
  overrides: Partial<ListTodosSnapshot> = {},
): ListTodosSnapshot {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    filter: null,
    refs: ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee'],
    ...overrides,
  };
}

function buildDetail(overrides: Partial<TodoDetail> = {}): TodoDetail {
  return {
    description: 'fix login button',
    created_at: '2026-05-17',
    ...overrides,
  };
}

describe('readSnapshotForPickup', () => {
  it('returns null when snapshot file does not exist (ENOENT)', async () => {
    const logger = vi.fn();
    const result = await readSnapshotForPickup(
      cwd,
      { requireFresh: true, requireUnfiltered: true },
      logger,
    );
    expect(result).toBeNull();
    expect(logger).not.toHaveBeenCalled();
  });

  it('returns null when JSON.parse fails (truncated input)', async () => {
    await writeRawSnapshot('{ "schema_version": 1, "generated_at":');
    const logger = vi.fn();
    const result = await readSnapshotForPickup(
      cwd,
      { requireFresh: true, requireUnfiltered: true },
      logger,
    );
    expect(result).toBeNull();
    expect(logger).not.toHaveBeenCalled();
  });

  it('returns null when Zod validation fails (missing refs field)', async () => {
    await writeRawSnapshot(
      JSON.stringify({
        schema_version: 1,
        generated_at: new Date().toISOString(),
        filter: null,
        // refs intentionally missing
      }),
    );
    const logger = vi.fn();
    const result = await readSnapshotForPickup(
      cwd,
      { requireFresh: true, requireUnfiltered: true },
      logger,
    );
    expect(result).toBeNull();
    expect(logger).not.toHaveBeenCalled();
  });

  it('returns the snapshot when fresh + unfiltered + both guards ON', async () => {
    const snapshot = buildSnapshot();
    await writeSnapshot(snapshot);
    const logger = vi.fn();
    const result = await readSnapshotForPickup(
      cwd,
      { requireFresh: true, requireUnfiltered: true },
      logger,
    );
    expect(result).not.toBeNull();
    expect(result?.refs).toEqual(snapshot.refs);
    expect(result?.filter).toBeNull();
    expect(logger).not.toHaveBeenCalled();
  });

  it('requireFresh=true + stale → null + logger invoked once with `stale`', async () => {
    const staleTs = new Date(
      Date.now() - LIST_TODOS_SNAPSHOT_TTL_MS - 60_000,
    ).toISOString();
    await writeSnapshot(buildSnapshot({ generated_at: staleTs }));
    const logger = vi.fn();
    const result = await readSnapshotForPickup(
      cwd,
      { requireFresh: true, requireUnfiltered: true },
      logger,
    );
    expect(result).toBeNull();
    expect(logger).toHaveBeenCalledTimes(1);
    expect(String(logger.mock.calls[0]?.[0])).toContain('stale');
  });

  it('requireFresh=false + stale → returns the snapshot (escape-hatch path)', async () => {
    const staleTs = new Date(
      Date.now() - LIST_TODOS_SNAPSHOT_TTL_MS - 60_000,
    ).toISOString();
    const snapshot = buildSnapshot({ generated_at: staleTs });
    await writeSnapshot(snapshot);
    const logger = vi.fn();
    const result = await readSnapshotForPickup(
      cwd,
      { requireFresh: false, requireUnfiltered: false },
      logger,
    );
    expect(result).not.toBeNull();
    expect(result?.refs).toEqual(snapshot.refs);
    expect(logger).not.toHaveBeenCalled();
  });

  it('requireUnfiltered=true + filtered → null + logger invoked once with `filtered`', async () => {
    await writeSnapshot(buildSnapshot({ filter: { phase: '03' } }));
    const logger = vi.fn();
    const result = await readSnapshotForPickup(
      cwd,
      { requireFresh: true, requireUnfiltered: true },
      logger,
    );
    expect(result).toBeNull();
    expect(logger).toHaveBeenCalledTimes(1);
    expect(String(logger.mock.calls[0]?.[0])).toContain('filtered');
    expect(String(logger.mock.calls[0]?.[0])).toContain('phase=03');
  });

  it('requireUnfiltered=false + filtered → returns the snapshot', async () => {
    const snapshot = buildSnapshot({ filter: { phase: '03' } });
    await writeSnapshot(snapshot);
    const logger = vi.fn();
    const result = await readSnapshotForPickup(
      cwd,
      { requireFresh: false, requireUnfiltered: false },
      logger,
    );
    expect(result).not.toBeNull();
    expect(result?.filter).toEqual({ phase: '03' });
    expect(logger).not.toHaveBeenCalled();
  });

  it('both guards off + fresh unfiltered → returns snapshot, no logger calls', async () => {
    const snapshot = buildSnapshot();
    await writeSnapshot(snapshot);
    const logger = vi.fn();
    const result = await readSnapshotForPickup(
      cwd,
      { requireFresh: false, requireUnfiltered: false },
      logger,
    );
    expect(result).not.toBeNull();
    expect(logger).not.toHaveBeenCalled();
  });

  it('logger undefined + null-return path → no crash (regression)', async () => {
    // ENOENT path with no logger argument at all — must not throw.
    const result = await readSnapshotForPickup(cwd, {
      requireFresh: true,
      requireUnfiltered: true,
    });
    expect(result).toBeNull();
  });
});

describe('loadTodoDetailForRef', () => {
  it('returns the TodoDetail when hash is present in todo-details.json', async () => {
    const detail = buildDetail({ description: 'fix login button' });
    await writeDetails({
      schema_version: 1,
      todos: { aaaaaaaa: detail },
    });
    const result = await loadTodoDetailForRef(cwd, 'aaaaaaaa');
    expect(result).toEqual(detail);
  });

  it('returns undefined when hash is absent from todo-details.json', async () => {
    await writeDetails({
      schema_version: 1,
      todos: { aaaaaaaa: buildDetail() },
    });
    const result = await loadTodoDetailForRef(cwd, 'bbbbbbbb');
    expect(result).toBeUndefined();
  });

  it('returns undefined when todo-details.json does not exist', async () => {
    // No file written — readTodoDetails returns the empty default
    // `{schema_version: 1, todos: {}}` so the lookup yields undefined.
    const result = await loadTodoDetailForRef(cwd, 'aaaaaaaa');
    expect(result).toBeUndefined();
  });

  it('throws a Zod error when todo-details.json is malformed', async () => {
    // Wrong shape — `todos` is a string instead of a record.
    await writeRawDetails(
      JSON.stringify({ schema_version: 1, todos: 'oops' }),
    );
    await expect(loadTodoDetailForRef(cwd, 'aaaaaaaa')).rejects.toThrow();
  });
});
