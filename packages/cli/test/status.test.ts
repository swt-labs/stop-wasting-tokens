import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { statusHandler } from '../src/commands/status.js';
import { EXIT } from '../src/exit-codes.js';
import type { CommandIO } from '../src/router.js';

import { StringStream } from './_helpers.js';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'swt-status-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('status command', () => {
  it('prints STATE.md when present', async () => {
    await mkdir(join(cwd, '.swt-planning'), { recursive: true });
    await writeFile(
      join(cwd, '.swt-planning', 'STATE.md'),
      '# State\n\n**Project:** swt-test\n',
      'utf8',
    );
    const out = new StringStream();
    const err = new StringStream();
    const io: CommandIO = { cwd, stdout: out, stderr: err };
    const code = await statusHandler({ verb: 'status', positionals: [], flags: {} }, io);
    expect(code).toBe(EXIT.SUCCESS);
    expect(out.text()).toContain('# State');
    expect(out.text()).toContain('swt-test');
  });

  it('warns when STATE.md is missing', async () => {
    const out = new StringStream();
    const err = new StringStream();
    const io: CommandIO = { cwd, stdout: out, stderr: err };
    const code = await statusHandler({ verb: 'status', positionals: [], flags: {} }, io);
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(err.text()).toContain('No SWT project here');
  });
});
