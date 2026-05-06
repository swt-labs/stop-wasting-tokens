import { z } from 'zod';

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
