import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

import chokidar, { type FSWatcher } from 'chokidar';

export interface FileTailerOptions {
  /**
   * Pattern(s) describing the files to watch.
   *
   * Each entry must be one of:
   *   - A directory path (watches every file inside, optionally filtered by `extensions`).
   *   - A directory-with-basename-glob like `<dir>/*.jsonl` (the `*.<ext>` tail is
   *     stripped to derive `<dir>` + an extension filter — chokidar v4 dropped
   *     built-in glob support, so we parse the trailing `*.<ext>` ourselves).
   *   - A concrete file path (watches just that file).
   */
  pattern: string | readonly string[];
  /** Optional extension filter (e.g. `['.jsonl']`). Files outside this set are ignored. */
  extensions?: readonly string[];
  /** Called for each non-empty line appended to a watched file. */
  onLine: (line: string, filePath: string) => void;
  /** Called when the tailer can't read or parse a file. Errors are non-fatal. */
  onError?: (err: Error, filePath: string) => void;
}

export interface FileTailer {
  close(): Promise<void>;
  /**
   * Resolves after chokidar's initial directory scan completes. Callers
   * who write to a watched glob immediately after construction must await
   * this before expecting `onLine` to fire — otherwise chokidar may miss
   * `add` events for files created during its startup window. Production
   * callers (snapshotter at server boot) can ignore this; only tests that
   * create files synchronously after construction need to await it.
   */
  readonly ready: Promise<void>;
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

  // Chokidar v4 dropped built-in glob support — we accept directory paths
  // or `<dir>/*.<ext>` shorthand and parse the latter into `<dir>` plus an
  // extension filter ourselves.
  const inputPatterns: string[] = typeof pattern === 'string' ? [pattern] : pattern.map((p) => p);
  const watchTargets: string[] = [];
  const extensionFilter = new Set<string>(
    (options.extensions ?? []).map((e) => (e.startsWith('.') ? e : `.${e}`)),
  );
  for (const p of inputPatterns) {
    const match = /^(.+?)[/\\]\*\.([A-Za-z0-9]+)$/.exec(p);
    if (match !== null) {
      const dir = match[1];
      const ext = match[2];
      if (dir !== undefined) watchTargets.push(dir);
      if (ext !== undefined) extensionFilter.add(`.${ext}`);
    } else {
      watchTargets.push(p);
    }
  }

  const matchesExtension = (filePath: string): boolean => {
    if (extensionFilter.size === 0) return true;
    return extensionFilter.has(path.extname(filePath));
  };

  const watcher: FSWatcher = chokidar.watch(watchTargets, {
    ignoreInitial: false,
    persistent: true,
    // `awaitWriteFinish: false` (default) — `add`/`change` events fire as
    // soon as chokidar sees them. The stability-threshold guard from the
    // v2-era config delayed events by ~25-50ms even for atomic
    // writeFileSync calls; tests that wrote files immediately after
    // construction observed missed events. Our consumers (events-tailer,
    // snapshotter) read JSONL lines whose writers are atomic
    // (writeFileSync / appendFileSync) so chunked-write protection
    // doesn't apply.
  });

  watcher.on('add', (filePath) => {
    if (matchesExtension(filePath)) readNewLines(filePath);
  });
  watcher.on('change', (filePath) => {
    if (matchesExtension(filePath)) readNewLines(filePath);
  });

  // Public `ready` promise — resolves once chokidar's initial scan
  // completes. Tests await this before writing files; production callers
  // can ignore it.
  const ready: Promise<void> = new Promise((resolve) => {
    watcher.once('ready', () => resolve());
  });

  return {
    ready,
    close: async () => {
      offsets.clear();
      await watcher.close();
    },
  };
}
