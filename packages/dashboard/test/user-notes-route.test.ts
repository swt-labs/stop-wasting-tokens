/**
 * `registerUserNotesRoute` coverage — the User Notes scratchpad route.
 *
 * Mirrors `config-route.test.ts`'s harness: a fresh temp dir as the
 * daemon cwd per test, a real `Hono` app, a subscribed `EventBus` whose
 * listener is asserted to confirm the route publishes NO SSE event (User
 * Notes is a deliberately-isolated personal file — no cross-panel
 * coupling).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UserNotesSnapshotSchema, UserNotesUpdateResponseSchema } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.ts';
import { registerUserNotesRoute } from '../src/server/routes/user-notes.ts';

let cwd: string;
let app: Hono;
let bus: EventBus;
let busListener: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'swt-user-notes-route-'));
  app = new Hono();
  bus = createEventBus();
  busListener = vi.fn();
  bus.subscribe(busListener);
  registerUserNotesRoute(app, cwd, bus);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  app = new Hono();
});

const notesPath = (): string => join(cwd, '.swt-planning', 'USER_NOTES.md');

function writeNotes(content: string): void {
  mkdirSync(join(cwd, '.swt-planning'), { recursive: true });
  writeFileSync(notesPath(), content, 'utf8');
}

async function getNotes(): Promise<{ status: number; body: unknown }> {
  const res = await app.request('/api/user-notes', { method: 'GET' });
  return { status: res.status, body: await res.json() };
}

async function postNotes(body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await app.request('/api/user-notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('GET /api/user-notes', () => {
  it('returns {notes:"", exists:false} on greenfield (file never saved)', async () => {
    const { status, body } = await getNotes();
    expect(status).toBe(200);
    const parsed = UserNotesSnapshotSchema.parse(body);
    expect(parsed.notes).toBe('');
    expect(parsed.exists).toBe(false);
    // generated_at round-trips through Date — proves it's a real datetime.
    expect(Number.isFinite(new Date(parsed.generated_at).getTime())).toBe(true);
  });

  it('returns {notes:<content>, exists:true} when USER_NOTES.md exists', async () => {
    writeNotes('remember to check the rate-card\n- and the cassettes');
    const { status, body } = await getNotes();
    expect(status).toBe(200);
    const parsed = UserNotesSnapshotSchema.parse(body);
    expect(parsed.notes).toBe('remember to check the rate-card\n- and the cassettes');
    expect(parsed.exists).toBe(true);
  });

  it('preserves an empty saved file as exists:true with notes:""', async () => {
    // An empty file is distinct from a missing one — exists must be true.
    writeNotes('');
    const { status, body } = await getNotes();
    expect(status).toBe(200);
    const parsed = UserNotesSnapshotSchema.parse(body);
    expect(parsed.notes).toBe('');
    expect(parsed.exists).toBe(true);
  });

  it('does NOT publish any SSE event on a GET', async () => {
    await getNotes();
    expect(busListener).not.toHaveBeenCalled();
  });
});

describe('POST /api/user-notes', () => {
  it('writes USER_NOTES.md and returns {ok:true, generated_at}', async () => {
    const { status, body } = await postNotes({ notes: 'my project notes' });
    expect(status).toBe(200);
    const parsed = UserNotesUpdateResponseSchema.parse(body);
    expect(parsed.ok).toBe(true);
    expect(Number.isFinite(new Date(parsed.generated_at).getTime())).toBe(true);
    // The file actually landed on disk with the exact content.
    expect(existsSync(notesPath())).toBe(true);
    expect(readFileSync(notesPath(), 'utf8')).toBe('my project notes');
  });

  it('creates .swt-planning/ on demand for greenfield daemons', async () => {
    expect(existsSync(join(cwd, '.swt-planning'))).toBe(false);
    const { status } = await postNotes({ notes: 'first ever note' });
    expect(status).toBe(200);
    expect(existsSync(notesPath())).toBe(true);
  });

  it('overwrites an existing notes file', async () => {
    writeNotes('old content');
    const { status } = await postNotes({ notes: 'new content' });
    expect(status).toBe(200);
    expect(readFileSync(notesPath(), 'utf8')).toBe('new content');
  });

  it('accepts an empty-string notes body (clearing the scratchpad)', async () => {
    writeNotes('something');
    const { status, body } = await postNotes({ notes: '' });
    expect(status).toBe(200);
    expect(UserNotesUpdateResponseSchema.parse(body).ok).toBe(true);
    expect(readFileSync(notesPath(), 'utf8')).toBe('');
  });

  it('returns 400 invalid_user_notes_body when the body is structurally wrong', async () => {
    const { status, body } = await postNotes({ wrong: 'shape' });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('invalid_user_notes_body');
  });

  it('returns 400 when the body carries an extra field (.strict())', async () => {
    const { status, body } = await postNotes({ notes: 'ok', extra: 'nope' });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('invalid_user_notes_body');
  });

  it('returns 400 when notes is not a string', async () => {
    const { status, body } = await postNotes({ notes: 12345 });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('invalid_user_notes_body');
  });

  it('returns 400 when the notes string exceeds the 1 MB cap', async () => {
    // 1_000_001 chars — one past the schema's z.string().max(1_000_000).
    const oversized = 'x'.repeat(1_000_001);
    const { status, body } = await postNotes({ notes: oversized });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('invalid_user_notes_body');
    // Nothing was written — the over-cap body is rejected before writeFile.
    expect(existsSync(notesPath())).toBe(false);
  });

  it('accepts a notes string exactly at the 1 MB cap', async () => {
    const atCap = 'y'.repeat(1_000_000);
    const { status } = await postNotes({ notes: atCap });
    expect(status).toBe(200);
    expect(readFileSync(notesPath(), 'utf8')).toBe(atCap);
  });

  it('does NOT publish any SSE event on a successful POST (isolated scratchpad)', async () => {
    await postNotes({ notes: 'isolated from the methodology panels' });
    expect(busListener).not.toHaveBeenCalled();
  });

  it('does NOT publish any SSE event when validation fails', async () => {
    await postNotes({ wrong: 'shape' });
    expect(busListener).not.toHaveBeenCalled();
  });
});
