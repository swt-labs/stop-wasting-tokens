/**
 * Plan 15-02-01 T5 — unit tests for the `swt todo` verb + helpers.
 *
 * Coverage:
 *   1. computeTodoHash determinism (length + stable hex output)
 *   2. appendTodoToState happy path — preserves untouched sections byte-equal
 *   3. appendTodoToState creates `## Todos` when missing
 *   4. Idempotency — second call with same description is a no-op
 *   5. Annotation suffixes — phase/priority/assignee order stability
 *   6. todo-details.json round-trip via Zod
 *   7. Invalid TodoDetail rejected by Zod before writing
 *   8. todoHandler happy path — exit 0 + stdout has hash + description
 *   9. todoHandler rejects short description (USAGE_ERROR + stderr)
 *  10. todoHandler rejects bad --priority (USAGE_ERROR + no file writes)
 *  11. todoHandler rejects bad --phase (USAGE_ERROR + no file writes)
 *  12. todoHandler with all sidecar flags writes todo-details.json
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { todoHandler } from '../src/commands/todo.js';
import { EXIT } from '../src/exit-codes.js';
import {
  appendTodoToState,
  computeTodoHash,
  readTodoDetails,
  writeTodoDetail,
} from '../src/lib/todo-state.js';
import type { CommandIO } from '../src/router.js';

import { StringStream } from './_helpers.js';

let cwd: string;
let planningRoot: string;
let statePath: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-todo-'));
  planningRoot = join(cwd, '.swt-planning');
  await mkdir(planningRoot, { recursive: true });
  statePath = join(planningRoot, 'STATE.md');
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('computeTodoHash', () => {
  it('returns 8 hex chars', () => {
    const hash = computeTodoHash('fix login');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic — same input yields same output', () => {
    const a = computeTodoHash('fix login bug');
    const b = computeTodoHash('fix login bug');
    expect(a).toBe(b);
  });

  it('different descriptions yield different hashes', () => {
    expect(computeTodoHash('fix login bug')).not.toBe(computeTodoHash('fix logout bug'));
  });
});

describe('appendTodoToState', () => {
  it('preserves untouched sections byte-equal when appending', async () => {
    const original =
      `# State\n\n## Activity Log\n\n| Date | Event |\n|------|-------|\n| 2026-01-01 | seeded |\n\n` +
      `## Todos\n- [TODO] existing thing (added 2026-01-01) (ref:deadbeef)\n\n## Blockers\n\nNone.\n`;
    await writeFile(statePath, original, 'utf8');
    const hash = computeTodoHash('new thing');
    const res = await appendTodoToState({
      statePath,
      description: 'new thing',
      hash,
      addedDate: '2026-05-17',
    });
    expect(res.appended).toBe(true);
    const after = await readFile(statePath, 'utf8');
    // Activity Log block preserved byte-equal
    expect(after).toContain('## Activity Log\n\n| Date | Event |\n|------|-------|\n| 2026-01-01 | seeded |');
    // Blockers section preserved byte-equal
    expect(after.endsWith('## Blockers\n\nNone.\n')).toBe(true);
    // Existing Todos line preserved
    expect(after).toContain('- [TODO] existing thing (added 2026-01-01) (ref:deadbeef)');
    // New line added
    expect(after).toContain(`- [TODO] new thing (added 2026-05-17) (ref:${hash})`);
  });

  it('creates ## Todos when missing (after ## Activity Log)', async () => {
    const original = `# State\n\n## Activity Log\n\n| Date | Event |\n|------|-------|\n| 2026-01-01 | seeded |\n\n## Blockers\n\nNone.\n`;
    await writeFile(statePath, original, 'utf8');
    const hash = computeTodoHash('first todo');
    await appendTodoToState({
      statePath,
      description: 'first todo',
      hash,
      addedDate: '2026-05-17',
    });
    const after = await readFile(statePath, 'utf8');
    expect(after).toContain('## Todos\n');
    expect(after).toContain(`- [TODO] first todo (added 2026-05-17) (ref:${hash})`);
    // Blockers still present after Todos
    expect(after.indexOf('## Todos')).toBeLessThan(after.indexOf('## Blockers'));
  });

  it('creates ## Todos at EOF when no Activity Log', async () => {
    const original = `# State\n\nSome preamble.\n`;
    await writeFile(statePath, original, 'utf8');
    const hash = computeTodoHash('only todo');
    await appendTodoToState({
      statePath,
      description: 'only todo',
      hash,
      addedDate: '2026-05-17',
    });
    const after = await readFile(statePath, 'utf8');
    expect(after).toContain('Some preamble.');
    expect(after).toContain('## Todos');
    expect(after).toContain(`- [TODO] only todo (added 2026-05-17) (ref:${hash})`);
  });

  it('is idempotent — same hash twice yields no duplicate line', async () => {
    const original = `# State\n\n## Todos\n\n## Blockers\n\nNone.\n`;
    await writeFile(statePath, original, 'utf8');
    const hash = computeTodoHash('dup test');
    await appendTodoToState({
      statePath,
      description: 'dup test',
      hash,
      addedDate: '2026-05-17',
    });
    const afterFirst = await readFile(statePath, 'utf8');
    const res = await appendTodoToState({
      statePath,
      description: 'dup test',
      hash,
      addedDate: '2026-05-17',
    });
    expect(res.appended).toBe(false);
    const afterSecond = await readFile(statePath, 'utf8');
    expect(afterSecond).toBe(afterFirst);
    // Only ONE occurrence of the hash
    const matches = afterSecond.match(new RegExp(`\\(ref:${hash}\\)`, 'g')) ?? [];
    expect(matches.length).toBe(1);
  });

  it('appends annotation suffixes in stable order: phase, priority, assignee', async () => {
    const original = `# State\n\n## Todos\n\n`;
    await writeFile(statePath, original, 'utf8');
    const hash = computeTodoHash('annotated');
    const res = await appendTodoToState({
      statePath,
      description: 'annotated',
      hash,
      addedDate: '2026-05-17',
      phase: '03',
      priority: 'high',
      assignee: 'alice',
    });
    expect(res.line).toBe(
      `- [TODO] annotated (added 2026-05-17) (ref:${hash}) (phase:03) (priority:high) (assignee:alice)`,
    );
    const after = await readFile(statePath, 'utf8');
    expect(after).toContain(res.line);
  });
});

describe('readTodoDetails / writeTodoDetail round-trip', () => {
  it('round-trips a single TodoDetail through Zod validation', async () => {
    const hash = computeTodoHash('round trip');
    await writeTodoDetail(planningRoot, hash, {
      description: 'round trip',
      detail: 'some context',
      phase: '02',
      files: ['a.ts', 'b.ts'],
      priority: 'medium',
      assignee: 'bob',
      created_at: '2026-05-17T10:00:00Z',
    });
    const parsed = await readTodoDetails(planningRoot);
    expect(parsed.schema_version).toBe(1);
    expect(parsed.todos[hash]).toEqual({
      description: 'round trip',
      detail: 'some context',
      phase: '02',
      files: ['a.ts', 'b.ts'],
      priority: 'medium',
      assignee: 'bob',
      created_at: '2026-05-17T10:00:00Z',
    });
  });

  it('returns empty default when todo-details.json does not exist', async () => {
    const parsed = await readTodoDetails(planningRoot);
    expect(parsed).toEqual({ schema_version: 1, todos: {} });
  });

  it('preserves other entries when writing a new one', async () => {
    const h1 = computeTodoHash('first');
    const h2 = computeTodoHash('second');
    await writeTodoDetail(planningRoot, h1, {
      description: 'first',
      created_at: '2026-05-17T10:00:00Z',
    });
    await writeTodoDetail(planningRoot, h2, {
      description: 'second',
      created_at: '2026-05-17T10:01:00Z',
    });
    const parsed = await readTodoDetails(planningRoot);
    expect(Object.keys(parsed.todos).sort()).toEqual([h1, h2].sort());
  });

  it('rejects invalid TodoDetail (bad priority) before writing', async () => {
    const hash = computeTodoHash('bad detail');
    await expect(
      writeTodoDetail(planningRoot, hash, {
        description: 'bad detail',
        // @ts-expect-error — deliberately invalid for the Zod guard
        priority: 'urgent',
        created_at: '2026-05-17T10:00:00Z',
      }),
    ).rejects.toThrow();
    // File should NOT have been created — write happens AFTER Zod parse
    expect(await exists(join(planningRoot, 'todo-details.json'))).toBe(false);
  });
});

describe('todoHandler', () => {
  function makeIO(): { io: CommandIO; out: StringStream; err: StringStream } {
    const out = new StringStream();
    const err = new StringStream();
    return { io: { cwd, stdout: out, stderr: err }, out, err };
  }

  it('happy path — appends to STATE.md and exits 0', async () => {
    // Seed STATE.md with an existing ## Todos section so the test
    // exercises the append-into-existing path.
    await writeFile(statePath, `# State\n\n## Todos\n\n`, 'utf8');
    const { io, out, err } = makeIO();
    const code = await todoHandler(
      { verb: 'todo', positionals: ['fix the login bug'], flags: {} },
      io,
    );
    expect(code).toBe(EXIT.SUCCESS);
    const hash = computeTodoHash('fix the login bug');
    expect(out.text()).toContain(`Added todo: ${hash} — fix the login bug`);
    expect(err.text()).toBe('');
    const state = await readFile(statePath, 'utf8');
    expect(state).toContain(`(ref:${hash})`);
    // No sidecar written when no optional flags
    expect(await exists(join(planningRoot, 'todo-details.json'))).toBe(false);
  });

  it('idempotent — second invocation prints "already exists" + exits 0', async () => {
    await writeFile(statePath, `# State\n\n## Todos\n\n`, 'utf8');
    const first = makeIO();
    await todoHandler({ verb: 'todo', positionals: ['idempotent'], flags: {} }, first.io);
    const stateAfterFirst = await readFile(statePath, 'utf8');
    const second = makeIO();
    const code = await todoHandler(
      { verb: 'todo', positionals: ['idempotent'], flags: {} },
      second.io,
    );
    expect(code).toBe(EXIT.SUCCESS);
    const hash = computeTodoHash('idempotent');
    expect(second.out.text()).toContain(`Todo already exists: ${hash}`);
    // STATE.md unchanged
    expect(await readFile(statePath, 'utf8')).toBe(stateAfterFirst);
  });

  it('rejects short description (<3 chars) — USAGE_ERROR, no file writes', async () => {
    const { io, out, err } = makeIO();
    const code = await todoHandler({ verb: 'todo', positionals: ['x'], flags: {} }, io);
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(err.text()).toContain('at least 3 characters');
    expect(out.text()).toBe('');
    expect(await exists(statePath)).toBe(false);
    expect(await exists(join(planningRoot, 'todo-details.json'))).toBe(false);
  });

  it('rejects bad --priority — USAGE_ERROR, no file writes', async () => {
    const { io, err } = makeIO();
    const code = await todoHandler(
      { verb: 'todo', positionals: ['some todo'], flags: { priority: 'urgent' } },
      io,
    );
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(err.text()).toContain('--priority must be one of high|medium|low');
    expect(await exists(statePath)).toBe(false);
    expect(await exists(join(planningRoot, 'todo-details.json'))).toBe(false);
  });

  it('rejects bad --phase — USAGE_ERROR, no file writes', async () => {
    const { io, err } = makeIO();
    const code = await todoHandler(
      { verb: 'todo', positionals: ['some todo'], flags: { phase: '3' } },
      io,
    );
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(err.text()).toContain('--phase must match');
    expect(await exists(statePath)).toBe(false);
    expect(await exists(join(planningRoot, 'todo-details.json'))).toBe(false);
  });

  it('writes sidecar when any optional flag is set', async () => {
    await writeFile(statePath, `# State\n\n## Todos\n\n`, 'utf8');
    const { io, out } = makeIO();
    const code = await todoHandler(
      {
        verb: 'todo',
        positionals: ['with sidecar'],
        flags: {
          detail: 'more context',
          phase: '04',
          files: 'a.ts,b.ts',
          priority: 'high',
          assignee: 'alice',
        },
      },
      io,
    );
    expect(code).toBe(EXIT.SUCCESS);
    const hash = computeTodoHash('with sidecar');
    expect(out.text()).toContain(`Added todo: ${hash}`);
    // STATE.md has the annotated line
    const state = await readFile(statePath, 'utf8');
    expect(state).toContain(`(phase:04) (priority:high) (assignee:alice)`);
    // Sidecar exists with the full TodoDetail
    const sidecar = await readTodoDetails(planningRoot);
    expect(sidecar.todos[hash]).toMatchObject({
      description: 'with sidecar',
      detail: 'more context',
      phase: '04',
      files: ['a.ts', 'b.ts'],
      priority: 'high',
      assignee: 'alice',
    });
    expect(typeof sidecar.todos[hash]?.created_at).toBe('string');
  });
});
