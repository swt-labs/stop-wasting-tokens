import { describe, expect, it } from 'vitest';

import { EXIT } from '../src/exit-codes.js';
import { CommandRegistry, dispatch, type CommandIO } from '../src/router.js';

import { StringStream } from './_helpers.js';

function makeIO(): { io: CommandIO; out: StringStream; err: StringStream } {
  const out = new StringStream();
  const err = new StringStream();
  return { io: { cwd: '/tmp', stdout: out, stderr: err }, out, err };
}

describe('command registry', () => {
  it('dispatches a known command', async () => {
    const reg = new CommandRegistry().register({
      name: 'echo',
      description: 'echo positionals back',
      handler: (parsed, io) => {
        io.stdout.write(`echo:${parsed.positionals.join(',')}\n`);
        return EXIT.SUCCESS;
      },
    });
    const { io, out } = makeIO();
    const code = await dispatch(reg, { verb: 'echo', positionals: ['a', 'b'], flags: {} }, io);
    expect(code).toBe(EXIT.SUCCESS);
    expect(out.text()).toBe('echo:a,b\n');
  });

  it('returns USAGE_ERROR for an unknown verb', async () => {
    const reg = new CommandRegistry();
    const { io, err } = makeIO();
    const code = await dispatch(reg, { verb: 'bogus', positionals: [], flags: {} }, io);
    expect(code).toBe(EXIT.USAGE_ERROR);
    expect(err.text()).toContain('unknown command');
    expect(err.text()).toContain('swt help');
  });

  it('returns USAGE_ERROR when no verb is supplied', async () => {
    const reg = new CommandRegistry();
    const { io } = makeIO();
    const code = await dispatch(reg, { verb: undefined, positionals: [], flags: {} }, io);
    expect(code).toBe(EXIT.USAGE_ERROR);
  });

  it('rejects duplicate registration', () => {
    const reg = new CommandRegistry();
    reg.register({
      name: 'echo',
      description: 'first',
      handler: () => EXIT.SUCCESS,
    });
    expect(() =>
      reg.register({
        name: 'echo',
        description: 'second',
        handler: () => EXIT.SUCCESS,
      }),
    ).toThrow();
  });
});
