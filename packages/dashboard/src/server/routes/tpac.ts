/**
 * `GET /api/tpac/sse` — TPAC report history per TDD2 §12.3.5 + Plan
 * 04-01 PR-37.
 *
 * The `swt bench` verb (M2 PR-21 + M3 PR-T live emit) writes a
 * `TpacReport` JSON to `--output <file>`. Operators can park those
 * outputs under `<projectRoot>/.swt-planning/.tpac/*.json` to build a
 * historical timeline. This route reads the directory on connect,
 * emits a `tpac.snapshot` frame with the full ordered list of
 * reports, and chokidar-watches for new files (re-emits the snapshot
 * when a new report lands).
 *
 * The panel renders the latest report card + (when ≥ 2 reports
 * exist) a comparison arrow against the earliest one. The M4 EXIT
 * GATE target check (TPAC −40% vs M2 baseline) is human-driven from
 * the panel today; PR-36 will gate merges on it once cassettes +
 * fixture spec are in place.
 *
 * Empty state when `projectRoot === null` (greenfield daemon) OR when
 * the `.tpac/` directory doesn't exist OR is empty. The panel renders
 * "No TPAC measurements yet" in that case.
 *
 * Schema-validated: each `*.json` file under `.tpac/` is parsed +
 * checked against `TpacReportSchema`; invalid files are skipped (the
 * dashboard never crashes on corrupt data).
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { type TpacReport, TpacReportSchema } from '@swt-labs/shared';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { createFileTailer } from '../lib/tail-file.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface TpacSnapshotFrame {
  readonly type: 'tpac.snapshot';
  readonly ts: string;
  readonly reports: ReadonlyArray<TpacReport>;
}

export function registerTpacRoute(app: Hono, projectRoot: string | null): void {
  app.get('/api/tpac/sse', (c) =>
    streamSSE(c, async (stream) => {
      let closed = false;
      let tailer: { close(): Promise<void> } | null = null;

      const emit = async (): Promise<void> => {
        if (closed) return;
        const reports =
          projectRoot !== null
            ? await readTpacReports(path.join(projectRoot, '.swt-planning', '.tpac'))
            : [];
        const frame: TpacSnapshotFrame = {
          type: 'tpac.snapshot',
          ts: new Date().toISOString(),
          reports,
        };
        await stream.writeSSE({
          event: frame.type,
          data: JSON.stringify(frame),
        });
      };

      const finish = (): void => {
        if (closed) return;
        closed = true;
        if (tailer !== null) {
          void tailer.close();
          tailer = null;
        }
      };

      stream.onAbort(finish);

      await emit();

      // Watch the directory for new reports when a project root is wired.
      if (projectRoot !== null) {
        const tpacDir = path.join(projectRoot, '.swt-planning', '.tpac');
        const fileTailer = createFileTailer({
          pattern: path.join(tpacDir, '*.json'),
          // The tailer is designed for JSONL append-only; for whole-file
          // TpacReport.json drops we just re-emit on any change.
          onLine: () => {
            void emit();
          },
        });
        await fileTailer.ready;
        tailer = fileTailer;
      }

      const heartbeat = setInterval(() => {
        if (closed) return;
        stream.writeSSE({ data: '', event: 'keep-alive' }).catch(() => finish());
      }, HEARTBEAT_INTERVAL_MS);

      try {
        while (!closed) {
          await new Promise((r) => setTimeout(r, 200));
        }
      } finally {
        clearInterval(heartbeat);
        finish();
      }
    }),
  );
}

/**
 * Read every `*.json` file under `<projectRoot>/.swt-planning/.tpac/`,
 * validate against `TpacReportSchema`, skip invalid files. Returns
 * the ordered list sorted by `recorded_at` ascending (so the panel
 * can do baseline = reports[0], latest = reports[last]).
 */
async function readTpacReports(tpacDir: string): Promise<ReadonlyArray<TpacReport>> {
  let entries: string[];
  try {
    entries = await readdir(tpacDir);
  } catch {
    return [];
  }
  const reports: TpacReport[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(tpacDir, name);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const result = TpacReportSchema.safeParse(parsed);
    if (!result.success) continue;
    reports.push(result.data);
  }
  return reports.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}
