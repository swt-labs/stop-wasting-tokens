/**
 * Session journal extension — mirrors SwtEvents into a per-day JSONL file.
 *
 * The file lives at `<cwd>/.swt-planning/journal/<YYYY-MM-DD>.jsonl`. Each
 * line is a single SwtEvent payload + a wallclock timestamp. M3 uses
 * this to reconstruct in-flight task state after a crash.
 *
 * PR-09 ships the journal sink + extension factory. The orchestrator
 * loads it alongside `result-protocol` so every dispatched session has a
 * durable event log on disk. Tests inject a `MemoryJournalSink` to
 * assert against the recorded events without touching the filesystem.
 *
 * Privacy: SwtEvents already strip raw prompt/tool-output text (the
 * `MESSAGE_DELTA` event carries the streamed assistant text, which is
 * model output, not user input). The journal therefore never carries
 * the user's prompt verbatim — only the dispatched agent's output.
 * Operators who don't want output in the journal can disable it via
 * `loadJournalExtension({ disabled: true })`.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { mapPiEvent } from '../events.js';
import type { SwtEvent } from '../types.js';

import type { JournalSink, PiExtensionAPI, PiExtensionContext } from './pi-types.js';

/**
 * Filesystem-backed sink. Lazy-creates the directory on first write.
 */
export class FileJournalSink implements JournalSink {
  private initialized = false;

  constructor(public readonly filePath: string) {}

  write(event: SwtEvent): void {
    if (!this.initialized) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.initialized = true;
    }
    const line = JSON.stringify({ at: new Date().toISOString(), event }) + '\n';
    appendFileSync(this.filePath, line, 'utf8');
  }

  close(): void {
    // append-mode writes flush per call; nothing to do here. Kept on the
    // interface so async-flushing sinks (e.g., a remote shipper) can hook in.
  }
}

/**
 * In-memory sink for tests. Stores every event in an array.
 */
export class MemoryJournalSink implements JournalSink {
  public readonly events: SwtEvent[] = [];

  write(event: SwtEvent): void {
    this.events.push(event);
  }

  close(): void {
    // no-op
  }
}

export interface JournalExtensionOptions {
  /** Skip extension wiring entirely — operator opt-out. */
  readonly disabled?: boolean;
  /**
   * Injectable sink for tests. Defaults to a `FileJournalSink` pointed at
   * `<cwd>/.swt-planning/journal/<today>.jsonl`.
   */
  readonly sink?: JournalSink;
  /**
   * Override the per-day file path resolver. Defaults to
   * `cwd/.swt-planning/journal/<YYYY-MM-DD>.jsonl`.
   */
  readonly resolvePath?: (cwd: string, today: Date) => string;
}

function defaultJournalPath(cwd: string, today: Date): string {
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, '0');
  const d = String(today.getUTCDate()).padStart(2, '0');
  return join(cwd, '.swt-planning', 'journal', `${y}-${m}-${d}.jsonl`);
}

const PI_EVENTS_TO_MIRROR: ReadonlyArray<string> = [
  'agent_start',
  'agent_end',
  'message_update',
  'tool_execution_start',
  'tool_execution_end',
  'turn_end',
];

/**
 * Build the extension factory. The factory captures the sink in closure
 * so all event handlers share the same sink instance for the lifetime of
 * the session.
 */
export function buildJournalExtension(
  opts: JournalExtensionOptions = {},
): (pi: PiExtensionAPI) => void {
  if (opts.disabled === true) {
    return (_pi: PiExtensionAPI): void => {
      /* no-op */
    };
  }
  const resolvePath = opts.resolvePath ?? defaultJournalPath;
  return function journalExtension(pi: PiExtensionAPI): void {
    let sink: JournalSink | undefined = opts.sink;

    function ensureSink(ctx: PiExtensionContext): JournalSink {
      if (sink !== undefined) return sink;
      sink = new FileJournalSink(resolvePath(ctx.cwd, new Date()));
      return sink;
    }

    for (const piEventName of PI_EVENTS_TO_MIRROR) {
      pi.on(piEventName, (raw, ctx) => {
        const mapped: SwtEvent | undefined = mapPiEvent(raw, getSessionIdFromCtx(ctx, raw));
        if (mapped === undefined) return;
        ensureSink(ctx).write(mapped);
      });
    }
  };
}

function getSessionIdFromCtx(_ctx: PiExtensionContext, raw: unknown): string {
  // Pi events carry `sessionId` on the raw payload. Prefer that; fall
  // back to `'unknown'` so a missing-field journal entry still parses.
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as { readonly sessionId?: unknown };
    if (typeof r.sessionId === 'string') return r.sessionId;
  }
  return 'unknown';
}

/**
 * Default export — Pi extension-loader convention.
 */
export default buildJournalExtension();
