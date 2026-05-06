import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeAtomically } from '../src/atomic-write.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-atomic-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeAtomically', () => {
  it('writes content and leaves no temp files behind', async () => {
    const target = join(dir, 'STATE.md');
    await writeAtomically(target, '# State\n');
    expect(await readFile(target, 'utf8')).toBe('# State\n');
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([]);
  });

  it('overwrites existing content atomically', async () => {
    const target = join(dir, 'STATE.md');
    await writeAtomically(target, 'first\n');
    await writeAtomically(target, 'second\n');
    expect(await readFile(target, 'utf8')).toBe('second\n');
  });

  it('creates parent directories as needed', async () => {
    const target = join(dir, 'nested', 'deep', 'file.txt');
    await writeAtomically(target, 'ok\n');
    expect(await readFile(target, 'utf8')).toBe('ok\n');
  });
});
