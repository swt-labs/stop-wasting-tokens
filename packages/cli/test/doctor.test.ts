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
});
