import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { updateHandler } from '../../src/commands/update.js';

class CaptureStream extends Writable {
  output = '';
  _write(chunk: any, _enc: any, cb: any): void {
    this.output += String(chunk);
    cb();
  }
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<{ version: string }>;
}

function makeFetch(responseOrError: FetchResponse | Error): typeof fetch {
  return async () => {
    if (responseOrError instanceof Error) throw responseOrError;
    return responseOrError as unknown as Response;
  };
}

let tempDir: string;
let cachePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'swt-update-'));
  cachePath = join(tempDir, 'update-cache.json');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeIO() {
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  return {
    stdout,
    stderr,
    io: { stdout, stderr, cwd: tempDir },
  };
}

function parsedFlags(flags: Record<string, string | boolean | undefined>) {
  return { verb: 'update', positionals: [] as readonly string[], flags };
}

describe('updateCommand', () => {
  it('reports up-to-date when current matches latest', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      json: async () => ({ version: '0.1.0' }),
    });
    const handler = updateHandler({ fetchImpl, cachePath, currentVersion: '0.1.0' });
    const { stdout, io } = makeIO();
    const exit = await handler(parsedFlags({}), io);
    expect(exit).toBe(0);
    expect(stdout.output).toContain('up-to-date');
    expect(stdout.output).toContain('v0.1.0');
  });

  it('reports outdated with all three upgrade commands when current < latest', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      json: async () => ({ version: '0.2.0' }),
    });
    const handler = updateHandler({ fetchImpl, cachePath, currentVersion: '0.1.0' });
    const { stdout, io } = makeIO();
    const exit = await handler(parsedFlags({}), io);
    expect(exit).toBe(0);
    expect(stdout.output).toContain('Update available');
    expect(stdout.output).toContain('v0.1.0');
    expect(stdout.output).toContain('v0.2.0');
    expect(stdout.output).toContain('npm install -g @swt-labs/cli@latest');
    expect(stdout.output).toContain('pnpm add -g @swt-labs/cli@latest');
    expect(stdout.output).toContain('bun add -g @swt-labs/cli@latest');
  });

  it('warns to stderr when registry is unreachable (default warn-only)', async () => {
    const fetchImpl = makeFetch(new Error('ENETUNREACH'));
    const handler = updateHandler({ fetchImpl, cachePath, currentVersion: '0.1.0' });
    const { stderr, io } = makeIO();
    const exit = await handler(parsedFlags({}), io);
    expect(exit).toBe(0);
    expect(stderr.output).toContain('Could not check for updates');
    expect(stderr.output).toContain('ENETUNREACH');
  });

  it('exits 1 with --strict when registry is unreachable', async () => {
    const fetchImpl = makeFetch(new Error('boom'));
    const handler = updateHandler({ fetchImpl, cachePath, currentVersion: '0.1.0' });
    const { io } = makeIO();
    const exit = await handler(parsedFlags({ strict: true }), io);
    expect(exit).toBe(1);
  });

  it('emits stable JSON shape with --json for outdated', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      json: async () => ({ version: '0.2.0' }),
    });
    const handler = updateHandler({ fetchImpl, cachePath, currentVersion: '0.1.0' });
    const { stdout, io } = makeIO();
    await handler(parsedFlags({ json: true }), io);
    const payload = JSON.parse(stdout.output);
    expect(payload.status).toBe('outdated');
    expect(payload.current).toBe('0.1.0');
    expect(payload.latest).toBe('0.2.0');
    expect(payload.upgrade_commands).toHaveLength(3);
  });

  it('uses cache on second call within TTL', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: '0.1.5' }),
    })) as unknown as typeof fetch;

    const handler = updateHandler({ fetchImpl, cachePath, currentVersion: '0.1.0' });
    await handler(parsedFlags({ json: true }), makeIO().io);
    expect(existsSync(cachePath)).toBe(true);

    const { stdout, io } = makeIO();
    await handler(parsedFlags({ json: true }), io);
    const payload = JSON.parse(stdout.output);
    expect(payload.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only first call hit network
  });

  it('--no-cache forces fresh registry query', async () => {
    // seed a fake cache entry
    mkdirSync(join(tempDir), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        '@swt-labs/cli': {
          at: Date.now(),
          value: { current: '0.1.0', latest: '0.1.0', status: 'up-to-date' },
        },
      }),
    );

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: '0.2.0' }),
    })) as unknown as typeof fetch;

    const handler = updateHandler({ fetchImpl, cachePath, currentVersion: '0.1.0' });
    const { stdout, io } = makeIO();
    await handler(parsedFlags({ json: true, 'no-cache': true }), io);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(stdout.output);
    expect(payload.status).toBe('outdated');
    expect(payload.cached).toBe(false);
  });

  it('persists cache on first network call', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      json: async () => ({ version: '0.3.0' }),
    });
    const handler = updateHandler({ fetchImpl, cachePath, currentVersion: '0.1.0' });
    await handler(parsedFlags({ json: true }), makeIO().io);
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    expect(cache['@swt-labs/cli'].value.latest).toBe('0.3.0');
    expect(cache['@swt-labs/cli'].value.status).toBe('outdated');
  });

  it('marketplace endpoint configured + same version → annotation in plain output', async () => {
    const marketplaceCache = join(tempDir, 'marketplace-cache.json');
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('marketplace.test')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ latest_version: '0.1.0' }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ version: '0.1.0' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const handler = updateHandler({
      fetchImpl,
      cachePath,
      marketplaceCachePath: marketplaceCache,
      currentVersion: '0.1.0',
      marketplaceEndpoint: 'https://marketplace.test',
    });
    const { stdout, io } = makeIO();
    await handler(parsedFlags({}), io);
    expect(stdout.output).toContain('up-to-date');
    expect(stdout.output).toContain('also published on marketplace at v0.1.0');
  });

  it('marketplace returns different version → divergence warning', async () => {
    const marketplaceCache = join(tempDir, 'marketplace-cache.json');
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('marketplace.test')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ latest_version: '0.2.5' }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ version: '0.2.0' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const handler = updateHandler({
      fetchImpl,
      cachePath,
      marketplaceCachePath: marketplaceCache,
      currentVersion: '0.1.0',
      marketplaceEndpoint: 'https://marketplace.test',
    });
    const { stdout, io } = makeIO();
    await handler(parsedFlags({}), io);
    expect(stdout.output).toContain('Update available');
    expect(stdout.output).toContain('Marketplace version (v0.2.5) differs from npm (v0.2.0)');
  });

  it('marketplace endpoint missing → npm-only path runs unchanged', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ version: '0.1.0' }),
    })) as unknown as typeof fetch;
    const handler = updateHandler({
      fetchImpl,
      cachePath,
      currentVersion: '0.1.0',
      marketplaceEndpoint: null,
    });
    const { stdout, io } = makeIO();
    await handler(parsedFlags({ json: true }), io);
    const payload = JSON.parse(stdout.output);
    expect(payload.status).toBe('up-to-date');
    expect(payload.marketplace).toBeUndefined();
  });
});
