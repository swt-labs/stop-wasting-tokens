/**
 * Plan 03-01 T5 — unit + integration tests for the `swt list-todos`
 * verb and its three helper modules:
 *   - packages/cli/src/lib/list-todos-state.ts  (parser)
 *   - packages/cli/src/lib/list-todos-render.ts (filter + render + snapshot)
 *   - packages/cli/src/commands/list-todos.ts   (handler)
 *
 * Coverage map (≥ 25 cases — well above the ≥ 15 floor):
 *
 *   parseTodosFromState
 *     1. returns [] when STATE.md does not exist
 *     2. returns [] when ## Todos section is absent
 *     3. returns [] when ## Todos section exists but has no entry lines
 *     4. parses a single [TODO] line with all annotations
 *     5. parses minimal line (no annotations)
 *     6. parses all four status tags ([TODO]/[IN-PROGRESS]/[BLOCKED]/[DONE])
 *     7. preserves source order across multiple entries
 *     8. skips malformed lines silently
 *
 *   filterTodos
 *     9. null filter passes through
 *    10. empty-object filter passes through
 *    11. single-key match narrows correctly
 *    12. multi-key filter combines with AND
 *    13. unknown filter key excludes all entries
 *
 *   renderTodoList
 *    14. empty input returns '(no todos)\n'
 *    15. prints numbered list with status icons for known tags
 *    16. unknown status tag falls back to ○
 *    17. omits absent annotations cleanly (ref always last)
 *
 *   writeListTodosSnapshot
 *    18. writes JSON at .swt-planning/.cache/list-todos-snapshot.json
 *    19. creates .cache/ directory if missing
 *    20. atomic replacement — 100-entry snapshot < 10 KB (AC-06)
 *    21. Zod-rejects malformed snapshot BEFORE writing
 *
 *   listTodosHandler
 *    22. default mode — prints list + writes snapshot with refs in display order
 *    23. --filter phase=03 — snapshot.filter = {phase: '03'} (AC-04)
 *    24. multiple --filter flags combine with AND
 *    25. --json — prints JSON to stdout, does NOT write snapshot (AC-05)
 *    26. malformed --filter token → USAGE_ERROR, no snapshot write
 *    27. missing STATE.md → '(no todos)' + empty-refs snapshot, exit 0
 *    28. integration: todoHandler then listTodosHandler shows the entry
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ListTodosSnapshotSchema } from '@swt-labs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listTodosHandler } from '../src/commands/list-todos.js';
import { todoHandler } from '../src/commands/todo.js';
import { EXIT } from '../src/exit-codes.js';
import {
  filterTodos,
  renderTodoList,
  SNAPSHOT_RELATIVE_PATH,
  writeListTodosSnapshot,
} from '../src/lib/list-todos-render.js';
import { parseTodosFromState } from '../src/lib/list-todos-state.js';
import { appendTodoToState, computeTodoHash } from '../src/lib/todo-state.js';
import type { CommandIO } from '../src/router.js';

import { StringStream } from './_helpers.js';

let cwd: string;
let planningRoot: string;
let statePath: string;
let snapshotPath: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-list-todos-'));
  planningRoot = join(cwd, '.swt-planning');
  await mkdir(planningRoot, { recursive: true });
  statePath = join(planningRoot, 'STATE.md');
  snapshotPath = join(planningRoot, SNAPSHOT_RELATIVE_PATH);
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

function makeIO(): { io: CommandIO; out: StringStream; err: StringStream } {
  const out = new StringStream();
  const err = new StringStream();
  return { io: { cwd, stdout: out, stderr: err }, out, err };
}

// ─────────────────────────────────────────────────────────────────────
// parseTodosFromState
// ─────────────────────────────────────────────────────────────────────

describe('parseTodosFromState', () => {
  it('returns [] when STATE.md does not exist', async () => {
    expect(await parseTodosFromState(statePath)).toEqual([]);
  });

  it('returns [] when ## Todos section is absent', async () => {
    await writeFile(statePath, `# State\n\n## Activity Log\n\nNothing here.\n`, 'utf8');
    expect(await parseTodosFromState(statePath)).toEqual([]);
  });

  it('returns [] when ## Todos exists but has no entry lines', async () => {
    await writeFile(statePath, `# State\n\n## Todos\n\n## Blockers\n\nNone.\n`, 'utf8');
    expect(await parseTodosFromState(statePath)).toEqual([]);
  });

  it('parses a single [TODO] line with all annotations', async () => {
    const hash = 'abc12345';
    await writeFile(
      statePath,
      `# State\n\n## Todos\n- [TODO] fix the login bug (added 2026-05-17) (ref:${hash}) (phase:02) (priority:high) (assignee:alice)\n\n## Blockers\n\nNone.\n`,
      'utf8',
    );
    const entries = await parseTodosFromState(statePath);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      status: '[TODO]',
      description: 'fix the login bug',
      added_date: '2026-05-17',
      ref: hash,
      phase: '02',
      priority: 'high',
      assignee: 'alice',
    });
  });

  it('parses minimal line (no annotations) — phase/priority/assignee undefined', async () => {
    await writeFile(
      statePath,
      `## Todos\n- [TODO] minimal (added 2026-05-17) (ref:deadbeef)\n`,
      'utf8',
    );
    const entries = await parseTodosFromState(statePath);
    expect(entries).toEqual([
      {
        status: '[TODO]',
        description: 'minimal',
        added_date: '2026-05-17',
        ref: 'deadbeef',
      },
    ]);
  });

  it('parses all four status tags', async () => {
    await writeFile(
      statePath,
      [
        '## Todos',
        '- [TODO] not started (added 2026-05-17) (ref:aaaaaaaa)',
        '- [IN-PROGRESS] working on it (added 2026-05-17) (ref:bbbbbbbb)',
        '- [BLOCKED] stuck (added 2026-05-17) (ref:cccccccc)',
        '- [DONE] shipped (added 2026-05-17) (ref:dddddddd)',
        '',
      ].join('\n'),
      'utf8',
    );
    const entries = await parseTodosFromState(statePath);
    expect(entries.map((e) => e.status)).toEqual([
      '[TODO]',
      '[IN-PROGRESS]',
      '[BLOCKED]',
      '[DONE]',
    ]);
  });

  it('preserves source order across multiple entries', async () => {
    await writeFile(
      statePath,
      [
        '## Todos',
        '- [TODO] zebra (added 2026-05-17) (ref:11111111)',
        '- [TODO] apple (added 2026-05-17) (ref:22222222)',
        '- [TODO] mango (added 2026-05-17) (ref:33333333)',
        '',
      ].join('\n'),
      'utf8',
    );
    const entries = await parseTodosFromState(statePath);
    expect(entries.map((e) => e.description)).toEqual(['zebra', 'apple', 'mango']);
  });

  it('skips malformed lines silently', async () => {
    await writeFile(
      statePath,
      [
        '## Todos',
        '- [TODO] real one (added 2026-05-17) (ref:abcdef01)',
        '<!-- a comment line that does not match the regex -->',
        '- [TODO] (added 2026-05-17) (ref:badf00d1)', // missing description — won't match
        '| junk | table | row |',
        '- [TODO] another real (added 2026-05-17) (ref:abcdef02)',
        '',
      ].join('\n'),
      'utf8',
    );
    const entries = await parseTodosFromState(statePath);
    expect(entries.map((e) => e.ref)).toEqual(['abcdef01', 'abcdef02']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// filterTodos
// ─────────────────────────────────────────────────────────────────────

describe('filterTodos', () => {
  const fixtures = [
    {
      status: '[TODO]' as const,
      description: 'a',
      added_date: '2026-05-17',
      ref: '11111111',
      phase: '02',
      priority: 'high' as const,
    },
    {
      status: '[TODO]' as const,
      description: 'b',
      added_date: '2026-05-17',
      ref: '22222222',
      phase: '03',
      priority: 'low' as const,
    },
    {
      status: '[TODO]' as const,
      description: 'c',
      added_date: '2026-05-17',
      ref: '33333333',
      phase: '03',
      priority: 'high' as const,
    },
  ];

  it('null filter returns entries unchanged', () => {
    expect(filterTodos(fixtures, null)).toEqual(fixtures);
  });

  it('empty-object filter returns entries unchanged', () => {
    expect(filterTodos(fixtures, {})).toEqual(fixtures);
  });

  it('single-key match (phase=03) narrows correctly', () => {
    const got = filterTodos(fixtures, { phase: '03' });
    expect(got.map((e) => e.ref)).toEqual(['22222222', '33333333']);
  });

  it('multi-key filter combines with AND', () => {
    const got = filterTodos(fixtures, { phase: '03', priority: 'high' });
    expect(got.map((e) => e.ref)).toEqual(['33333333']);
  });

  it('unknown filter key excludes all entries', () => {
    const got = filterTodos(fixtures, { bogus: 'value' });
    expect(got).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// renderTodoList
// ─────────────────────────────────────────────────────────────────────

describe('renderTodoList', () => {
  it("empty input returns '(no todos)\\n'", () => {
    expect(renderTodoList([])).toBe('(no todos)\n');
  });

  it('prints numbered list with status icons for known tags', () => {
    const rendered = renderTodoList([
      {
        status: '[TODO]',
        description: 'one',
        added_date: '2026-05-17',
        ref: '11111111',
      },
      {
        status: '[IN-PROGRESS]',
        description: 'two',
        added_date: '2026-05-17',
        ref: '22222222',
      },
      {
        status: '[BLOCKED]',
        description: 'three',
        added_date: '2026-05-17',
        ref: '33333333',
      },
      {
        status: '[DONE]',
        description: 'four',
        added_date: '2026-05-17',
        ref: '44444444',
      },
    ]);
    const lines = rendered.trimEnd().split('\n');
    expect(lines[0]).toBe(' 1. ○ one (ref:11111111)');
    expect(lines[1]).toBe(' 2. ◆ two (ref:22222222)');
    expect(lines[2]).toBe(' 3. ✗ three (ref:33333333)');
    expect(lines[3]).toBe(' 4. ✓ four (ref:44444444)');
    expect(rendered.endsWith('\n')).toBe(true);
  });

  it('unknown status tag falls back to ○', () => {
    // Bypass the Zod parse layer to inject a hypothetical future tag.
    const rendered = renderTodoList([
      {
        status: '[FUTURE]' as never,
        description: 'forward-compat',
        added_date: '2026-05-17',
        ref: '99999999',
      },
    ]);
    expect(rendered).toContain('○ forward-compat');
  });

  it('omits absent annotations cleanly (ref always last)', () => {
    const rendered = renderTodoList([
      {
        status: '[TODO]',
        description: 'with phase + priority',
        added_date: '2026-05-17',
        ref: '11111111',
        phase: '02',
        priority: 'high',
      },
    ]);
    expect(rendered.trimEnd()).toBe(
      ' 1. ○ with phase + priority (phase:02) (priority:high) (ref:11111111)',
    );
    // No double spaces between annotations
    expect(rendered).not.toContain('  ');
  });
});

// ─────────────────────────────────────────────────────────────────────
// writeListTodosSnapshot
// ─────────────────────────────────────────────────────────────────────

describe('writeListTodosSnapshot', () => {
  it('writes JSON at .swt-planning/.cache/list-todos-snapshot.json', async () => {
    await writeListTodosSnapshot(planningRoot, {
      schema_version: 1,
      generated_at: '2026-05-17T10:00:00Z',
      filter: null,
      refs: ['abc12345', 'def67890'],
    });
    expect(await exists(snapshotPath)).toBe(true);
    const raw = await readFile(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      schema_version: 1,
      generated_at: '2026-05-17T10:00:00Z',
      filter: null,
      refs: ['abc12345', 'def67890'],
    });
    // Validates as a snapshot
    expect(() => ListTodosSnapshotSchema.parse(parsed)).not.toThrow();
  });

  it('creates .cache/ directory if missing', async () => {
    // .cache/ does not exist at the start of the test.
    expect(await exists(join(planningRoot, '.cache'))).toBe(false);
    await writeListTodosSnapshot(planningRoot, {
      schema_version: 1,
      generated_at: '2026-05-17T10:00:00Z',
      filter: null,
      refs: [],
    });
    expect(await exists(join(planningRoot, '.cache'))).toBe(true);
    expect(await exists(snapshotPath)).toBe(true);
  });

  it('atomic replacement — 100-entry snapshot < 10 KB (AC-06)', async () => {
    const refs = Array.from({ length: 100 }, (_, i) =>
      i.toString(16).padStart(8, '0'),
    );
    // Write a first (empty) snapshot so we exercise the replace path.
    await writeListTodosSnapshot(planningRoot, {
      schema_version: 1,
      generated_at: '2026-05-17T10:00:00Z',
      filter: null,
      refs: [],
    });
    await writeListTodosSnapshot(planningRoot, {
      schema_version: 1,
      generated_at: '2026-05-17T10:00:01Z',
      filter: null,
      refs,
    });
    const st = await stat(snapshotPath);
    expect(st.size).toBeLessThan(10 * 1024);
    // No leftover temp file
    expect(await exists(`${snapshotPath}.tmp`)).toBe(false);
    const raw = await readFile(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.refs).toHaveLength(100);
  });

  it('Zod-rejects malformed snapshot BEFORE writing (no partial file)', async () => {
    await expect(
      writeListTodosSnapshot(planningRoot, {
        // @ts-expect-error — deliberately invalid (schema_version must be 1)
        schema_version: 2,
        generated_at: '2026-05-17T10:00:00Z',
        filter: null,
        refs: [],
      }),
    ).rejects.toThrow();
    expect(await exists(snapshotPath)).toBe(false);
    // No leftover temp either
    expect(await exists(`${snapshotPath}.tmp`)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// listTodosHandler
// ─────────────────────────────────────────────────────────────────────

describe('listTodosHandler', () => {
  it('default mode — prints list + writes snapshot with refs in display order', async () => {
    await writeFile(
      statePath,
      [
        '## Todos',
        '- [TODO] first (added 2026-05-17) (ref:11111111)',
        '- [TODO] second (added 2026-05-17) (ref:22222222)',
        '',
      ].join('\n'),
      'utf8',
    );
    const { io, out, err } = makeIO();
    const code = await listTodosHandler(
      { verb: 'list-todos', positionals: [], flags: {} },
      io,
    );
    expect(code).toBe(EXIT.SUCCESS);
    expect(err.text()).toBe('');
    expect(out.text()).toContain(' 1. ○ first (ref:11111111)');
    expect(out.text()).toContain(' 2. ○ second (ref:22222222)');
    const raw = await readFile(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.refs).toEqual(['11111111', '22222222']);
    expect(parsed.filter).toBeNull();
    expect(parsed.schema_version).toBe(1);
  });

  it('--filter phase=03 — prints filtered list + snapshot.filter = {phase: "03"} (AC-04)', async () => {
    await writeFile(
      statePath,
      [
        '## Todos',
        '- [TODO] off (added 2026-05-17) (ref:11111111) (phase:02)',
        '- [TODO] on (added 2026-05-17) (ref:22222222) (phase:03)',
        '',
      ].join('\n'),
      'utf8',
    );
    const { io, out, err } = makeIO();
    const code = await listTodosHandler(
      {
        verb: 'list-todos',
        positionals: [],
        flags: { filter: ['phase=03'] },
      },
      io,
    );
    expect(code).toBe(EXIT.SUCCESS);
    expect(err.text()).toBe('');
    expect(out.text()).toContain(' 1. ○ on (phase:03) (ref:22222222)');
    expect(out.text()).not.toContain('off');
    const parsed = JSON.parse(await readFile(snapshotPath, 'utf8'));
    expect(parsed.filter).toEqual({ phase: '03' });
    expect(parsed.refs).toEqual(['22222222']);
  });

  it('multiple --filter flags combine with AND', async () => {
    await writeFile(
      statePath,
      [
        '## Todos',
        '- [TODO] a (added 2026-05-17) (ref:11111111) (phase:03) (priority:low)',
        '- [TODO] b (added 2026-05-17) (ref:22222222) (phase:03) (priority:high)',
        '- [TODO] c (added 2026-05-17) (ref:33333333) (phase:02) (priority:high)',
        '',
      ].join('\n'),
      'utf8',
    );
    const { io, out } = makeIO();
    const code = await listTodosHandler(
      {
        verb: 'list-todos',
        positionals: [],
        flags: { filter: ['phase=03', 'priority=high'] },
      },
      io,
    );
    expect(code).toBe(EXIT.SUCCESS);
    expect(out.text()).toContain(' 1. ○ b');
    expect(out.text()).not.toContain('a (phase:03)');
    expect(out.text()).not.toContain('c (phase:02)');
    const parsed = JSON.parse(await readFile(snapshotPath, 'utf8'));
    expect(parsed.filter).toEqual({ phase: '03', priority: 'high' });
    expect(parsed.refs).toEqual(['22222222']);
  });

  it('--json — prints JSON to stdout, does NOT write snapshot (AC-05)', async () => {
    await writeFile(
      statePath,
      [
        '## Todos',
        '- [TODO] entry (added 2026-05-17) (ref:abcdef01) (phase:03)',
        '',
      ].join('\n'),
      'utf8',
    );
    const { io, out } = makeIO();
    const code = await listTodosHandler(
      { verb: 'list-todos', positionals: [], flags: { json: true } },
      io,
    );
    expect(code).toBe(EXIT.SUCCESS);
    const parsed = JSON.parse(out.text());
    expect(parsed.schema_version).toBe(1);
    expect(parsed.filter).toBeNull();
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toEqual({
      status: '[TODO]',
      description: 'entry',
      added_date: '2026-05-17',
      ref: 'abcdef01',
      phase: '03',
    });
    expect(await exists(snapshotPath)).toBe(false);
  });

  it('malformed --filter token → USAGE_ERROR, no snapshot write', async () => {
    await writeFile(
      statePath,
      `## Todos\n- [TODO] x (added 2026-05-17) (ref:abcdef01)\n`,
      'utf8',
    );
    const { io, err } = makeIO();
    const code = await listTodosHandler(
      {
        verb: 'list-todos',
        positionals: [],
        flags: { filter: ['noequals'] },
      },
      io,
    );
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(err.text()).toContain('bad --filter token');
    expect(err.text()).toContain('key=value');
    expect(await exists(snapshotPath)).toBe(false);
  });

  it('missing STATE.md → renders "(no todos)" + writes empty-refs snapshot, exit 0', async () => {
    expect(await exists(statePath)).toBe(false);
    const { io, out, err } = makeIO();
    const code = await listTodosHandler(
      { verb: 'list-todos', positionals: [], flags: {} },
      io,
    );
    expect(code).toBe(EXIT.SUCCESS);
    expect(err.text()).toBe('');
    expect(out.text()).toBe('(no todos)\n');
    const parsed = JSON.parse(await readFile(snapshotPath, 'utf8'));
    expect(parsed.refs).toEqual([]);
    expect(parsed.filter).toBeNull();
  });

  it('integration — todoHandler then listTodosHandler shows the entry', async () => {
    // 1. Seed via the Phase 02 verb.
    const todoIO = makeIO();
    const addCode = await todoHandler(
      { verb: 'todo', positionals: ['fix the login bug'], flags: {} },
      todoIO.io,
    );
    expect(addCode).toBe(EXIT.SUCCESS);
    const hash = computeTodoHash('fix the login bug');

    // 2. Read it back via Phase 03.
    const listIO = makeIO();
    const listCode = await listTodosHandler(
      { verb: 'list-todos', positionals: [], flags: {} },
      listIO.io,
    );
    expect(listCode).toBe(EXIT.SUCCESS);
    expect(listIO.out.text()).toContain(`(ref:${hash})`);
    expect(listIO.out.text()).toContain('fix the login bug');

    const parsed = JSON.parse(await readFile(snapshotPath, 'utf8'));
    expect(parsed.refs).toEqual([hash]);
  });

  it('AC-06 — snapshot < 10 KB for backlog of 100 todos via the handler path', async () => {
    // Seed 100 entries via the Phase 02 appender so the format is
    // canonically Phase-02-produced.
    for (let i = 0; i < 100; i++) {
      const description = `bulk todo number ${i}`;
      const hash = computeTodoHash(description);
      await appendTodoToState({
        statePath,
        description,
        hash,
        addedDate: '2026-05-17',
      });
    }
    const { io } = makeIO();
    const code = await listTodosHandler(
      { verb: 'list-todos', positionals: [], flags: {} },
      io,
    );
    expect(code).toBe(EXIT.SUCCESS);
    const st = await stat(snapshotPath);
    expect(st.size).toBeLessThan(10 * 1024);
    const parsed = JSON.parse(await readFile(snapshotPath, 'utf8'));
    expect(parsed.refs).toHaveLength(100);
  });
});
