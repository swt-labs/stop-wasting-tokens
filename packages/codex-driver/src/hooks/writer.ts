import { z } from 'zod';

import { buildCodexHookFile, type CodexHookFile } from './codex-schema.js';

const HookEntrySchema = z.object({
  /** Glob/path of the matcher (event-specific). */
  match: z.string().optional(),
  /** Shell command Codex runs when the event fires. */
  command: z.string().min(1),
  /** Optional working directory for the command. */
  cwd: z.string().optional(),
  /** Optional structured tags for SWT-side debugging. */
  tags: z.array(z.string()).optional(),
});

export const HookFileSchema = z.object({
  session_start: z.array(HookEntrySchema).default([]),
  user_prompt_submit: z.array(HookEntrySchema).default([]),
  pre_tool_use: z.array(HookEntrySchema).default([]),
  post_tool_use: z.array(HookEntrySchema).default([]),
  permission_request: z.array(HookEntrySchema).default([]),
  stop: z.array(HookEntrySchema).default([]),
});

export type HookEntry = z.infer<typeof HookEntrySchema>;
export type HookFile = z.infer<typeof HookFileSchema>;

export const EMPTY_HOOK_FILE: HookFile = HookFileSchema.parse({});

export function emitHooksJson(file: HookFile): string {
  // Validate before stringifying so callers can't slip a malformed shape past us.
  const parsed = HookFileSchema.parse(file);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * Emit the Codex-conformant `hooks.json` per `developers.openai.com/codex/hooks`.
 * Translates SWT's flat snake_case schema to Codex's nested PascalCase shape
 * via `buildCodexHookFile`, then JSON-stringifies with a trailing newline.
 *
 * This is the function the codex-driver's installer should call when writing
 * `~/.codex/hooks.json` — `emitHooksJson` (above) is for SWT-internal storage.
 */
export function emitCodexHooksJson(file: HookFile): string {
  const parsed = HookFileSchema.parse(file);
  const codexFile: CodexHookFile = buildCodexHookFile(parsed);
  return `${JSON.stringify(codexFile, null, 2)}\n`;
}

/**
 * Emit the `[features] codex_hooks = true` TOML block to enable Codex's
 * experimental hooks feature per `developers.openai.com/codex/config-advanced`.
 * Callers should merge this into the user's `~/.codex/config.toml`.
 */
export function emitCodexHooksFeatureFlag(): string {
  return '[features]\ncodex_hooks = true\n';
}
