import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EMPTY_DISCOVERY, readDiscovery, writeDiscovery } from '../../src/bootstrap/discovery.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-discovery-'));
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('discovery.json', () => {
  it('returns EMPTY_DISCOVERY when the file is missing', async () => {
    const data = await readDiscovery(dir);
    expect(data).toEqual(EMPTY_DISCOVERY);
  });

  it('round-trips through write + read', async () => {
    await writeDiscovery(dir, {
      answered: ['build a CLI', 'cross-platform'],
      inferred: [{ text: 'tests pass on CI', priority: 'must-have' }],
      deferred: ['multi-tenant'],
    });
    const raw = await readFile(join(dir, 'discovery.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({
      answered: ['build a CLI', 'cross-platform'],
      inferred: [{ text: 'tests pass on CI', priority: 'must-have' }],
      deferred: ['multi-tenant'],
    });

    const data = await readDiscovery(dir);
    expect(data.answered).toEqual(['build a CLI', 'cross-platform']);
    expect(data.deferred).toEqual(['multi-tenant']);
  });

  it('rejects malformed payloads on read', async () => {
    await writeFile(
      join(dir, 'discovery.json'),
      JSON.stringify({ answered: 'not-an-array' }),
      'utf8',
    );
    await expect(readDiscovery(dir)).rejects.toThrow();
  });
});
