import { randomBytes } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Write `content` to `path` atomically. Uses a sibling temp file + rename so
 * concurrent readers never observe a half-written file.
 */
export async function writeAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const suffix = randomBytes(6).toString('hex');
  const tmp = `${path}.tmp-${process.pid}-${suffix}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}
