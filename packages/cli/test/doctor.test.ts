import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDoctorReport, renderAuthDoctor, renderDoctorReport } from '../src/commands/doctor.js';

describe('doctor report', () => {
  it('reports OK when codex and node are healthy', async () => {
    const report = await buildDoctorReport('/tmp/swt', {
      node: () => '20.18.0',
      codex: async () => ({ version: '0.124.0', major: 0, minor: 124, patch: 0 }),
      stat: async () => ({}),
    });
    const text = renderDoctorReport(report);
    expect(text).toContain('Node 20.18.0');
    expect(text).toContain('Codex CLI 0.124.0');
    expect(text).toContain('.swt-planning/ present');
    expect(text).not.toContain('⚠');
  });

  it('warns when codex is missing and planning dir is absent', async () => {
    const report = await buildDoctorReport('/tmp/swt', {
      node: () => '18.10.0',
      codex: async () => undefined,
      stat: async () => {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      },
    });
    const text = renderDoctorReport(report);
    expect(text).toContain('Node 18.10.0 (need ≥ 20)');
    expect(text).toContain('Codex CLI not found');
    expect(text).toContain('.swt-planning/ missing');
  });

  // M2 PR-15: doctor surfaces Pi peer-dep status from SpawnerEnvironment.probe().
  it('surfaces an available Pi runtime version via report.pi', async () => {
    const report = await buildDoctorReport('/tmp/swt', {
      node: () => '20.18.0',
      codex: async () => undefined,
      pi: async () => ({ available: true, name: 'pi-runtime', version: '0.74.0' }),
      stat: async () => ({}),
    });
    expect(report.pi).toEqual({ available: true, name: 'pi-runtime', version: '0.74.0' });
    const text = renderDoctorReport(report);
    expect(text).toContain('Pi runtime 0.74.0');
  });

  it('renders a warning when Pi runtime is unavailable', async () => {
    const report = await buildDoctorReport('/tmp/swt', {
      node: () => '20.18.0',
      codex: async () => undefined,
      pi: async () => ({
        available: false,
        name: 'pi-runtime',
        reason: 'pi peerDep missing',
      }),
      stat: async () => ({}),
    });
    const text = renderDoctorReport(report);
    expect(text).toContain('Pi runtime not available');
    expect(text).toContain('pi peerDep missing');
  });

  it('lifts Pi probe info from spawnerEnv.probe() when name starts with pi-', async () => {
    const report = await buildDoctorReport('/tmp/swt', {
      node: () => '20.18.0',
      codex: async () => undefined,
      spawnerEnv: {
        async probe() {
          return { available: true, name: 'pi-runtime', version: '0.74.0' };
        },
        async getSpawner() {
          throw new Error('not needed for this test');
        },
      },
      stat: async () => ({}),
    });
    expect(report.pi?.available).toBe(true);
    expect(report.pi?.version).toBe('0.74.0');
  });

  it('does NOT surface non-Pi spawnerEnv probe as report.pi', async () => {
    const report = await buildDoctorReport('/tmp/swt', {
      node: () => '20.18.0',
      codex: async () => undefined,
      spawnerEnv: {
        async probe() {
          return { available: true, name: 'codex', version: '0.124.0' };
        },
        async getSpawner() {
          throw new Error('not needed');
        },
      },
      stat: async () => ({}),
    });
    expect(report.pi).toBeUndefined();
  });
});

describe('renderAuthDoctor (alpha.40 — keychain_improvements.md §2.1)', () => {
  it('reports MISMATCH when config has no auth block (greenfield project dir)', async () => {
    const dir = join(tmpdir(), `swt-doctor-auth-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    try {
      // No .swt-planning/config.json — greenfield. The diagnostic must
      // not crash; it surfaces the empty-config state cleanly.
      const text = await renderAuthDoctor(dir);
      expect(text).toContain('SWT doctor — credential triage:');
      expect(text).toContain('auth                  : (empty');
      expect(text).toContain('providers.strategy    : (not pinned, no auth entries)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a pinned provider + matching auth block as healthy in the round-trip section', async () => {
    const dir = join(tmpdir(), `swt-doctor-auth-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(dir, '.swt-planning'), { recursive: true });
    try {
      // Seed a config that names anthropic via OAuth and pins it.
      await writeFile(
        join(dir, '.swt-planning', 'config.json'),
        JSON.stringify(
          {
            auth: { anthropic: { mode: 'oauth', credentialRef: 'swt:anthropic:oauth' } },
            providers: { strategy: { kind: 'pinned', provider: 'anthropic' } },
            theme: 'default',
          },
          null,
          2,
        ),
      );
      const text = await renderAuthDoctor(dir);
      expect(text).toContain('auth.anthropic');
      expect(text).toContain('mode: "oauth"');
      expect(text).toContain('providers.strategy    : { kind: "pinned", provider: "anthropic" }');
      expect(text).toContain('provider            : "anthropic" (source: pinned)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports first-authed fallback when auth has entries but providers.strategy is missing', async () => {
    const dir = join(tmpdir(), `swt-doctor-auth-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(dir, '.swt-planning'), { recursive: true });
    try {
      await writeFile(
        join(dir, '.swt-planning', 'config.json'),
        JSON.stringify(
          {
            auth: { openrouter: { mode: 'api_key', credentialRef: 'swt:openrouter:api_key' } },
          },
          null,
          2,
        ),
      );
      const text = await renderAuthDoctor(dir);
      expect(text).toContain(
        'providers.strategy    : (not pinned — resolver falling back to first-authed)',
      );
      expect(text).toContain('provider            : "openrouter" (source: first-authed)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
