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
