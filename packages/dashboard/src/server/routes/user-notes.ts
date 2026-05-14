import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { UserNotesUpdateBodySchema, type UserNotesSnapshot } from '@swt-labs/shared';
import type { Hono } from 'hono';

import type { EventBus } from '../event-bus.js';

const PLANNING_DIR = '.swt-planning';
const NOTES_FILENAME = 'USER_NOTES.md';

/**
 * Registers the User Notes routes. User Notes is a freeform per-project
 * scratchpad backed by a single plain-text file at
 * `<cwd>/.swt-planning/USER_NOTES.md` — resolved cwd-relative exactly like
 * `registerConfigRoute` resolves `config.json`.
 *
 * The card is DELIBERATELY decoupled from the methodology artifacts: it is a
 * personal single-editor scratchpad, so the POST route does NOT publish an
 * SSE `state.changed` event (no cross-panel coupling) and the client does NOT
 * put it on the tools poll loop (polling would clobber in-progress typing).
 *
 * `GET /api/user-notes` — read the file; ENOENT (greenfield, file never
 * saved) returns a 200 `{notes:'', exists:false}` envelope so the panel
 * renders an empty textarea rather than blanking out. A non-ENOENT read
 * error (permissions, etc.) is a real problem the user needs to see → 500.
 *
 * `POST /api/user-notes` — body validated via `UserNotesUpdateBodySchema`
 * (400 typed-error envelope on failure, incl. the 1 MB over-cap string);
 * `mkdir -p` the `.swt-planning/` dir on demand for greenfield daemons, then
 * atomically write `USER_NOTES.md`. No `state.changed` SSE event.
 *
 * Same no-extra-gate posture as `/api/config` — no `DashboardPermissionGate`
 * routing; a localhost-only daemon's user-initiated direct UI mutation
 * follows the existing `/api/init` / `/api/config` pattern.
 */
export function registerUserNotesRoute(app: Hono, cwd: string, _bus?: EventBus): void {
  const notesPath = join(cwd, PLANNING_DIR, NOTES_FILENAME);

  app.get('/api/user-notes', async (c) => {
    let raw: string;
    try {
      raw = await readFile(notesPath, 'utf8');
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT') {
        const response: UserNotesSnapshot = {
          notes: '',
          exists: false,
          generated_at: new Date().toISOString(),
        };
        return c.json(response);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'user_notes_read_failed', detail: message }, 500);
    }
    const response: UserNotesSnapshot = {
      notes: raw,
      exists: true,
      generated_at: new Date().toISOString(),
    };
    return c.json(response);
  });

  app.post('/api/user-notes', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = UserNotesUpdateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_user_notes_body', detail: parsed.error.flatten() }, 400);
    }
    try {
      // Greenfield directories don't have .swt-planning/ yet; create on
      // demand so the first save doesn't crash with ENOENT.
      await mkdir(dirname(notesPath), { recursive: true });
      await writeFile(notesPath, parsed.data.notes, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'user_notes_write_failed', detail: message }, 500);
    }
    // No state.changed SSE event — User Notes is a personal single-editor
    // scratchpad, kept isolated from the methodology panels by design.
    return c.json({ ok: true, generated_at: new Date().toISOString() });
  });
}
