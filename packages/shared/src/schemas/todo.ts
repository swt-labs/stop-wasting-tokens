/**
 * Plan 15-02-01 (Phase 2) — Zod schema for the `swt todo` verb's
 * sidecar file (`.swt-planning/todo-details.json`) + the canonical
 * STATE.md `## Todos` line prefix.
 *
 * The schema lives in shared (L0) so the dashboard, methodology layer,
 * and any future tooling can typecheck against it without depending on
 * the CLI package. The verb handler (`packages/cli/src/commands/todo.ts`)
 * and helper (`packages/cli/src/lib/todo-state.ts`) compute the hash key
 * (sha256(description).slice(0, 8)) — `node:crypto` belongs in the CLI
 * layer and is intentionally NOT imported here. The schema's
 * `TodoDetailsFileSchema.todos` record key is a runtime regex that
 * documents the hash contract (8 hex chars, optionally with a `-N`
 * collision suffix per CONTEXT.md "Hash collision" decision).
 */

import { z } from 'zod';

/** Allowed `--priority` values for the `swt todo` verb. */
export const TODO_PRIORITY_VALUES = ['high', 'medium', 'low'] as const;
export type TodoPriority = (typeof TODO_PRIORITY_VALUES)[number];

/**
 * One backlog entry persisted to `.swt-planning/todo-details.json`. The
 * `description` is the same string echoed into the STATE.md `## Todos`
 * line; `detail`, `files`, `phase`, `priority`, `assignee` are the
 * optional sidecar fields driven by the verb's flag surface.
 */
export const TodoDetailSchema = z.object({
  description: z.string().min(3),
  detail: z.string().optional(),
  phase: z
    .string()
    .regex(/^[0-9]{2}$/)
    .optional(),
  files: z.array(z.string()).optional(),
  priority: z.enum(TODO_PRIORITY_VALUES).optional(),
  assignee: z.string().optional(),
  created_at: z.string(), // ISO 8601 timestamp
});
export type TodoDetail = z.infer<typeof TodoDetailSchema>;

/**
 * The top-level shape of `.swt-planning/todo-details.json`. Keys in
 * `todos` MUST be 8-char hex (sha256 prefix of the description) optionally
 * followed by `-N` for collision suffix.
 */
export const TodoDetailsFileSchema = z.object({
  schema_version: z.literal(1),
  todos: z.record(z.string().regex(/^[0-9a-f]{8}(-[0-9]+)?$/), TodoDetailSchema),
});
export type TodoDetailsFile = z.infer<typeof TodoDetailsFileSchema>;

/**
 * Canonical STATE.md `## Todos` entry prefix. The full line format is:
 *   `- [TODO] {description} (added {YYYY-MM-DD}) (ref:HASH) [(phase:NN)] [(priority:X)] [(assignee:USER)]`
 *
 * Phase 03 (`list-todos`) maps the bracket prefix to a status icon:
 *   `[TODO]` → ○, `[IN-PROGRESS]` → ◆, `[BLOCKED]` → ✗, `[DONE]` → ✓.
 *
 * Bracketed annotations after `(ref:HASH)` are optional and appended in
 * the stable order documented above.
 */
export const TODO_LINE_PREFIX = '- [TODO]';

/**
 * Plan 03-01 T1 — read-side schemas for the `swt list-todos` verb.
 *
 * The schemas below are ADDITIVE to the Phase 02 surface above. They
 * describe (a) the parsed shape of a single `## Todos` line, (b) the
 * session-snapshot file written to `.swt-planning/.cache/list-todos-snapshot.json`
 * that Phase 04's bare-integer cook resolver will consume, and (c) the
 * separate JSON-output envelope emitted by `swt list-todos --json`
 * (which carries full `entries` instead of `refs`).
 *
 * Locating these in shared (L0) keeps the dashboard, methodology layer,
 * and any future tooling able to typecheck against them without taking
 * a dep on the CLI package.
 */

/**
 * The four possible bracket-prefix tags a `## Todos` line can carry.
 * Phase 02 only writes `[TODO]`; the other three are forward-compatible
 * with a future status-change verb (out of scope for milestone 15).
 */
export const TodoStatusSchema = z.enum(['[TODO]', '[IN-PROGRESS]', '[BLOCKED]', '[DONE]']);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

/**
 * Parsed shape of a single `## Todos` line. Mirrors the canonical line
 * format documented at `TODO_LINE_PREFIX`. The `ref` field is the 8-char
 * sha256 prefix of the description (optionally suffixed with `-N` for
 * the collision-resolution case Phase 02 reserves). Optional annotation
 * fields are present when their bracketed suffix is on the source line.
 */
export const TodoEntrySchema = z.object({
  status: TodoStatusSchema,
  description: z.string().min(1),
  added_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ref: z.string().regex(/^[0-9a-f]{8}(-[0-9]+)?$/),
  phase: z
    .string()
    .regex(/^[0-9]{2}$/)
    .optional(),
  priority: z.enum(TODO_PRIORITY_VALUES).optional(),
  assignee: z.string().optional(),
});
export type TodoEntry = z.infer<typeof TodoEntrySchema>;

/**
 * Session-snapshot file written to `.swt-planning/.cache/list-todos-snapshot.json`
 * by `swt list-todos` (default mode; `--json` skips the file write).
 * `refs` is the ordered list of 8-char hash refs that match the
 * displayed numbering — Phase 04's bare-integer resolver picks
 * `refs[N - 1]` for `swt cook N`. `filter` is `null` when no
 * `--filter` flag was applied, and a non-null `Record<string,string>`
 * when at least one filter was applied.
 */
export const ListTodosSnapshotSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string(),
  filter: z.record(z.string(), z.string()).nullable(),
  refs: z.array(z.string().regex(/^[0-9a-f]{8}(-[0-9]+)?$/)).readonly(),
});
export type ListTodosSnapshot = z.infer<typeof ListTodosSnapshotSchema>;

/**
 * Machine-readable JSON envelope emitted to stdout by `swt list-todos --json`.
 * This is a SEPARATE schema from `ListTodosSnapshotSchema` (research §Risks
 * option (a)): the snapshot file carries hash-only `refs` for fast
 * Phase 04 lookup, while the `--json` payload carries full `entries`
 * for downstream tooling that wants the parsed records directly.
 * `filter` and `generated_at` shapes match the snapshot to keep parsing
 * uniform across both surfaces.
 */
export const ListTodosJsonOutputSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string(),
  filter: z.record(z.string(), z.string()).nullable(),
  entries: z.array(TodoEntrySchema),
});
export type ListTodosJsonOutput = z.infer<typeof ListTodosJsonOutputSchema>;
