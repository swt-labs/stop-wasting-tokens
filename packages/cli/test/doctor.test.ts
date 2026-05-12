import { describe, expect, it } from 'vitest';

import { buildDoctorReport, renderDoctorReport } from '../src/commands/doctor.js';

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
