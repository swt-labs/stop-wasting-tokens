import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { allDoneHandler } from '../../../src/vibe/handlers/all-done.js';
import type { VibeRoute } from '../../../src/vibe/route.js';

class StringStream extends Writable {
  public readonly chunks: string[] = [];
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (e?: Error | null) => void): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    callback();
  }
  text(): string {
    return this.chunks.join('');
  }
}

const route: VibeRoute = { kind: 'all-done', requires_confirmation: false };

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-all-done-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('allDoneHandler', () => {
  it('returns a friendly no-op result', async () => {
    const handler = allDoneHandler();
    const stdout = new StringStream();
    const stderr = new StringStream();
    const result = await handler.run(route, { cwd, stdout, stderr });
    expect(result.exit).toBe(0);
    expect(result.message).toContain('All phases complete');
    expect(stdout.text()).toContain('steady state');
  });
});
