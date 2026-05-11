/**
 * Cassette replayer.
 *
 * Reads a JSONL cassette from disk, installs an undici fetch interceptor
 * that matches incoming requests by URL + normalised-body hash against
 * the recorded interactions, and returns the recorded response stream
 * on match. Mismatches throw with a clear "request not in cassette"
 * error so the test can re-record or fix the drift.
 *
 * Per TDD2 §14.7.2. PR-06 ships the public surface; the byte-identical
 * replay assertion lands in PR-07's `cassette-replay.int.test.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';

import {
  CassetteHeaderSchema,
  CassetteInteractionSchema,
  type CassetteHeader,
  type CassetteInteraction,
} from './format.js';
import { hashRequest, normalizeRequest } from './normalize.js';

export interface ReplayHandle {
  /** Tear down the interceptor; restores the previous undici dispatcher. */
  uninstall(): void;
  /** Read access to the cassette header (recorded provider, model, etc.). */
  header: CassetteHeader;
  /** Read access to the interaction list (PR-07 + PR-09 inspect this). */
  interactions: ReadonlyArray<CassetteInteraction>;
}

export class CassetteNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Cassette not found: ${path}. Record it first via the recorder script — see docs/operations/cassette-recording.md.`);
    this.name = 'CassetteNotFoundError';
  }
}

export class CassetteUnsealedError extends Error {
  constructor(public readonly path: string) {
    super(`Cassette ${path} has cwd_redacted: false in its header. Refusing to load — the recorder must strip cwd paths before the cassette is committed.`);
    this.name = 'CassetteUnsealedError';
  }
}

/**
 * Load a cassette file from disk and validate its structure. Returns the
 * parsed header + interactions. Throws `CassetteNotFoundError` if the
 * file is missing, `CassetteUnsealedError` if the header reports
 * `cwd_redacted: false`, or a Zod validation error if the schema doesn't
 * match.
 */
export function loadCassette(path: string): {
  header: CassetteHeader;
  interactions: CassetteInteraction[];
} {
  if (!existsSync(path)) throw new CassetteNotFoundError(path);

  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error(`Cassette ${path} is empty.`);
  }

  const firstLineRaw = lines[0];
  if (firstLineRaw === undefined) {
    throw new Error(`Cassette ${path} is empty after filter.`);
  }
  const firstLine: unknown = JSON.parse(firstLineRaw);
  const headerCandidate =
    typeof firstLine === 'object' && firstLine !== null
      ? (firstLine as Record<string, unknown>)
      : {};
  if (headerCandidate['type'] !== 'header') {
    throw new Error(`Cassette ${path} first line is not a header (got type=${String(headerCandidate['type'])}).`);
  }

  const header = CassetteHeaderSchema.parse(firstLine);
  if (header.cwd_redacted !== true) throw new CassetteUnsealedError(path);

  const interactions: CassetteInteraction[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const parsed: unknown = JSON.parse(line);
    interactions.push(CassetteInteractionSchema.parse(parsed));
  }

  // Sequence numbers should be monotonic 1..N — guard against accidental
  // reordering in version-controlled cassettes.
  for (let i = 0; i < interactions.length; i++) {
    const expected = i + 1;
    const interaction = interactions[i];
    if (interaction === undefined) continue;
    const actual = interaction.seq;
    if (actual !== expected) {
      throw new Error(
        `Cassette ${path} interaction #${i} has seq=${actual}, expected ${expected}.`,
      );
    }
  }

  return { header, interactions };
}

export interface InstallReplayOptions {
  /**
   * Optional cwd to strip from outgoing requests at match-time. Must equal
   * the cwd the cassette was recorded against, otherwise body hashes
   * won't line up. Defaults to `process.cwd()`.
   */
  readonly cwd?: string;
}

/**
 * Install a cassette replayer. Returns a handle the caller uses to
 * uninstall when the test ends. Multiple cassettes cannot be installed
 * simultaneously — install / uninstall is a single-slot lifecycle.
 *
 * PR-06 ships the public-surface skeleton. The actual fetch interception
 * (matching incoming request hashes against recorded `body_hash`,
 * replaying the recorded `response.body_chunks` stream) lands in PR-07's
 * integration test wiring.
 */
export function installReplay(path: string, opts: InstallReplayOptions = {}): ReplayHandle {
  const { header, interactions } = loadCassette(path);

  // Placeholder uninstall — wired when the interceptor lands in PR-07.
  void hashRequest;
  void normalizeRequest;
  void opts.cwd;

  return {
    header,
    interactions: Object.freeze([...interactions]),
    uninstall() {
      // No-op until interceptor lands.
    },
  };
}
