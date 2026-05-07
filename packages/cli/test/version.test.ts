import { describe, expect, it } from 'vitest';

import { versionHandler } from '../src/commands/version.js';
import { EXIT } from '../src/exit-codes.js';
import type { CommandIO } from '../src/router.js';

import { StringStream } from './_helpers.js';

describe('version command', () => {
  it('prints `swt <version>` and exits 0', async () => {
    const out = new StringStream();
    const err = new StringStream();
    const io: CommandIO = { cwd: '/tmp', stdout: out, stderr: err };
    const code = await versionHandler('1.2.3-test')({ verb: 'version', positionals: [], flags: {} }, io);
    expect(code).toBe(EXIT.SUCCESS);
    expect(out.text()).toBe('swt 1.2.3-test\n');
    expect(err.text()).toBe('');
  });
});
