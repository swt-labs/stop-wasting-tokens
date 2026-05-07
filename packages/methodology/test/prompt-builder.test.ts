import { DEFAULT_CONFIG } from '@swt-labs/core';
import { describe, expect, it } from 'vitest';


import { buildPrompt, hashPrefix } from '../src/prompt-builder/index.js';

const FIXTURE = {
  role: 'lead' as const,
  config: DEFAULT_CONFIG,
  project_name: 'stop-wasting-tokens',
  core_value: 'Token-disciplined SDLC',
  conventions: ['Conventional Commits', 'One commit per task'],
};

describe('cache-aware prompt builder', () => {
  it('produces an identical prefix across two calls with the same config', () => {
    const a = buildPrompt({ ...FIXTURE, dynamic: 'context A' });
    const b = buildPrompt({ ...FIXTURE, dynamic: 'context B — different' });
    expect(a.prefix).toBe(b.prefix);
    expect(hashPrefix(a.prefix)).toBe(hashPrefix(b.prefix));
  });

  it('changes the prefix when a static input changes', () => {
    const a = buildPrompt({ ...FIXTURE, dynamic: 'x' });
    const b = buildPrompt({
      ...FIXTURE,
      conventions: [...FIXTURE.conventions, 'No emojis in commit messages'],
      dynamic: 'x',
    });
    expect(a.prefix).not.toBe(b.prefix);
    expect(hashPrefix(a.prefix)).not.toBe(hashPrefix(b.prefix));
  });

  it('emits the dynamic suffix and an optional task', () => {
    const built = buildPrompt({
      ...FIXTURE,
      dynamic: 'PLAN.md says: do X',
      task: 'Implement X with strict types',
    });
    expect(built.suffix).toContain('PLAN.md says: do X');
    expect(built.suffix).toContain('## Task');
    expect(built.suffix).toContain('Implement X with strict types');
  });

  it('reflects role and config in the prefix', () => {
    const built = buildPrompt({ ...FIXTURE, dynamic: '' });
    expect(built.prefix).toContain('LEAD');
    expect(built.prefix).toContain(`effort: ${DEFAULT_CONFIG.effort}`);
    expect(built.prefix).toContain(`autonomy: ${DEFAULT_CONFIG.autonomy}`);
  });
});
