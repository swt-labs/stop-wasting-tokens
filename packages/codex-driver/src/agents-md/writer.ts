export const SWT_BEGIN_FENCE = '<!-- SWT BEGIN -->';
export const SWT_END_FENCE = '<!-- SWT END -->';
export const OVERRIDE_BEGIN_FENCE = '<!-- SWT OVERRIDE BEGIN -->';
export const OVERRIDE_END_FENCE = '<!-- SWT OVERRIDE END -->';
export const AGENTS_OVERRIDE_FILENAME = 'AGENTS.override.md';
export const PROJECT_DOC_MAX_BYTES = 32 * 1024;

export interface AgentsMdWriteResult {
  readonly content: string;
  readonly byteLength: number;
  readonly exceedsLimit: boolean;
}

/**
 * Returns the new AGENTS.md content with the SWT block replaced. If no SWT
 * block exists yet, the new block is appended (separated by a blank line).
 * The method is pure — callers persist the result themselves.
 */
export function writeAgentsMdBlock(existing: string, swtBody: string): AgentsMdWriteResult {
  const fenced = `${SWT_BEGIN_FENCE}\n${swtBody.trim()}\n${SWT_END_FENCE}`;

  let next: string;
  const beginIdx = existing.indexOf(SWT_BEGIN_FENCE);
  const endIdx = existing.indexOf(SWT_END_FENCE);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + SWT_END_FENCE.length);
    next = `${before}${fenced}${after}`;
  } else if (existing.length === 0) {
    next = `${fenced}\n`;
  } else {
    const sep = existing.endsWith('\n') ? '\n' : '\n\n';
    next = `${existing}${sep}${fenced}\n`;
  }

  const byteLength = Buffer.byteLength(next, 'utf8');
  return {
    content: next,
    byteLength,
    exceedsLimit: byteLength > PROJECT_DOC_MAX_BYTES,
  };
}

/**
 * Strip an SWT-managed block from an AGENTS.md document, leaving everything
 * else in place. Returns the original input unchanged if no block is found.
 */
export function stripAgentsMdBlock(existing: string): string {
  const beginIdx = existing.indexOf(SWT_BEGIN_FENCE);
  const endIdx = existing.indexOf(SWT_END_FENCE);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) return existing;
  const before = existing.slice(0, beginIdx);
  const after = existing.slice(endIdx + SWT_END_FENCE.length);
  return `${before.replace(/\s+$/, '')}\n${after.replace(/^\s+/, '')}`.replace(/\n{3,}/g, '\n\n');
}

/**
 * F-15 — Compose the body that will be written between SWT BEGIN/END fences,
 * folding in optional `AGENTS.override.md` content so user customizations
 * survive every regeneration. The override appears as a clearly fenced
 * sub-section so the user can find and edit it.
 *
 * Empty / whitespace-only overrides are ignored (no fence appears at all).
 */
export function composeAgentsMdBody(swtBody: string, overrideContent?: string): string {
  const base = swtBody.trim();
  if (overrideContent === undefined) return base;
  const trimmed = overrideContent.trim();
  if (trimmed.length === 0) return base;
  const overrideBlock = `${OVERRIDE_BEGIN_FENCE}\n${trimmed}\n${OVERRIDE_END_FENCE}`;
  return base.length === 0 ? overrideBlock : `${base}\n\n${overrideBlock}`;
}

/**
 * F-15 — Synchronous reader for `AGENTS.override.md` at a project root.
 * Returns the file contents as UTF-8 string, or `null` when missing.
 * Filesystem errors other than ENOENT are surfaced.
 */
export function readAgentsOverrideSync(projectRoot: string): string | null {
  // Late require to avoid pulling node:fs into pure-emit consumers.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  const path = `${projectRoot.replace(/[\/\\]+$/, '')}/${AGENTS_OVERRIDE_FILENAME}`;
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
