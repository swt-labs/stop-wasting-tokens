/**
 * End-to-end cassette pipeline smoke test.
 *
 * Exercises the full Plan 05-01 surface:
 *   1. Loads the committed `scout-read-readme.jsonl` and validates the
 *      header + interaction shape via `loadCassette()`.
 *   2. Round-trips the record/replay pipeline on a fresh synthetic
 *      cassette so a regression in either path is caught here (without
 *      depending on knowing the exact body the keystone cassette was
 *      recorded against — only the recorder knows the canonical body
 *      bytes since the cassette stores only `body_hash`).
 *   3. Asserts that a mismatching body throws
 *      `RequestNotInCassetteError`.
 *
 * Phase 5 plan 05-01 task T4 — R7 CI gating smoke.
 */

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  installReplay,
  loadCassette,
  record,
  RequestNotInCassetteError,
} from '../../packages/test-utils/src/cassettes/index.js';

// Node 22+ ships `fetch` (built on undici) globally. We use that here
// instead of `import {fetch} from 'undici'` because `test/regression/`
// lives outside any package's node_modules and the bare `undici`
// specifier doesn't resolve from this path. Node's `globalThis.fetch`
// is implemented on top of the same global undici dispatcher the
// recorder/replayer hook into, so the test still exercises the
// cassette pipeline end-to-end.
const fetch = globalThis.fetch;

const KEYSTONE_CASSETTE = join(
  __dirname,
  '..',
  '..',
  'packages',
  'test-utils',
  'cassettes',
  'scout-read-readme.jsonl',
);

describe('cassette pipeline smoke', () => {
  it('keystone cassette has a valid header + at least one interaction', () => {
    const c = loadCassette(KEYSTONE_CASSETTE);
    expect(c.header.schema_version).toBe(1);
    expect(c.header.cwd_redacted).toBe(true);
    expect(c.header.provider).toBeTruthy();
    expect(c.header.model).toBeTruthy();
    expect(c.interactions.length).toBeGreaterThan(0);
    expect(c.interactions[0]?.seq).toBe(1);
    expect(c.interactions[0]?.request.body_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  describe('record + replay round-trip', () => {
    let fixtureServer: ReturnType<typeof createServer>;
    let fixturePort: number;
    let tmpDir: string;

    beforeAll(async () => {
      fixtureServer = createServer((req, res) => {
        if (req.url === '/echo' && req.method === 'POST') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ echoed: JSON.parse(body || '{}') }));
          });
          return;
        }
        res.writeHead(404);
        res.end();
      });
      await new Promise<void>((r) => fixtureServer.listen(0, '127.0.0.1', () => r()));
      const addr = fixtureServer.address();
      if (typeof addr === 'string' || addr === null) throw new Error('expected port address');
      fixturePort = addr.port;
      tmpDir = mkdtempSync(join(tmpdir(), 'swt-smoke-'));
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) =>
        fixtureServer.close((err) => (err ? reject(err) : resolve())),
      );
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('records a fixture interaction and replays it byte-equivalently', async () => {
      const cassettePath = join(tmpDir, 'smoke.jsonl');
      const url = `http://127.0.0.1:${fixturePort}/echo`;
      const requestBody = JSON.stringify({ smoke: 'test', n: 42 });

      let recordedResponse = '';
      await record({
        scenario: 'smoke',
        provider: 'fixture',
        model: 'fixture-1',
        outputPath: cassettePath,
        captureAllHosts: true,
        run: async () => {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: requestBody,
          });
          recordedResponse = await res.text();
        },
      });

      // Now close the fixture server so any replay-leaking traffic would
      // fail loud, and replay the cassette.
      await new Promise<void>((resolve, reject) =>
        fixtureServer.close((err) => (err ? reject(err) : resolve())),
      );

      const handle = installReplay(cassettePath);
      try {
        const replayed = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: requestBody,
        });
        expect(replayed.status).toBe(200);
        const text = await replayed.text();
        expect(text).toBe(recordedResponse);
      } finally {
        handle.uninstall();
      }

      // Re-open the fixture server for any subsequent tests in the
      // describe block (we close it again in afterAll, idempotently).
      fixtureServer = createServer(() => undefined);
      await new Promise<void>((r) => fixtureServer.listen(fixturePort, '127.0.0.1', () => r()));
    });

    it('throws RequestNotInCassetteError on a body that does not match', async () => {
      const cassettePath = join(tmpDir, 'miss.jsonl');
      // Re-start the live fixture so record() has somewhere to talk to.
      await new Promise<void>((resolve, reject) =>
        fixtureServer.close((err) => (err ? reject(err) : resolve())),
      );
      fixtureServer = createServer((req, res) => {
        if (req.url === '/echo' && req.method === 'POST') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"ok":true}');
          return;
        }
        res.writeHead(404);
        res.end();
      });
      await new Promise<void>((r) => fixtureServer.listen(fixturePort, '127.0.0.1', () => r()));

      const url = `http://127.0.0.1:${fixturePort}/echo`;
      await record({
        scenario: 'miss',
        provider: 'fixture',
        model: 'fixture-1',
        outputPath: cassettePath,
        captureAllHosts: true,
        run: async () => {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recorded: 'body' }),
          });
          await res.text();
        },
      });

      const handle = installReplay(cassettePath);
      try {
        let captured: unknown;
        try {
          await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ wrong: 'body' }),
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
  });
});
