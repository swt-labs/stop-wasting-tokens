import { describe, expect, it } from 'vitest';

import { parseSwtArgv } from '../src/argv.js';

describe('parseSwtArgv', () => {
  it('returns undefined verb when argv is empty', () => {
    const result = parseSwtArgv([]);
    expect(result.verb).toBeUndefined();
    expect(result.positionals).toEqual([]);
  });

  it('parses verb and positional arguments', () => {
    const result = parseSwtArgv(['config', 'set', 'effort', 'thorough']);
    expect(result.verb).toBe('config');
    expect(result.positionals).toEqual(['set', 'effort', 'thorough']);
  });

  it('parses global flags', () => {
    const result = parseSwtArgv(['execute', '--effort', 'fast', '--skip-qa', '--yolo']);
    expect(result.verb).toBe('execute');
    expect(result.flags.effort).toBe('fast');
    expect(result.flags['skip-qa']).toBe(true);
    expect(result.flags.yolo).toBe(true);
  });

  it('parses --help and --version booleans', () => {
    expect(parseSwtArgv(['--help']).flags.help).toBe(true);
    expect(parseSwtArgv(['-v']).flags.version).toBe(true);
  });

  it('rejects unknown flags', () => {
    expect(() => parseSwtArgv(['execute', '--bogus'])).toThrow();
  });
});
