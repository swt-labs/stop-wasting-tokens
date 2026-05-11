/**
 * Result harvester — reads `swt-task-result` custom entries from a Pi
 * session and validates against `TaskResultSchema`.
 *
 * Per ADR-002: the dispatched agent calls `swt_report_result`, which
 * persists a `custom` session entry via closure-captured `pi.appendEntry`.
 * The harvester is the orchestrator-side counterpart: it reads the JSONL
 * session file (or a pre-loaded entry list), finds the LAST
 * `swt-task-result` entry, and Zod-validates it. Multiple entries can
 * appear only when the defensive `agent_end` placeholder fires AFTER the
 * agent's own call — in that race, the agent's call wins because it ran
 * first; the placeholder hook checks for an existing entry and is a no-op
 * when present. The harvester defends against the inverse race anyway
 * by selecting the LAST entry, since the placeholder hook always writes
 * `protocol-violation` blockers that a real result wouldn't.
 *
 * PR-09 ships the harvester with two entry points:
 *
 *   - `harvestTaskResult(sessionFilePath)` — reads a JSONL file.
 *   - `harvestTaskResultFromEntries(entries)` — reads from an in-memory
 *     entry list (used by tests + the mock Pi shim in PR-09's
 *     integration test).
 *
 * Both throw `MissingTaskResultError` if no entry is present, and let
 * Zod's validation error bubble up if the entry is malformed.
 */

import { readFileSync } from 'node:fs';

import { TaskResultSchema, type TaskResultSchemaT } from '@swt-labs/shared';

export interface PiSessionEntryLike {
  readonly type: string;
  readonly customType?: string;
  readonly data?: unknown;
}

export class MissingTaskResultError extends Error {
  constructor(public readonly source: string) {
    super(
      `Harvest failed: no swt-task-result custom entry found in ${source}. The agent must call swt_report_result before stopping; the defensive agent_end hook should also have written a placeholder.`,
    );
    this.name = 'MissingTaskResultError';
  }
}

/**
 * Parse a Pi session JSONL file. Tolerant of blank lines + non-`custom`
 * entries (Pi journals interleave message/tool entries alongside customs).
 */
export function readSessionEntries(sessionFilePath: string): PiSessionEntryLike[] {
  const raw = readFileSync(sessionFilePath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const out: PiSessionEntryLike[] = [];
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
        out.push(parsed as PiSessionEntryLike);
      }
    } catch {
      // Skip malformed lines silently — Pi sometimes interleaves partial
      // writes during a crash. The harvester is best-effort recovery.
    }
  }
  return out;
}

/**
 * Find the last `swt-task-result` entry in an entry list and validate it
 * via `TaskResultSchema`. Returns the parsed result.
 */
export function harvestTaskResultFromEntries(
  entries: ReadonlyArray<PiSessionEntryLike>,
  source = 'in-memory entries',
): TaskResultSchemaT {
  // Scan backwards — the LAST entry wins. Using a manual loop avoids
  // requiring `findLast` (Node ≥ 18) on consumers; the orchestration
  // package targets the runtime's Node 20 minimum either way.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined) continue;
    if (entry.type === 'custom' && entry.customType === 'swt-task-result') {
      return TaskResultSchema.parse(entry.data);
    }
  }
  throw new MissingTaskResultError(source);
}

/**
 * Read + validate the last `swt-task-result` entry from a Pi session
 * JSONL file. Top-level entry point used by the dispatcher after
 * `agent_end`.
 */
export function harvestTaskResult(sessionFilePath: string): TaskResultSchemaT {
  const entries = readSessionEntries(sessionFilePath);
  return harvestTaskResultFromEntries(entries, sessionFilePath);
}
