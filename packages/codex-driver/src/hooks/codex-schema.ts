/**
 * Codex `hooks.json` schema translation, per `developers.openai.com/codex/hooks`.
 *
 * SWT's internal `HookFile` (in `./writer.ts`) uses snake_case event names and
 * a flat shape:
 *
 *   { session_start: [{command, match?, cwd?, tags?}], pre_tool_use: [...], ... }
 *
 * Codex's documented `hooks.json` schema is PascalCase + nested:
 *
 *   { "hooks": { "SessionStart": [{matcher?, hooks: [{type: "command", command, timeout?}]}], ... } }
 *
 * `buildCodexHookFile` translates one to the other. SWT's flat schema stays
 * unchanged for backward compat; this layer is the emit-time translation.
 */
import type { HookFile } from './writer.js';

/** snake_case → PascalCase event-name map per the Codex documented schema. */
export const CODEX_HOOK_EVENT_NAMES: Readonly<Record<keyof HookFile, string>> = {
  session_start: 'SessionStart',
  user_prompt_submit: 'UserPromptSubmit',
  pre_tool_use: 'PreToolUse',
  post_tool_use: 'PostToolUse',
  permission_request: 'PermissionRequest',
  stop: 'Stop',
} as const;

export interface CodexHookCommand {
  readonly type: 'command';
  readonly command: string;
  readonly statusMessage?: string;
  readonly timeout?: number;
}

export interface CodexHookEntry {
  readonly matcher?: string;
  readonly hooks: readonly CodexHookCommand[];
}

export interface CodexHookFile {
  readonly hooks: Readonly<Record<string, readonly CodexHookEntry[]>>;
}

/**
 * Default Codex hook command timeout in seconds, per the Codex docs example
 * payload. Codex emits this as a fallback when the user doesn't pin one.
 */
const CODEX_DEFAULT_HOOK_TIMEOUT_SEC = 600;

/**
 * Translate SWT's flat snake_case `HookFile` to Codex's nested PascalCase
 * `hooks.json` schema. Does NOT mutate the input.
 *
 * Translation rules:
 * - snake_case event keys → PascalCase per `CODEX_HOOK_EVENT_NAMES`.
 * - SWT's `match` field → Codex's `matcher` field (renamed per docs).
 * - SWT's `command` → wrapped in Codex's nested `hooks` array with `type: "command"` and the documented default timeout.
 * - SWT's `cwd` and `tags` are SWT-only debugging fields — dropped during translation (not in Codex's documented schema).
 * - Empty arrays for any event are preserved (so consumers can detect "configured but no hooks").
 */
export function buildCodexHookFile(file: HookFile): CodexHookFile {
  const hooks: Record<string, CodexHookEntry[]> = {};
  for (const swtKey of Object.keys(CODEX_HOOK_EVENT_NAMES) as ReadonlyArray<keyof HookFile>) {
    const codexKey = CODEX_HOOK_EVENT_NAMES[swtKey];
    const entries = file[swtKey];
    hooks[codexKey] = entries.map((entry) => {
      const command: CodexHookCommand = {
        type: 'command',
        command: entry.command,
        timeout: CODEX_DEFAULT_HOOK_TIMEOUT_SEC,
      };
      const codexEntry: CodexHookEntry =
        entry.match !== undefined
          ? { matcher: entry.match, hooks: [command] }
          : { hooks: [command] };
      return codexEntry;
    });
  }
  return { hooks };
}
