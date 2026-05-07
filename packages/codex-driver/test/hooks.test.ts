import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EMPTY_HOOK_FILE,
  HookFileSchema,
  emitCodexHooksFeatureFlag,
  emitCodexHooksJson,
  emitHooksJson,
} from '../src/hooks/writer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '..', '..', 'methodology', 'templates', 'agents');
const AGENT_ROLES = ['scout', 'architect', 'lead', 'dev', 'qa', 'debugger'] as const;

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

describe('emitCodexHooksJson (Codex schema translation per developers.openai.com/codex/hooks)', () => {
  it('translates snake_case event keys to PascalCase', () => {
    const out = emitCodexHooksJson({
      ...EMPTY_HOOK_FILE,
      session_start: [{ command: 'echo session' }],
      user_prompt_submit: [{ command: 'echo prompt' }],
      pre_tool_use: [{ command: 'echo pretool' }],
      post_tool_use: [{ command: 'echo posttool' }],
      permission_request: [{ command: 'echo perm' }],
      stop: [{ command: 'echo stop' }],
    });
    const parsed = JSON.parse(out) as { hooks: Record<string, unknown> };
    expect(parsed).toHaveProperty('hooks');
    expect(parsed.hooks).toHaveProperty('SessionStart');
    expect(parsed.hooks).toHaveProperty('UserPromptSubmit');
    expect(parsed.hooks).toHaveProperty('PreToolUse');
    expect(parsed.hooks).toHaveProperty('PostToolUse');
    expect(parsed.hooks).toHaveProperty('PermissionRequest');
    expect(parsed.hooks).toHaveProperty('Stop');
    // F-09 — SWT v1.5 SDLC events do NOT appear in Codex emit
    expect(parsed.hooks).not.toHaveProperty('PreArchive');
    expect(parsed.hooks).not.toHaveProperty('PostPhase');
  });

  it('nests entries with matcher + hooks array + type:command + default timeout', () => {
    const out = emitCodexHooksJson({
      ...EMPTY_HOOK_FILE,
      pre_tool_use: [{ command: 'bash hooks/file-guard.sh' }],
    });
    const parsed = JSON.parse(out) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ type: string; command: string; timeout: number }> }> };
    };
    const entry = parsed.hooks.PreToolUse[0];
    expect(entry).toBeDefined();
    expect(Array.isArray(entry?.hooks)).toBe(true);
    const inner = entry?.hooks[0];
    expect(inner?.type).toBe('command');
    expect(inner?.command).toBe('bash hooks/file-guard.sh');
    expect(inner?.timeout).toBe(600);
  });

  it('maps SWT match field → Codex matcher field', () => {
    const out = emitCodexHooksJson({
      ...EMPTY_HOOK_FILE,
      pre_tool_use: [{ command: 'echo bash-only', match: 'Bash' }],
    });
    const parsed = JSON.parse(out) as {
      hooks: { PreToolUse: Array<{ matcher?: string }> };
    };
    expect(parsed.hooks.PreToolUse[0]?.matcher).toBe('Bash');
  });

  it('drops SWT-only fields cwd and tags (not in Codex documented schema)', () => {
    const out = emitCodexHooksJson({
      ...EMPTY_HOOK_FILE,
      pre_tool_use: [{ command: 'echo dropped', cwd: '/tmp', tags: ['a'] }],
    });
    expect(out).not.toContain('cwd');
    expect(out).not.toContain('tags');
  });
});

describe('emitCodexHooksFeatureFlag', () => {
  it('returns the documented [features] codex_hooks = true block', () => {
    expect(emitCodexHooksFeatureFlag()).toBe('[features]\ncodex_hooks = true\n');
  });
});

describe('agent TOML headers (F-08 — MCP config path)', () => {
  for (const role of AGENT_ROLES) {
    it(`${role}.toml header references ~/.codex/config.toml [mcp_servers] path`, () => {
      const content = readFileSync(join(TEMPLATES_DIR, `${role}.toml`), 'utf8');
      expect(content).toContain('~/.codex/config.toml');
      expect(content).toContain('[mcp_servers.<name>]');
      // F-08 — old wrong-path reference must be gone
      expect(content).not.toContain('~/.codex/mcp.json');
    });
  }
});
