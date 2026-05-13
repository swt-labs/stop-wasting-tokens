import { mkdirSync, createWriteStream, existsSync, type WriteStream } from 'node:fs';
import path from 'node:path';

import { resolveSessionId } from '@swt-labs/runtime';

/** Subset of {@link CliEvent} fields shared by every emitted event. */
interface BaseEvent {
  ts: string;
}

export type CliEvent =
  | (BaseEvent & {
      type: 'agent.spawn';
      agent: string;
      phase: string;
      plan: string | null;
    })
  | (BaseEvent & {
      type: 'agent.complete';
      agent: string;
      phase: string;
      plan: string | null;
      tokens_in: number;
      tokens_out: number;
      cost_usd: number;
      duration_ms: number;
      artifact: string | null;
    })
  | (BaseEvent & {
      type: 'phase.transition';
      phase: string;
      from: string;
      to: string;
    })
  | (BaseEvent & {
      type: 'qa_gate';
      phase: string;
      routing: string;
      passed: number;
      total: number;
    })
  | (BaseEvent & {
      type: 'log.append';
      channel: 'stdout' | 'stderr';
      line: string;
    });

export interface CliEventBusOptions {
  /** Directory containing `.swt-planning/`. */
  projectRoot: string;
  /**
   * Session ID — used as the JSONL filename. When omitted, defaults to the
   * shared `swt:sessionId()` resolved by `@swt-labs/runtime`, which is the
   * same UUID populated on `process.env.SWT_SESSION_ID` at CLI bootstrap
   * via `applyEnvToProcess()`. This guarantees that
   * `.swt-planning/.events/{sessionId}.jsonl` shares its session ID with
   * every Pi session and bash script spawned by the same CLI invocation.
   */
  sessionId?: string;
  /** Batched flush window in ms. Default 50. Set 0 for synchronous flush per emit. */
  bufferMs?: number;
}

export interface CliEventBus {
  /** Add an event to the buffered queue. Returns immediately. */
  emit(event: CliEvent): void;
  /** Flush pending events and close the underlying stream. Idempotent. */
  close(): Promise<void>;
  /** Path of the JSONL file this bus is writing to. */
  readonly path: string;
  /** Session ID used as the file basename (without `.jsonl`). */
  readonly sessionId: string;
}

const PLANNING_DIR = '.swt-planning';
const EVENTS_DIR = '.events';
const DEFAULT_BUFFER_MS = 50;

/**
 * Construct a buffered, append-only JSONL emitter scoped to a single CLI
 * invocation. Lines are flushed to disk every `bufferMs` (default 50ms) or on
 * `close()`. Each event becomes one JSON line.
 *
 * The filename is `{projectRoot}/.swt-planning/.events/{sessionId}.jsonl`.
 * The directory is created on first emit if it does not exist.
 */
export function createCliEventBus(options: CliEventBusOptions): CliEventBus {
  // ADR-009: emit POSIX-separator paths so consumers can match on `/`-style
  // suffixes regardless of host OS.
  const projectRoot = path.resolve(options.projectRoot).replace(/\\/g, '/');
  // Plan 01-02: default to the shared swt:sessionId() so the events JSONL
  // basename matches every Pi session + bash hook spawned by the same CLI
  // run. Callers may still pass an explicit `sessionId` for tests or
  // multi-bus fan-out within a single process.
  const sessionId = options.sessionId ?? resolveSessionId();
  const bufferMs = options.bufferMs ?? DEFAULT_BUFFER_MS;

  const eventsDir = path.posix.join(projectRoot, PLANNING_DIR, EVENTS_DIR);
  const filePath = path.posix.join(eventsDir, `${sessionId}.jsonl`);

  let stream: WriteStream | null = null;
  let buffer: string[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  let closed = false;

  const ensureStream = (): WriteStream => {
    if (stream) return stream;
    if (!existsSync(eventsDir)) mkdirSync(eventsDir, { recursive: true });
    stream = createWriteStream(filePath, { flags: 'a' });
    return stream;
  };

  const flushNow = (): void => {
    if (closed || buffer.length === 0) return;
    const payload = buffer.join('');
    buffer = [];
    const s = ensureStream();
    s.write(payload);
  };

  const scheduleFlush = (): void => {
    if (closed || flushTimer) return;
    if (bufferMs <= 0) {
      flushNow();
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushNow();
    }, bufferMs);
  };

  const emit = (event: CliEvent): void => {
    if (closed) return;
    buffer.push(`${JSON.stringify(event)}\n`);
    scheduleFlush();
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (buffer.length > 0) {
      const payload = buffer.join('');
      buffer = [];
      const s = ensureStream();
      s.write(payload);
    }
    if (stream) {
      const s = stream;
      stream = null;
      await new Promise<void>((resolve) => {
        s.end(() => resolve());
      });
    }
  };

  return {
    emit,
    close,
    path: filePath,
    sessionId,
  };
}
