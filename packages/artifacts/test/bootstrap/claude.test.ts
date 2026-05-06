import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeOrUpdateClaudeMd } from '../../src/bootstrap/claude.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-claude-'));
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeOrUpdateClaudeMd', () => {
  it('creates a fresh CLAUDE.md when none exists', async () => {
    const path = join(dir, 'CLAUDE.md');
    await writeOrUpdateClaudeMd({
      path,
      project_name: 'swt',
      core_value: 'discipline',
      preserve_existing: true,
    });
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('# swt');
    expect(raw).toContain('**Core value:** discipline');
    expect(raw).toContain('## Active Context');
    expect(raw).toContain('## VBW Rules');
    expect(raw).toContain('## Plugin Isolation');
    expect(raw).toContain('## Code Intelligence');
  });

  it('preserves user content and only refreshes canonical sections', async () => {
    const path = join(dir, 'CLAUDE.md');
    await writeFile(
      path,
      [
        '# my-project',
        '',
        'My personal notes about the project — keep this!',
        '',
        '## Build commands',
        '',
        'pnpm install',
        'pnpm build',
        '',
        '## Active Context',
        '',
        'old work content that should be replaced',
        '',
      ].join('\n'),
      'utf8',
    );

    await writeOrUpdateClaudeMd({
      path,
      project_name: 'my-project',
      core_value: 'fresh',
      preserve_existing: true,
    });

    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('My personal notes');
    expect(raw).toContain('## Build commands');
    expect(raw).toContain('pnpm install');
    expect(raw).not.toContain('old work content');
    expect(raw).toContain('## Active Context');
    expect(raw).toContain('Run `swt vibe`');
  });

  it('skips Code Intelligence when equivalent guidance already exists', async () => {
    const path = join(dir, 'CLAUDE.md');
    await writeFile(
      path,
      [
        '# my-project',
        '',
        '## Code Navigation Tips',
        '',
        'Use goToDefinition and findReferences for LSP-first navigation.',
        '',
        '## Active Context',
        '',
        'whatever',
        '',
      ].join('\n'),
      'utf8',
    );

    await writeOrUpdateClaudeMd({
      path,
      project_name: 'my-project',
      core_value: 'x',
      preserve_existing: true,
    });

    const raw = await readFile(path, 'utf8');
    // Code Intelligence section should NOT have been added because the existing
    // doc already references goToDefinition / findReferences.
    expect(raw.match(/## Code Intelligence/g)).toBeNull();
  });
});
