import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { WorktreeJournalEntry } from '@swt-labs/shared';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { createFileTailer } from '../lib/tail-file.js';

/**
 * `GET /api/worktrees/sse` — live worktree FSM state stream per TDD2 §9.1 +
 * Plan 03-04 PR-27.
 *
 * The orchestration layer's `WorktreeManager` writes one JSON entry per
 * state transition to `.swt-planning/journal/wt-<taskId>.jsonl`. This route
 * exposes those journal entries to the dashboard's Worktrees panel without
 * coupling the panel to a chokidar/file-watching surface.
 *
 * Wire pattern:
 *
 *  1. On connect, scan `<projectRoot>/.swt-planning/journal/` for every
 *     `wt-*.jsonl` file. The LAST valid JSON line per file is the current
 *     state. Emit a `worktree.snapshot` SSE frame with the resulting
 *     `Record<taskId, WorktreeJournalEntry>` map.
 *  2. Tail the journal dir via `createFileTailer`. Every new line is
 *     parsed + duck-typed (skips invalid) and emitted as a
 *     `worktree.update` SSE frame.
 *  3. Heartbeat every 30s + abort handler closes the tailer.
 *
 * When `projectRoot === null` (greenfield daemon), the route registers
 * but returns HTTP 503 — the panel renders an empty state in that case.
 */

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_QUEUE = 1000;

export interface WorktreeSnapshotFrame {
  readonly type: 'worktree.snapshot';
  readonly ts: string;
  readonly worktrees: Readonly<Record<string, WorktreeJournalEntry>>;
}

export interface WorktreeUpdateFrame {
  readonly type: 'worktree.update';
  readonly ts: string;
  readonly entry: WorktreeJournalEntry;
}

export function registerWorktreesRoute(app: Hono, projectRoot: string | null): void {
  app.get('/api/worktrees/sse', (c) => {
    if (projectRoot === null) {
      return c.text('worktrees panel requires a project root', 503);
    }
    const journalDir = path.join(projectRoot, '.swt-planning', 'journal');

    return streamSSE(c, async (stream) => {
      let closed = false;
      const queue: WorktreeUpdateFrame[] = [];
      let resolveNext: ((frame: WorktreeUpdateFrame | null) => void) | null = null;

      const initialSnapshot = await readJournalSnapshot(journalDir);
      const snapshotFrame: WorktreeSnapshotFrame = {
        type: 'worktree.snapshot',
        ts: new Date().toISOString(),
        worktrees: initialSnapshot,
      };
      await stream.writeSSE({
        event: snapshotFrame.type,
        data: JSON.stringify(snapshotFrame),
      });

      // Dedup: track the last-emitted entry timestamp per taskId so the
      // tailer's initial-scan `add` events (which replay every existing
      // line) don't double-emit lines already covered by the snapshot
      // frame. New entries are emitted only when their timestamp is
      // strictly greater than the snapshot's last-known timestamp for
      // that taskId.
      const lastTsByTask = new Map<string, string>();
      for (const [taskId, entry] of Object.entries(initialSnapshot)) {
        lastTsByTask.set(taskId, entry.timestamp);
      }

      const tailer = createFileTailer({
        pattern: path.join(journalDir, '*.jsonl'),
        onLine: (line) => {
          if (closed) return;
          const entry = parseJournalEntry(line);
          if (entry === null) return;
          const lastTs = lastTsByTask.get(entry.taskId);
          if (lastTs !== undefined && entry.timestamp <= lastTs) return;
          lastTsByTask.set(entry.taskId, entry.timestamp);
          const frame: WorktreeUpdateFrame = {
            type: 'worktree.update',
            ts: new Date().toISOString(),
            entry,
          };
          if (resolveNext !== null) {
            const fn = resolveNext;
            resolveNext = null;
            fn(frame);
          } else {
            if (queue.length >= MAX_QUEUE) queue.shift();
            queue.push(frame);
          }
        },
      });

      await tailer.ready;

      const finish = (): void => {
        if (closed) return;
        closed = true;
        if (resolveNext !== null) {
          resolveNext(null);
          resolveNext = null;
        }
        void tailer.close();
      };

      stream.onAbort(finish);

      const heartbeat = setInterval(() => {
        if (closed) return;
        stream.writeSSE({ data: '', event: 'keep-alive' }).catch(() => finish());
      }, HEARTBEAT_INTERVAL_MS);

      try {
        while (!closed) {
          let nextFrame: WorktreeUpdateFrame | null;
          const queued = queue.shift();
          if (queued) {
            nextFrame = queued;
          } else {
            nextFrame = await new Promise<WorktreeUpdateFrame | null>((resolve) => {
              resolveNext = resolve;
            });
          }
          if (nextFrame === null) break;
          await stream.writeSSE({
            event: nextFrame.type,
            data: JSON.stringify(nextFrame),
          });
        }
      } finally {
        clearInterval(heartbeat);
        finish();
      }
    });
  });
}

/**
 * Walk `<journalDir>/wt-*.jsonl`, read each file, take the LAST valid JSON
 * line as the worktree's current state. Returns a map keyed by taskId.
 *
 * Silent on missing dir / unreadable files — the panel renders empty in
 * those cases, which is the correct UX for a greenfield project.
 */
async function readJournalSnapshot(
  journalDir: string,
): Promise<Record<string, WorktreeJournalEntry>> {
  const result: Record<string, WorktreeJournalEntry> = {};
  let entries: string[];
  try {
    entries = await readdir(journalDir);
  } catch {
    return result;
  }
  for (const filename of entries) {
    if (!/^wt-.+\.jsonl$/.test(filename)) continue;
    let raw: string;
    try {
      raw = await readFile(path.join(journalDir, filename), 'utf8');
    } catch {
      continue;
    }
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    // Last valid entry wins. Walk backwards so a tail-corrupted file still
    // surfaces the most-recent legitimate state.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line === undefined) continue;
      const entry = parseJournalEntry(line);
      if (entry !== null) {
        result[entry.taskId] = entry;
        break;
      }
    }
  }
  return result;
}

/**
 * Duck-type validation. A `WorktreeJournalEntrySchema` Zod schema isn't in
 * `@swt-labs/shared` yet (the type is hand-rolled at PR-22); this route
 * accepts any object with the required string fields and a known `to`
 * state. Unknown extra fields pass through unchanged.
 */
function parseJournalEntry(line: string): WorktreeJournalEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['timestamp'] !== 'string') return null;
  if (typeof obj['taskId'] !== 'string') return null;
  if (typeof obj['from'] !== 'string') return null;
  if (typeof obj['to'] !== 'string') return null;
  return obj as unknown as WorktreeJournalEntry;
}
