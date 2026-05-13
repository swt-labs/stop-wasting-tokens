/**
 * Unit tests for the cassette replayer interceptor.
 *
 * Strategy: synthesise a minimal cassette in a temp dir (1 header + 2
 * interactions, body hashes computed from `hashRequest()`), install the
 * replayer, fire `fetch()` requests, and assert:
 *   - matching body returns the recorded response,
 *   - mismatching body throws `RequestNotInCassetteError`,
 *   - `uninstall()` restores the previous dispatcher,
 *   - cassettes with `cwd_redacted: false` are refused via `CassetteUnsealedError`.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetch, getGlobalDispatcher } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CassetteUnsealedError,
  hashRequest,
  installReplay,
  loadCassette,
  normalizeRequest,
  RequestNotInCassetteError,
  type CassetteHeader,
  type CassetteInteraction,
} from '../../src/cassettes/index.js';

const FIXTURE_URL = 'https://api.anthropic.com/v1/messages';

function buildHash(body: unknown): string {
  return hashRequest(
    normalizeRequest('POST', FIXTURE_URL, { 'content-type': 'application/json' }, body, {
      cwd: process.cwd(),
    }),
  );
}

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'swt-replay-test-'));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeSyntheticCassette(
  path: string,
  bodies: unknown[],
  responseBodies: string[][],
  options: { unsealed?: boolean } = {},
): void {
  const header: CassetteHeader = {
    schema_version: 1,
    type: 'header',
    name: 'synthetic-replay-fixture',
    provider: 'fixture',
    model: 'fixture-1',
    recorded_at: new Date().toISOString(),
    cwd_redacted: (options.unsealed ? false : true) as true,
  };
  const interactions: CassetteInteraction[] = bodies.map((body, idx) => {
    const responseChunks = responseBodies[idx] ?? [JSON.stringify({ idx })];
    return {
      schema_version: 1,
      type: 'interaction',
      seq: idx + 1,
      request: {
        method: 'POST',
        url: FIXTURE_URL,
        headers_normalized: { 'content-type': 'application/json' },
        body_hash: buildHash(body),
      },
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body_chunks: responseChunks,
      },
    };
  });
  const lines = [JSON.stringify(header), ...interactions.map((i) => JSON.stringify(i))];
  writeFileSync(path, lines.join('\n') + '\n');
}

describe('cassette replayer', () => {
  it('returns the recorded response for a matching request body', async () => {
    const cassettePath = join(tmpDir, 'match.jsonl');
    writeSyntheticCassette(
      cassettePath,
      [{ prompt: 'hello' }, { prompt: 'goodbye' }],
      [['{"reply":"hi"}'], ['{"reply":"bye"}']],
    );

    const handle = installReplay(cassettePath);
    try {
      const res = await fetch(FIXTURE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('{"reply":"hi"}');
    } finally {
      handle.uninstall();
    }
  });

  it('throws RequestNotInCassetteError on body miss', async () => {
    const cassettePath = join(tmpDir, 'miss.jsonl');
    writeSyntheticCassette(
      cassettePath,
      [{ prompt: 'hello' }, { prompt: 'goodbye' }],
      [['{"reply":"hi"}'], ['{"reply":"bye"}']],
    );

    const handle = installReplay(cassettePath);
    try {
      // undici's `fetch` wraps dispatcher errors as `TypeError: fetch failed`
      // with the underlying error on `.cause`. Probe the cause chain.
      let captured: unknown;
      try {
        await fetch(FIXTURE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deliberately: 'wrong' }),
        });
      } catch (err) {
        captured = (err as { cause?: unknown }).cause ?? err;
      }
      const isClassMatch =
        captured instanceof RequestNotInCassetteError ||
        (captured as { name?: string })?.name === 'RequestNotInCassetteError';
      expect(isClassMatch).toBe(true);
    } finally {
      handle.uninstall();
    }
  });

  it('exposes recordedHashes + requestedHash on the diagnostic error', async () => {
    const cassettePath = join(tmpDir, 'diag.jsonl');
    const bodies = [{ a: 1 }, { b: 2 }];
    writeSyntheticCassette(cassettePath, bodies, [['{}'], ['{}']]);
    const recordedHashes = bodies.map(buildHash);

    const handle = installReplay(cassettePath);
    try {
      let captured: unknown;
      try {
        await fetch(FIXTURE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ wrong: true }),
        });
      } catch (err) {
        captured = (err as { cause?: unknown }).cause ?? err;
      }
      const target =
        captured instanceof RequestNotInCassetteError
          ? captured
          : ((captured as { cause?: unknown })?.cause as RequestNotInCassetteError | undefined);
      const finalErr = target instanceof RequestNotInCassetteError ? target : (captured as RequestNotInCassetteError);
      expect(finalErr.requestedHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(finalErr.recordedHashes).toEqual(recordedHashes);
      expect(finalErr.requestedBodyExcerpt).toContain('wrong');
    } finally {
      handle.uninstall();
    }
  });

  it('uninstall() restores the previous global dispatcher', async () => {
    const cassettePath = join(tmpDir, 'uninstall.jsonl');
    writeSyntheticCassette(cassettePath, [{ x: 1 }], [['{}']]);
    const before = getGlobalDispatcher();
    const handle = installReplay(cassettePath);
    expect(getGlobalDispatcher()).not.toBe(before);
    handle.uninstall();
    expect(getGlobalDispatcher()).toBe(before);
  });

  it('refuses cassettes with cwd_redacted: false', () => {
    const cassettePath = join(tmpDir, 'unsealed.jsonl');
    // Bypass the type system to write an intentionally-malformed cassette
    // (cwd_redacted: false). loadCassette() must catch this via the schema.
    writeSyntheticCassette(cassettePath, [{ a: 1 }], [['{}']], { unsealed: true });
    expect(() => loadCassette(cassettePath)).toThrow();
  });

  it('enforces strict-monotonic seq when enforceSeq is left at default', async () => {
    const cassettePath = join(tmpDir, 'seq.jsonl');
    writeSyntheticCassette(
      cassettePath,
      [{ first: true }, { second: true }],
      [['"first"'], ['"second"']],
    );

    const handle = installReplay(cassettePath);
    try {
      // Replay the SECOND interaction first — the replayer must reject with
      // a CassetteSeqError because the expected next seq is 1, not 2.
      let captured: unknown;
      try {
        await fetch(FIXTURE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ second: true }),
        });
      } catch (err) {
        captured = (err as { cause?: unknown }).cause ?? err;
      }
      const name =
        (captured as { name?: string })?.name ??
        ((captured as { cause?: { name?: string } })?.cause?.name);
      expect(name).toBe('CassetteSeqError');
    } finally {
      handle.uninstall();
    }
  });
});
