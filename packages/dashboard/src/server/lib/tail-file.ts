import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

import chokidar, { type FSWatcher } from 'chokidar';

export interface FileTailerOptions {
  /** Glob pattern (supports chokidar globs) describing the files to watch. */
  pattern: string | readonly string[];
  /** Called for each non-empty line appended to a watched file. */
  onLine: (line: string, filePath: string) => void;
  /** Called when the tailer can't read or parse a file. Errors are non-fatal. */
  onError?: (err: Error, filePath: string) => void;
}

export interface FileTailer {
  close(): Promise<void>;
}

/**
 * Tail one or more append-only files. On `add` (file appears) or `change`
 * (file grew), reads from the last known byte offset to EOF, splits into
 * lines, and calls `onLine` for each non-empty line. Tracks per-file offsets
 * internally so re-emit is suppressed across chokidar's overlapping events.
 *
 * Designed for JSONL: callers parse lines themselves and skip invalid JSON
 * via try/catch in `onLine`.
 */
export function createFileTailer(options: FileTailerOptions): FileTailer {
  const { pattern, onLine } = options;
  const onError =
    options.onError ??
    ((err, filePath) => {
      console.error(`[tail-file] ${filePath}: ${err.message}`);
    });

  const offsets = new Map<string, number>();

  const readNewLines = (filePath: string): void => {
    const abs = path.resolve(filePath);
    let size: number;
    try {
      size = statSync(abs).size;
    } catch (err: unknown) {
      onError(err instanceof Error ? err : new Error(String(err)), abs);
      return;
    }
    const start = offsets.get(abs) ?? 0;
    if (size <= start) {
      offsets.set(abs, size);
      return;
    }

    let buffer = '';
    const stream = createReadStream(abs, { start, end: size - 1, encoding: 'utf8' });
    stream.on('data', (chunk: string | Buffer) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    stream.on('end', () => {
      offsets.set(abs, size);
      const lines = buffer.split('\n');
      // Last element is the trailing fragment if the file ends without a newline;
      // we treat it as an incomplete line and re-read it next round (offset stays
      // at `size`, so we'll re-process it once the file grows).
      // For now: emit only newline-terminated complete lines.
      const completeLines = buffer.endsWith('\n') ? lines.slice(0, -1) : lines.slice(0, -1);
      for (const line of completeLines) {
        if (line.length === 0) continue;
        try {
          onLine(line, abs);
        } catch (err: unknown) {
          onError(err instanceof Error ? err : new Error(String(err)), abs);
        }
      }
      // If the buffer didn't end with a newline, "rewind" the offset so the
      // next read picks up the partial line plus any new content.
      if (!buffer.endsWith('\n') && completeLines.length < lines.length) {
        const fragment = lines[lines.length - 1] ?? '';
        const fragBytes = Buffer.byteLength(fragment, 'utf8');
        offsets.set(abs, size - fragBytes);
      }
    });
    stream.on('error', (err: Error) => {
      onError(err, abs);
    });
  };

  const patterns: string[] = typeof pattern === 'string' ? [pattern] : pattern.map((p) => p);
  const watcher: FSWatcher = chokidar.watch(patterns, {
    ignoreInitial: false,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 25, pollInterval: 10 },
  });

  watcher.on('add', (filePath) => readNewLines(filePath));
  watcher.on('change', (filePath) => readNewLines(filePath));

  return {
    close: async () => {
      offsets.clear();
      await watcher.close();
    },
  };
}
