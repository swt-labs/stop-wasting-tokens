import { describe, expect, it } from 'vitest';

import { applySandboxToPrompt, SANDBOX_PREAMBLES } from '../../src/sandbox/wrapper.js';

describe('applySandboxToPrompt', () => {
  it('read-only mode produces a preamble that forbids mutations and includes the cwd', () => {
    const result = applySandboxToPrompt('You are the Scout.', 'read-only', '/tmp/proj');
    expect(result).toContain('SANDBOX MODE: read-only');
    expect(result).toContain('MUST NOT mutate the filesystem');
    expect(result).toContain('/tmp/proj');
    expect(result).toContain('You are the Scout.');
  });

  it('workspace-write mode references the cwd as the writable subtree', () => {
    const result = applySandboxToPrompt('Dev instructions.', 'workspace-write', '/repo/app');
    expect(result).toContain('SANDBOX MODE: workspace-write');
    expect(result).toContain('within the working directory /repo/app and its subtree');
    expect(result).toContain('Dev instructions.');
  });

  it('danger-full-access mode notes no sandbox + still includes the cwd marker', () => {
    const result = applySandboxToPrompt('Debugger.', 'danger-full-access', '/var/tmp');
    expect(result).toContain('SANDBOX MODE: danger-full-access');
    expect(result).toContain('No sandbox');
    expect(result).toContain('Working directory: /var/tmp');
  });

  it('undefined mode falls back to workspace-write semantics', () => {
    const result = applySandboxToPrompt('Lead.', undefined, '/cwd');
    expect(result).toContain('SANDBOX MODE: workspace-write');
    expect(result).toContain('Lead.');
  });

  it('is a pure function — same inputs always produce identical output', () => {
    const a = applySandboxToPrompt('prompt', 'read-only', '/x');
    const b = applySandboxToPrompt('prompt', 'read-only', '/x');
    expect(a).toBe(b);
    expect(SANDBOX_PREAMBLES['read-only']('/x')).toBe(SANDBOX_PREAMBLES['read-only']('/x'));
  });
});
