/**
 * Cross-process cassette inheritance — Phase 6 plan 06-04 T3 (R3 / DEVN-04).
 *
 * Verifies that a child subprocess given `SWT_CASSETTE_PATH` in its env
 * installs the same cassette in its own undici dispatcher via
 * `installReplayFromEnv()`, so HTTP requests made in the child are
 * intercepted by the replayer instead of hitting the live network.
 *
 * The test approach:
 *   1. Synthesise a minimal cassette (1 header + 1 interaction) in a
 *      tmpdir, with a body_hash that matches a known POST body.
 *   2. Spawn a child `node -e "..."` that imports the test-utils
 *      cassettes module, calls `installReplayFromEnv()`, fires a
 *      matching `fetch()`, and asserts the recorded response is
 *      returned. The child writes a single byte to stdout for each
 *      assertion outcome so the parent test can read its disposition
 *      without parsing stack traces across the process boundary.
 *
 * This closes the Phase 5 PARITY-REPORT.md:130 cross-process gap and
 * unblocks the 3 e2e tests + 7 parity tests gated behind dual
 * cassette-prerequisite skips.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  hashRequest,
  normalizeRequest,
  type CassetteHeader,
  type CassetteInteraction,
} from '../../packages/test-utils/src/cassettes/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
// Run the child from the test-utils package — its local node_modules
// exposes undici (vitest's `-e` script otherwise can't resolve the bare
// `undici` specifier from the repo root namespace).
const TEST_UTILS_DIR = resolve(REPO_ROOT, 'packages/test-utils');
const FIXTURE_URL = 'https://api.anthropic.com/v1/messages';
const REPLAYER_TS = resolve(TEST_UTILS_DIR, 'src/cassettes/replayer.ts');

function buildBodyHash(body: unknown): string {
  return hashRequest(
    normalizeRequest(
      'POST',
      FIXTURE_URL,
      { 'content-type': 'application/json' },
      body,
      { cwd: process.cwd() },
    ),
  );
}

function writeMinimalCassette(path: string, body: unknown, responseText: string): void {
  const header: CassetteHeader = {
    schema_version: 1,
    type: 'header',
    name: 'cross-process-fixture',
    provider: 'fixture',
    model: 'fixture-1',
    recorded_at: '2026-05-13T20:00:00.000Z',
    cwd_redacted: true,
  };
  const interaction: CassetteInteraction = {
    schema_version: 1,
    type: 'interaction',
    seq: 1,
    request: {
      method: 'POST',
      url: FIXTURE_URL,
      headers_normalized: { 'content-type': 'application/json' },
      body_hash: buildBodyHash(body),
    },
    response: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body_chunks: [responseText],
    },
  };
  const lines = [JSON.stringify(header), JSON.stringify(interaction)];
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

describe('cross-process cassette inheritance (SWT_CASSETTE_PATH)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swt-xproc-cassette-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('child process with SWT_CASSETTE_PATH installs the cassette and intercepts fetch', () => {
    const cassettePath = join(tmpDir, 'fixture.jsonl');
    const requestBody = { prompt: 'cross-process-replay' };
    const recordedResponse = '{"reply":"intercepted"}';
    writeMinimalCassette(cassettePath, requestBody, recordedResponse);

    // Drive a child process that:
    //   - imports installReplayFromEnv via tsx (no need for a built bundle)
    //   - asserts SWT_CASSETTE_PATH is honoured (handle !== null)
    //   - fires a matching fetch and asserts the recorded body comes back
    //
    // The child writes one of three sentinels to stdout:
    //   'OK'      — full success
    //   'NO_HANDLE' — env was set but install returned null (logic regression)
    //   'MISMATCH:<actual>' — fetch returned non-recorded body
    // Stack traces go to stderr; the parent reads stdout to determine
    // disposition without parsing across the process boundary.
    const childScript = `
      (async () => {
        const m = await import(${JSON.stringify(REPLAYER_TS)});
        const handle = m.installReplayFromEnv();
        if (handle === null) {
          process.stdout.write('NO_HANDLE');
          process.exit(0);
        }
        try {
          const undici = await import('undici');
          const res = await undici.fetch(${JSON.stringify(FIXTURE_URL)}, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: ${JSON.stringify(JSON.stringify(requestBody))},
          });
          const text = await res.text();
          if (text === ${JSON.stringify(recordedResponse)}) {
            process.stdout.write('OK');
          } else {
            process.stdout.write('MISMATCH:' + text);
          }
        } finally {
          handle.uninstall();
        }
      })().catch((err) => {
        process.stderr.write(String(err && err.stack ? err.stack : err));
        process.exit(2);
      });
    `;

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', '--input-type=module', '-e', childScript],
      {
        cwd: TEST_UTILS_DIR,
        env: { ...process.env, SWT_CASSETTE_PATH: cassettePath },
        encoding: 'utf8',
      },
    );
    expect(result.status, `child stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout, `child stderr: ${result.stderr}`).toBe('OK');
  });

  it('child process WITHOUT SWT_CASSETTE_PATH does not install a cassette', () => {
    // Negative case — `installReplayFromEnv()` returns null when env is
    // unset. The child writes 'NO_HANDLE' to stdout; the parent asserts.
    const childScript = `
      (async () => {
        const m = await import(${JSON.stringify(REPLAYER_TS)});
        const handle = m.installReplayFromEnv();
        process.stdout.write(handle === null ? 'NO_HANDLE' : 'UNEXPECTED_HANDLE');
        if (handle !== null) handle.uninstall();
      })().catch((err) => {
        process.stderr.write(String(err && err.stack ? err.stack : err));
        process.exit(2);
      });
    `;

    // Strip the env var from the child environment.
    const env = { ...process.env };
    delete env['SWT_CASSETTE_PATH'];

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', '--input-type=module', '-e', childScript],
      {
        cwd: TEST_UTILS_DIR,
        env,
        encoding: 'utf8',
      },
    );
    expect(result.status, `child stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toBe('NO_HANDLE');
  });
});
