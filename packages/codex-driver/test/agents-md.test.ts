import { describe, expect, it } from 'vitest';

import {
  PROJECT_DOC_MAX_BYTES,
  SWT_BEGIN_FENCE,
  SWT_END_FENCE,
  stripAgentsMdBlock,
  writeAgentsMdBlock,
} from '../src/agents-md/writer.js';

describe('AGENTS.md writer', () => {
  it('appends a fenced block when none exists', () => {
    const result = writeAgentsMdBlock('# Project\n\nSome user content.\n', 'SWT rules');
    expect(result.content).toContain(SWT_BEGIN_FENCE);
    expect(result.content).toContain(SWT_END_FENCE);
    expect(result.content).toContain('# Project');
    expect(result.content).toContain('Some user content.');
    expect(result.exceedsLimit).toBe(false);
  });

  it('replaces an existing SWT block in place', () => {
    const original = `# Project\n\n${SWT_BEGIN_FENCE}\nold rules\n${SWT_END_FENCE}\n\nUser tail.\n`;
    const result = writeAgentsMdBlock(original, 'new rules');
    expect(result.content).toContain('new rules');
    expect(result.content).not.toContain('old rules');
    expect(result.content).toContain('# Project');
    expect(result.content).toContain('User tail.');
  });

  it('flags when content exceeds the project_doc_max_bytes limit', () => {
    const big = 'x'.repeat(PROJECT_DOC_MAX_BYTES + 1024);
    const result = writeAgentsMdBlock('', big);
    expect(result.exceedsLimit).toBe(true);
    expect(result.byteLength).toBeGreaterThan(PROJECT_DOC_MAX_BYTES);
  });

  it('strips an SWT block while preserving surrounding content', () => {
    const original = `# Project\n\n${SWT_BEGIN_FENCE}\nrules\n${SWT_END_FENCE}\n\nUser tail.\n`;
    const stripped = stripAgentsMdBlock(original);
    expect(stripped).toContain('# Project');
    expect(stripped).toContain('User tail.');
    expect(stripped).not.toContain(SWT_BEGIN_FENCE);
    expect(stripped).not.toContain('rules');
  });

  it('returns the original content when no block is present', () => {
    const original = '# Project\n\nNo fences here.\n';
    expect(stripAgentsMdBlock(original)).toBe(original);
  });
});
