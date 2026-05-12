/**
 * `swt migrate --to=v3` handler tests per Plan 06-01 PR-49.
 *
 * Three fixture-driven scenarios:
 *   1. Happy path — v2 directory with `backend: 'codex'` + a frontmatter
 *      file with `reasoning_effort: high` → both rewritten in the
 *      output copy; input directory untouched.
 *   2. Missing fields — v2 directory with no `backend` field anywhere
 *      and no `reasoning_effort` keys → `fields_rewritten: 0`,
 *      no notes, output copy is a verbatim duplicate.
 *   3. Already-v3 idempotency — directory already shows `backend: 'pi'`
 *      and `thinking_level: high` → running migrate is a no-op.
 *
 * Plus argument-validation + missing-input cases.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateHandler } from '../../src/commands/migrate.js';
import { EXIT } from '../../src/exit-codes.js';
import { StringStream } from '../_helpers.js';

interface Fixture {
  root: string;
  inputDir: string;
  outputDir: string;
}

function setupFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'swt-migrate-'));
  const inputDir = path.join(root, 'v2-planning');
  const outputDir = path.join(root, 'v3-planning');
  mkdirSync(inputDir, { recursive: true });
  return { root, inputDir, outputDir };
}

function writePlanFrontmatter(filePath: string, frontmatter: string, body = ''): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `---\n${frontmatter}\n---\n${body}`, 'utf8');
}

describe('migrateHandler — v2 → v3 (M6 PR-49)', () => {
  let fixture: Fixture | undefined;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    if (fixture !== undefined) {
      try {
        rmSync(fixture.root, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    fixture = undefined;
  });

  it('happy path: rewrites backend + reasoning_effort; input directory untouched', () => {
    if (fixture === undefined) throw new Error('fixture not set');
    // v2-shaped config + a plan with reasoning_effort frontmatter.
    writeFileSync(
      path.join(fixture.inputDir, 'config.json'),
      JSON.stringify({ backend: 'codex', effort: 'balanced' }, null, 2),
      'utf8',
    );
    writePlanFrontmatter(
      path.join(fixture.inputDir, 'phases', '01-bootstrap', '01-01-PLAN.md'),
      `title: bootstrap\nreasoning_effort: high\n  reasoning_effort: medium`,
      '\n# Plan\n\nContents.\n',
    );

    const stdout = new StringStream();
    const stderr = new StringStream();
    const exit = migrateHandler(
      {
        verb: 'migrate',
        positionals: [],
        flags: { to: 'v3', input: 'v2-planning', output: 'v3-planning' },
      },
      { cwd: fixture.root, stdout, stderr },
    );

    expect(exit).toBe(EXIT.SUCCESS);
    // Input is untouched.
    const inputConfig = JSON.parse(
      readFileSync(path.join(fixture.inputDir, 'config.json'), 'utf8'),
    ) as { backend: string };
    expect(inputConfig.backend).toBe('codex');
    // Output is rewritten.
    const outputConfig = JSON.parse(
      readFileSync(path.join(fixture.outputDir, 'config.json'), 'utf8'),
    ) as { backend: string };
    expect(outputConfig.backend).toBe('pi');

    const planMd = readFileSync(
      path.join(fixture.outputDir, 'phases', '01-bootstrap', '01-01-PLAN.md'),
      'utf8',
    );
    expect(planMd).toContain('thinking_level: high');
    expect(planMd).toContain('thinking_level: medium');
    expect(planMd).not.toContain('reasoning_effort');
    expect(planMd).toContain('# Plan'); // body preserved

    expect(stdout.text()).toContain('swt migrate --to=v3: complete.');
    expect(stdout.text()).toContain('Fields rewritten: 3'); // backend + 2 reasoning_effort sites
  });

  it('missing fields: pure-pass-through copy; fields_rewritten = 0', () => {
    if (fixture === undefined) throw new Error('fixture not set');
    writeFileSync(
      path.join(fixture.inputDir, 'PROJECT.md'),
      '# project\n\nno frontmatter at all\n',
      'utf8',
    );
    writeFileSync(path.join(fixture.inputDir, 'STATE.md'), '# State\n\nlive\n', 'utf8');

    const stdout = new StringStream();
    const stderr = new StringStream();
    const exit = migrateHandler(
      {
        verb: 'migrate',
        positionals: [],
        flags: { to: 'v3', input: 'v2-planning', output: 'v3-planning' },
      },
      { cwd: fixture.root, stdout, stderr },
    );

    expect(exit).toBe(EXIT.SUCCESS);
    expect(existsSync(path.join(fixture.outputDir, 'PROJECT.md'))).toBe(true);
    expect(existsSync(path.join(fixture.outputDir, 'STATE.md'))).toBe(true);
    expect(stdout.text()).toContain('Fields rewritten: 0');
  });

  it('already-v3 idempotency: no-op rewrite, fields_rewritten = 0', () => {
    if (fixture === undefined) throw new Error('fixture not set');
    writeFileSync(
      path.join(fixture.inputDir, 'config.json'),
      JSON.stringify({ backend: 'pi' }, null, 2),
      'utf8',
    );
    writePlanFrontmatter(
      path.join(fixture.inputDir, 'phases', '01-test', '01-01-PLAN.md'),
      `title: already v3\nthinking_level: medium`,
      '',
    );

    const stdout = new StringStream();
    const stderr = new StringStream();
    const exit = migrateHandler(
      {
        verb: 'migrate',
        positionals: [],
        flags: { to: 'v3', input: 'v2-planning', output: 'v3-planning' },
      },
      { cwd: fixture.root, stdout, stderr },
    );

    expect(exit).toBe(EXIT.SUCCESS);
    expect(stdout.text()).toContain('Fields rewritten: 0');
    const config = JSON.parse(
      readFileSync(path.join(fixture.outputDir, 'config.json'), 'utf8'),
    ) as { backend: string };
    expect(config.backend).toBe('pi');
  });

  it('rewrites agent_backend nested inside snapshot.json', () => {
    if (fixture === undefined) throw new Error('fixture not set');
    writeFileSync(
      path.join(fixture.inputDir, 'snapshot.json'),
      JSON.stringify(
        {
          schema_version: '1',
          vibeSession: { agent_backend: 'scripted', state: 'idle' },
          legacy: [{ agent_backend: 'codex' }],
        },
        null,
        2,
      ),
      'utf8',
    );

    const stdout = new StringStream();
    const stderr = new StringStream();
    const exit = migrateHandler(
      {
        verb: 'migrate',
        positionals: [],
        flags: { to: 'v3', input: 'v2-planning', output: 'v3-planning' },
      },
      { cwd: fixture.root, stdout, stderr },
    );

    expect(exit).toBe(EXIT.SUCCESS);
    const snap = JSON.parse(
      readFileSync(path.join(fixture.outputDir, 'snapshot.json'), 'utf8'),
    ) as {
      vibeSession: { agent_backend: string };
      legacy: Array<{ agent_backend: string }>;
    };
    expect(snap.vibeSession.agent_backend).toBe('pi');
    expect(snap.legacy[0]?.agent_backend).toBe('pi');
    expect(stdout.text()).toContain('Fields rewritten: 2');
  });

  describe('argument validation', () => {
    it('returns USAGE_ERROR when --input is missing', () => {
      if (fixture === undefined) throw new Error('fixture not set');
      const stdout = new StringStream();
      const stderr = new StringStream();
      const exit = migrateHandler(
        {
          verb: 'migrate',
          positionals: [],
          flags: { to: 'v3', output: 'v3-planning' },
        },
        { cwd: fixture.root, stdout, stderr },
      );
      expect(exit).toBe(EXIT.USAGE_ERROR);
      expect(stderr.text()).toContain('usage:');
    });

    it('returns USAGE_ERROR when --output is missing', () => {
      if (fixture === undefined) throw new Error('fixture not set');
      const stdout = new StringStream();
      const stderr = new StringStream();
      const exit = migrateHandler(
        {
          verb: 'migrate',
          positionals: [],
          flags: { to: 'v3', input: 'v2-planning' },
        },
        { cwd: fixture.root, stdout, stderr },
      );
      expect(exit).toBe(EXIT.USAGE_ERROR);
    });

    it('returns USAGE_ERROR when --to is supplied with a non-v3 value', () => {
      if (fixture === undefined) throw new Error('fixture not set');
      const stdout = new StringStream();
      const stderr = new StringStream();
      const exit = migrateHandler(
        {
          verb: 'migrate',
          positionals: [],
          flags: { to: 'v2', input: 'v2-planning', output: 'v3-planning' },
        },
        { cwd: fixture.root, stdout, stderr },
      );
      expect(exit).toBe(EXIT.USAGE_ERROR);
    });

    it('returns NOT_IMPLEMENTED when --input directory does not exist', () => {
      if (fixture === undefined) throw new Error('fixture not set');
      const stdout = new StringStream();
      const stderr = new StringStream();
      const exit = migrateHandler(
        {
          verb: 'migrate',
          positionals: [],
          flags: { to: 'v3', input: 'does-not-exist', output: 'v3-planning' },
        },
        { cwd: fixture.root, stdout, stderr },
      );
      expect(exit).toBe(EXIT.NOT_IMPLEMENTED);
      expect(stderr.text()).toContain('input directory does not exist');
    });
  });
});
