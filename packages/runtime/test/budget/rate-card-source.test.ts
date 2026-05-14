/**
 * Phase 2 / Plan 02-01 T3 (G-R3) — createRateCardSource unit tests.
 *
 * Pins the loader contract:
 *
 *   1. Resolution order — embedded fallback vs. project-override
 *      preference vs. explicit-path override.
 *   2. find() lookup semantics — provider+model match, provider-only
 *      first-match, miss returns undefined.
 *   3. ageMs() staleness telemetry — uses an injected clock, returns the
 *      delta against the OLDEST entry's updated_at.
 *   4. Zod validation at construction — malformed JSON (missing
 *      schema_version, empty entries) throws at load time, not lazily at
 *      first find().
 *
 * Tests use node:fs tmpdir helpers for isolated test roots so each case
 * cleans up after itself; the embedded snapshot at
 * `packages/runtime/src/budget/rate-card.embedded.json` is the fallback
 * when no project file exists.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { createRateCardSource } from '../../src/budget/rate-card-source.js';

function makeTmpCwd(): string {
  return mkdtempSync(resolve(tmpdir(), 'rate-card-'));
}

function writeProjectOverride(cwd: string, content: unknown): void {
  const dir = resolve(cwd, '.swt-planning');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'rate-card.json'), JSON.stringify(content));
}

describe('createRateCardSource — resolution order', () => {
  test('falls through to embedded snapshot when no project file exists', () => {
    const cwd = makeTmpCwd();
    try {
      const source = createRateCardSource({ cwd });
      const card = source.readCurrent();
      expect(card.schema_version).toBe(1);
      expect(card.source).toBe('embedded');
      expect(card.entries.length).toBeGreaterThanOrEqual(6);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('prefers project-override over embedded when file exists', () => {
    const cwd = makeTmpCwd();
    try {
      writeProjectOverride(cwd, {
        schema_version: 1,
        // The file may declare any source label; the loader overrides to
        // 'project-override' so telemetry reflects the actual resolution.
        source: 'embedded',
        generated_at: '2026-05-14T00:00:00Z',
        entries: [
          {
            provider: 'test-provider',
            model: 'test-model',
            input_per_1k: 0.001,
            output_per_1k: 0.002,
            updated_at: '2026-05-14T00:00:00Z',
          },
        ],
      });
      const source = createRateCardSource({ cwd });
      const card = source.readCurrent();
      expect(card.source).toBe('project-override');
      expect(card.entries[0]?.provider).toBe('test-provider');
      expect(card.entries[0]?.model).toBe('test-model');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('explicit opts.path bypasses both project-override and embedded', () => {
    const cwd = makeTmpCwd();
    try {
      // Write BOTH the project override AND an explicit path; opts.path wins.
      writeProjectOverride(cwd, {
        schema_version: 1,
        source: 'embedded',
        generated_at: '2026-05-14T00:00:00Z',
        entries: [
          {
            provider: 'project-wins-not',
            model: 'project-wins-not',
            input_per_1k: 0.999,
            output_per_1k: 0.999,
            updated_at: '2026-05-14T00:00:00Z',
          },
        ],
      });
      const explicitPath = resolve(cwd, 'explicit.json');
      writeFileSync(
        explicitPath,
        JSON.stringify({
          schema_version: 1,
          source: 'embedded',
          generated_at: '2026-05-14T00:00:00Z',
          entries: [
            {
              provider: 'explicit-wins',
              model: 'explicit-wins',
              input_per_1k: 0.5,
              output_per_1k: 0.5,
              updated_at: '2026-05-14T00:00:00Z',
            },
          ],
        }),
      );
      const source = createRateCardSource({ cwd, path: explicitPath });
      const card = source.readCurrent();
      expect(card.source).toBe('project-override');
      expect(card.entries[0]?.provider).toBe('explicit-wins');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('createRateCardSource — find()', () => {
  test('find(provider, model) returns matching entry', () => {
    const cwd = makeTmpCwd();
    try {
      const source = createRateCardSource({ cwd });
      const entry = source.find('anthropic', 'claude-opus-4-7');
      expect(entry).toBeDefined();
      expect(entry!.provider).toBe('anthropic');
      expect(entry!.model).toBe('claude-opus-4-7');
      expect(entry!.input_per_1k).toBeGreaterThan(0);
      expect(entry!.output_per_1k).toBeGreaterThan(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('find(unknown-provider) returns undefined', () => {
    const cwd = makeTmpCwd();
    try {
      const source = createRateCardSource({ cwd });
      expect(source.find('nonexistent-provider')).toBeUndefined();
      expect(source.find('anthropic', 'nonexistent-model')).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('find(provider) with no model returns the first matching entry', () => {
    const cwd = makeTmpCwd();
    try {
      const source = createRateCardSource({ cwd });
      const entry = source.find('anthropic');
      expect(entry).toBeDefined();
      expect(entry!.provider).toBe('anthropic');
      // Deterministic by array order: the embedded snapshot lists
      // claude-opus-4-7 before claude-sonnet-4-5.
      expect(entry!.model).toBe('claude-opus-4-7');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('createRateCardSource — ageMs()', () => {
  test('returns clock() - oldest entry updated_at (ms)', () => {
    const cwd = makeTmpCwd();
    try {
      // Inject a clock fixed at the embedded snapshot's updated_at
      // (2026-05-14T00:00:00Z) + 1 day.
      const oneDayMs = 24 * 60 * 60 * 1000;
      const fixedNow = Date.parse('2026-05-14T00:00:00Z') + oneDayMs;
      const source = createRateCardSource({ cwd, clock: () => fixedNow });
      const age = source.ageMs();
      expect(age).toBeGreaterThanOrEqual(oneDayMs);
      // Sanity: not orders-of-magnitude off (all embedded entries share
      // the same updated_at today).
      expect(age).toBeLessThan(oneDayMs * 2);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('createRateCardSource — Zod validation on load', () => {
  test('malformed project-override (missing schema_version) throws at construction', () => {
    const cwd = makeTmpCwd();
    try {
      writeProjectOverride(cwd, {
        // missing schema_version intentionally
        source: 'embedded',
        generated_at: '2026-05-14T00:00:00Z',
        entries: [
          {
            provider: 'x',
            model: 'y',
            input_per_1k: 0.001,
            output_per_1k: 0.002,
            updated_at: '2026-05-14T00:00:00Z',
          },
        ],
      });
      expect(() => createRateCardSource({ cwd })).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('malformed project-override (empty entries) throws at construction', () => {
    const cwd = makeTmpCwd();
    try {
      writeProjectOverride(cwd, {
        schema_version: 1,
        source: 'embedded',
        generated_at: '2026-05-14T00:00:00Z',
        entries: [], // violates .min(1)
      });
      expect(() => createRateCardSource({ cwd })).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
