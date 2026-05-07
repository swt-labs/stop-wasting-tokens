import type { SandboxMode } from '@swt-labs/core';

/**
 * Sandbox preamble templates. Each function returns a sandbox-mode-specific
 * instruction block that gets prepended to the agent's developer_instructions
 * before sending to Ollama. The model-facing contract sets expectations; the
 * SWT-side PermissionGate (when present) is the enforcement contract.
 */
export const SANDBOX_PREAMBLES: Readonly<Record<SandboxMode, (cwd: string) => string>> = {
  'read-only': (cwd: string) =>
    `SANDBOX MODE: read-only\n` +
    `You may read files and run inspection commands but MUST NOT mutate the filesystem. ` +
    `Refuse any tool call that would write, delete, or rename files. Reply with a textual ` +
    `explanation of what you would have done instead. Working directory: ${cwd}.`,

  'workspace-write': (cwd: string) =>
    `SANDBOX MODE: workspace-write\n` +
    `You may read and write files within the working directory ${cwd} and its subtree. ` +
    `Refuse any tool call that targets paths outside this subtree. Network access is allowed.`,

  'danger-full-access': (cwd: string) =>
    `SANDBOX MODE: danger-full-access\n` +
    `No sandbox. You may read and write any path the running process can access. Use caution. ` +
    `Working directory: ${cwd}.`,
};

const DEFAULT_MODE: SandboxMode = 'workspace-write';

/**
 * Pure function: prepend a sandbox-mode preamble to the system prompt before
 * Ollama receives it. Same input + mode + cwd always produces the same output.
 *
 * Defaults to `workspace-write` when mode is undefined (matches the SWT
 * PermissionProfile default in @swt-labs/core).
 */
export function applySandboxToPrompt(
  systemPrompt: string,
  mode: SandboxMode | undefined,
  cwd: string,
): string {
  const effectiveMode = mode ?? DEFAULT_MODE;
  const preamble = SANDBOX_PREAMBLES[effectiveMode](cwd);
  return `${preamble}\n\n${systemPrompt}`;
}
