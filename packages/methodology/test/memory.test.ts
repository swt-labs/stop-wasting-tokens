import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileMemoryStore } from '../src/memory/store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-memory-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileMemoryStore', () => {
  it('round-trips an entry through put/get', async () => {
    const store = new FileMemoryStore({ dir });
    await store.put({
      id: 'auth-decisions',
      topic: 'auth',
      content: 'sessions stored in cookies; rotate on login',
      tags: ['auth', 'security'],
      created_at: '2026-05-06T10:00:00Z',
    });
    const got = await store.get('auth-decisions');
    expect(got?.content).toContain('sessions stored');
    expect(got?.tags).toEqual(['auth', 'security']);
  });

  it('queries by topic and tag with limits', async () => {
    const store = new FileMemoryStore({ dir });
    await store.put({ id: 'a', topic: 'auth', content: 'A', tags: ['login'] });
    await store.put({ id: 'b', topic: 'queue', content: 'B', tags: ['infra'] });
    await store.put({ id: 'c', topic: 'auth', content: 'C', tags: ['login', 'security'] });

    expect(await store.query({ topic: 'auth' })).toHaveLength(2);
    expect(await store.query({ tag: 'infra' })).toHaveLength(1);
    expect(await store.query({ limit: 1 })).toHaveLength(1);
  });

  it('regenerates MEMORY.md on compact()', async () => {
    const store = new FileMemoryStore({ dir });
    await store.put({ id: 'a', topic: 'auth', content: 'A' });
    await store.put({ id: 'b', topic: 'queue', content: 'B' });
    await store.compact();
    const idx = await readFile(join(dir, 'MEMORY.md'), 'utf8');
    expect(idx).toContain('| a | auth |');
    expect(idx).toContain('| b | queue |');
  });

  it('removes entries and updates the index', async () => {
    const store = new FileMemoryStore({ dir });
    await store.put({ id: 'a', topic: 'auth', content: 'A' });
    await store.put({ id: 'b', topic: 'queue', content: 'B' });
    await store.remove('a');
    expect(await store.get('a')).toBeUndefined();
    const idx = await readFile(join(dir, 'MEMORY.md'), 'utf8');
    expect(idx).not.toContain('| a | auth |');
    expect(idx).toContain('| b | queue |');
  });
});
