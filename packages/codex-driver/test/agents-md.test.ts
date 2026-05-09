import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AGENTS_OVERRIDE_FILENAME,
  OVERRIDE_BEGIN_FENCE,
  OVERRIDE_END_FENCE,
  PROJECT_DOC_MAX_BYTES,
  SWT_BEGIN_FENCE,
  SWT_END_FENCE,
  composeAgentsMdBody,
  readAgentsOverrideSync,
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

describe('AGENTS.override.md support (F-15)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-agents-override-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('composeAgentsMdBody returns the SWT body alone when no override is supplied', () => {
    expect(composeAgentsMdBody('rule one\nrule two')).toBe('rule one\nrule two');
  });

  it('composeAgentsMdBody appends override content inside its own fence', () => {
    const out = composeAgentsMdBody('SWT body', 'extra user rule');
    expect(out).toContain('SWT body');
    expect(out).toContain(OVERRIDE_BEGIN_FENCE);
    expect(out).toContain(OVERRIDE_END_FENCE);
    expect(out).toContain('extra user rule');
    expect(out.indexOf(OVERRIDE_BEGIN_FENCE)).toBeGreaterThan(out.indexOf('SWT body'));
  });

  it('composeAgentsMdBody ignores empty / whitespace-only overrides', () => {
    expect(composeAgentsMdBody('SWT body', '')).toBe('SWT body');
    expect(composeAgentsMdBody('SWT body', '   \n\n   ')).toBe('SWT body');
  });

  it('readAgentsOverrideSync returns null when the file is missing', () => {
    expect(readAgentsOverrideSync(projectRoot)).toBeNull();
  });

  it('readAgentsOverrideSync reads the override file when present', () => {
    writeFileSync(
      path.join(projectRoot, AGENTS_OVERRIDE_FILENAME),
      'project-specific rule\n',
      'utf8',
    );
    const content = readAgentsOverrideSync(projectRoot);
    expect(content).toBe('project-specific rule\n');
  });

  it('writeAgentsMdBlock + composeAgentsMdBody round-trip preserves overrides across regeneration', () => {
    const overrideText = 'team-style: prefer Solid over React';
    const initial = writeAgentsMdBlock('', composeAgentsMdBody('SWT v1', overrideText));
    expect(initial.content).toContain(overrideText);

    // Simulate a subsequent regeneration with new SWT body but the same override:
    const regenerated = writeAgentsMdBlock(
      initial.content,
      composeAgentsMdBody('SWT v2', overrideText),
    );
    expect(regenerated.content).toContain('SWT v2');
    expect(regenerated.content).not.toContain('SWT v1');
    expect(regenerated.content).toContain(overrideText);
    expect(regenerated.content).toContain(OVERRIDE_BEGIN_FENCE);
  });
});
