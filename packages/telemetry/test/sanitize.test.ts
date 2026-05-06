import { describe, expect, it, vi } from 'vitest';

import { sanitize } from '../src/sanitize.js';

describe('sanitize', () => {
  it('passes allowed keys through untouched', () => {
    const result = sanitize('cli.command_invoked', { command_name: 'vibe' });
    expect(result).toEqual({ command_name: 'vibe' });
  });

  it('strips disallowed keys and warns', () => {
    const onWarning = vi.fn();
    const result = sanitize(
      'cli.command_invoked',
      { command_name: 'vibe', repo_path: '/secret/path', user: 'alice' } as any,
      { onWarning },
    );
    expect(result).toEqual({ command_name: 'vibe' });
    expect(onWarning).toHaveBeenCalledOnce();
    const msg = onWarning.mock.calls[0][0] as string;
    expect(msg).toContain('cli.command_invoked');
    expect(msg).toContain('repo_path');
    expect(msg).toContain('user');
  });

  it('honors per-event allowlists', () => {
    const result = sanitize('vibe.phase_started', { phase: 5, mode: 'plan' });
    expect(result).toEqual({ phase: 5, mode: 'plan' });
  });

  it('returns empty object when properties are empty', () => {
    const result = sanitize('cli.command_invoked', {} as any);
    expect(result).toEqual({});
  });

  it('does not warn when no disallowed keys present', () => {
    const onWarning = vi.fn();
    sanitize('uat.checkpoint', { phase: 3, result: 'pass' }, { onWarning });
    expect(onWarning).not.toHaveBeenCalled();
  });
});
