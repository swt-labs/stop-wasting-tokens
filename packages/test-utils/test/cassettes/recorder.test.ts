/**
 * Unit tests for the cassette recorder interceptor.
 *
 * Strategy: spin up an in-process HTTP fixture server, install
 * `record()` against a temp JSONL file with `captureAllHosts: true`
 * (so localhost fixture traffic is captured even though it doesn't
 * match the production PROVIDER_HOSTS list), fire a fetch against
 * the fixture, and assert the JSONL is shaped per
 * `CassetteHeaderSchema` + `CassetteInteractionSchema`.
 */

import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetch, getGlobalDispatcher } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CassetteHeaderSchema,
  CassetteInteractionSchema,
  hashRequest,
  normalizeRequest,
  record,
} from '../../src/cassettes/index.js';

let server: Server;
let port: number;
let tmpDir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/echo' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ echo: body }));
      });
      return;
    }
    if (req.url === '/sse' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: chunk-1\ndata: {"hello":"world"}\n\n');
      res.write('event: chunk-2\ndata: {"goodbye":"world"}\n\n');
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  tmpDir = mkdtempSync(join(tmpdir(), 'swt-rec-test-'));
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  rmSync(tmpDir, { recursive: true, force: true });
});

function readJsonl(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

describe('cassette recorder', () => {
  it('writes a valid header line + interaction line for a simple POST', async () => {
    const outPath = join(tmpDir, 'echo.jsonl');
    const previous = getGlobalDispatcher();

    await record({
      scenario: 'recorder-echo',
      provider: 'fixture',
      model: 'fixture-1',
      outputPath: outPath,
      captureAllHosts: true,
      run: async () => {
        const res = await fetch(`http://127.0.0.1:${port}/echo`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hello: 'world' }),
        });
        expect(res.status).toBe(200);
        await res.text();
      },
    });

    expect(existsSync(outPath)).toBe(true);
    const lines = readJsonl(outPath);
    expect(lines.length).toBe(2);

    const header = CassetteHeaderSchema.parse(lines[0]);
    expect(header.schema_version).toBe(1);
    expect(header.cwd_redacted).toBe(true);
    expect(header.provider).toBe('fixture');

    const interaction = CassetteInteractionSchema.parse(lines[1]);
    expect(interaction.seq).toBe(1);
    expect(interaction.request.method).toBe('POST');
    expect(interaction.request.url).toBe(`http://127.0.0.1:${port}/echo`);
    expect(interaction.request.body_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(interaction.response.status).toBe(200);
    expect(Array.isArray(interaction.response.body_chunks)).toBe(true);
    expect(interaction.response.body_chunks.length).toBeGreaterThan(0);

    // body_hash must match what hashRequest computes from the same
    // normalised request — proves the interceptor uses the canonical
    // hashing path, not an ad-hoc one.
    const normalised = normalizeRequest(
      'POST',
      `http://127.0.0.1:${port}/echo`,
      { 'content-type': 'application/json' },
      { hello: 'world' },
      { cwd: process.cwd() },
    );
    expect(interaction.request.body_hash).toBe(hashRequest(normalised));

    // Global dispatcher restored after record() returns.
    expect(getGlobalDispatcher()).toBe(previous);
  });

  it('preserves SSE chunk framing in body_chunks', async () => {
    const outPath = join(tmpDir, 'sse.jsonl');

    await record({
      scenario: 'recorder-sse',
      provider: 'fixture',
      model: 'fixture-1',
      outputPath: outPath,
      captureAllHosts: true,
      run: async () => {
        const res = await fetch(`http://127.0.0.1:${port}/sse`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ stream: true }),
        });
        // Drain the stream so onComplete fires.
        if (res.body) {
          const reader = res.body.getReader();
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        }
      },
    });

    const lines = readJsonl(outPath);
    expect(lines.length).toBe(2);
    const interaction = CassetteInteractionSchema.parse(lines[1]);
    expect(interaction.response.headers['content-type']).toContain('text/event-stream');
    expect(interaction.response.body_chunks.length).toBeGreaterThanOrEqual(1);
    // Joined chunks contain both SSE events.
    const joined = (interaction.response.body_chunks as string[]).join('');
    expect(joined).toContain('event: chunk-1');
    expect(joined).toContain('event: chunk-2');
  });

  it('does not capture out-of-scope hosts by default', async () => {
    const outPath = join(tmpDir, 'oop.jsonl');

    await record({
      scenario: 'recorder-out-of-scope',
      provider: 'fixture',
      model: 'fixture-1',
      outputPath: outPath,
      // captureAllHosts left default false; localhost is not in
      // PROVIDER_HOSTS so the request must pass through uncaptured.
      run: async () => {
        const res = await fetch(`http://127.0.0.1:${port}/echo`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ skip: 'me' }),
        });
        await res.text();
      },
    });

    const lines = readJsonl(outPath);
    // Only the header line — no interactions captured.
    expect(lines.length).toBe(1);
    expect(CassetteHeaderSchema.parse(lines[0]).schema_version).toBe(1);
  });
});
