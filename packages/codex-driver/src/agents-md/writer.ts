export const SWT_BEGIN_FENCE = '<!-- SWT BEGIN -->';
export const SWT_END_FENCE = '<!-- SWT END -->';
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
