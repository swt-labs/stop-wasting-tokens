import { describe, expect, it } from 'vitest';

import { EMPTY_HOOK_FILE, HookFileSchema, emitHooksJson } from '../src/hooks/writer.js';

describe('hooks.json writer', () => {
  it('parses an empty file with all six event arrays', () => {
    expect(EMPTY_HOOK_FILE.session_start).toEqual([]);
    expect(EMPTY_HOOK_FILE.user_prompt_submit).toEqual([]);
    expect(EMPTY_HOOK_FILE.pre_tool_use).toEqual([]);
    expect(EMPTY_HOOK_FILE.post_tool_use).toEqual([]);
    expect(EMPTY_HOOK_FILE.permission_request).toEqual([]);
    expect(EMPTY_HOOK_FILE.stop).toEqual([]);
  });

  it('serialises a populated hook file as pretty JSON with a trailing newline', () => {
    const out = emitHooksJson({
      ...EMPTY_HOOK_FILE,
      pre_tool_use: [{ command: 'bash hooks/file-guard.mjs' }],
    });
    expect(out.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    const preToolUse = parsed.pre_tool_use as Array<Record<string, unknown>>;
    expect(preToolUse[0]?.command).toBe('bash hooks/file-guard.mjs');
  });

  it('rejects malformed entries via the schema', () => {
    expect(() =>
      HookFileSchema.parse({
        session_start: [{ command: '' }],
        user_prompt_submit: [],
        pre_tool_use: [],
        post_tool_use: [],
        permission_request: [],
        stop: [],
      }),
    ).toThrow();
  });
});
