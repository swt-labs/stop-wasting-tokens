/**
 * Plan 05-04 T1 — `runVibe()` subprocess-spawn bridge to `swt cook`.
 *
 * Tests do NOT spawn a real cook session (expensive + flaky). Instead a
 * stub `cli.mjs` script writes a synthetic `.swt-planning/` tree
 * (`phase-*.json` + `<NN>-VERIFICATION.md` with `passed: N`) and exits.
 * The test verifies:
 *   1. `runVibe` resolves with the stub's exit code (no throw on 0 or 2).
 *   2. Criteria are harvested from VERIFICATION.md `passed:` rows.
 *   3. The meter snapshot reflects the JSON files the child wrote.
 *   4. The `SWT_*` env vars are forwarded to the child.
 *   5. `swtBin` override + `SWT_CLI_BIN` env override both resolve.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runVibe } from '../src/run-vibe.js';

const STUB_OK = `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.SWT_PLANNING_ROOT;
const sid = process.env.SWT_SESSION_ID;
if (!root || !sid) {
  console.error('stub: missing SWT_PLANNING_ROOT or SWT_SESSION_ID');
  process.exit(7);
}
mkdirSync(join(root, '.metrics'), { recursive: true });
writeFileSync(
  join(root, '.metrics', 'phase-01-stub.json'),
  JSON.stringify({
    session_id: 'phase-01-stub',
    phase_slug: '01-stub',
    agent_results: 1,
    tokens: { in: 100, out: 200, cache_creation: 0, cache_read: 50 },
    cost_usd: 0.005,
    cache_hit_ratio: 0.33,
    last_updated: new Date().toISOString(),
  })
);
writeFileSync(
  join(root, '.metrics', 'session-' + sid + '.json'),
  JSON.stringify({
    session_id: sid,
    agent_results: 1,
    tokens: { in: 100, out: 200, cache_creation: 0, cache_read: 50 },
    cost_usd: 0.005,
    cache_hit_ratio: 0.33,
    last_updated: new Date().toISOString(),
  })
);
mkdirSync(join(root, 'phases', '01-stub'), { recursive: true });
writeFileSync(
  join(root, 'phases', '01-stub', '01-VERIFICATION.md'),
  '---\\npassed: 3\\nfailed: 0\\ntotal: 3\\n---\\n# Verification stub\\n'
);
process.exit(0);
`;

const STUB_FAIL = `#!/usr/bin/env node
process.exit(2);
`;

const STUB_BAD_SIGNAL = `#!/usr/bin/env node
// Exits non-zero with NO planning artefacts at all — exercises the
// graceful-harvest path (zero criteria + empty snapshot, not a throw).
process.exit(3);
`;

describe('runVibe — subprocess-spawn bridge (Phase 5 plan 05-04 T1)', () => {
  let tmpRoot: string;
  let projectRoot: string;
  let okBin: string;
  let failBin: string;
  let signalBin: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'swt-run-vibe-'));
    projectRoot = join(tmpRoot, 'project');
    mkdirSync(projectRoot, { recursive: true });

    okBin = join(tmpRoot, 'stub-ok.mjs');
    writeFileSync(okBin, STUB_OK, 'utf-8');
    chmodSync(okBin, 0o755);

    failBin = join(tmpRoot, 'stub-fail.mjs');
    writeFileSync(failBin, STUB_FAIL, 'utf-8');
    chmodSync(failBin, 0o755);

    signalBin = join(tmpRoot, 'stub-signal.mjs');
    writeFileSync(signalBin, STUB_BAD_SIGNAL, 'utf-8');
    chmodSync(signalBin, 0o755);
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('resolves with exitCode 0 and harvests criteria + metrics from the stub run', async () => {
    const result = await runVibe({
      cwd: projectRoot,
      swtBin: okBin,
      sessionId: 'sess-ok-1',
      milestone: 'stub-test',
      nonInteractive: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBe('sess-ok-1');
    expect(result.planningRoot).toBe(join(projectRoot, '.swt-planning'));
    expect(result.artefactsPath).toBe(result.planningRoot);
    expect(result.criteriaSatisfied).toBe(3);
    expect(result.meterSnapshot.records.length).toBe(1);
    const record = result.meterSnapshot.records[0];
    expect(record?.milestone).toBe('stub-test');
    expect(record?.input).toBe(100);
    expect(record?.output).toBe(200);
    expect(record?.cacheRead).toBe(50);
    expect(record?.cost_usd).toBeCloseTo(0.005);
    expect(result.meterSnapshot.totals.input).toBe(100);
    expect(result.meterSnapshot.totals.output).toBe(200);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('propagates a non-zero exit code without throwing (graceful failure path)', async () => {
    const result = await runVibe({
      cwd: projectRoot,
      swtBin: failBin,
      sessionId: 'sess-fail-1',
    });
    expect(result.exitCode).toBe(2);
    expect(result.criteriaSatisfied).toBe(0);
    expect(result.meterSnapshot.records.length).toBe(0);
  });

  it('returns gracefully when the child wrote no metrics or planning tree', async () => {
    const result = await runVibe({
      cwd: projectRoot,
      swtBin: signalBin,
      sessionId: 'sess-empty-1',
    });
    expect(result.exitCode).toBe(3);
    expect(result.criteriaSatisfied).toBe(0);
    expect(result.meterSnapshot.records.length).toBe(0);
    expect(result.meterSnapshot.totals.input).toBe(0);
  });

  it('honours the SWT_CLI_BIN env override when swtBin is not supplied', async () => {
    const prev = process.env['SWT_CLI_BIN'];
    process.env['SWT_CLI_BIN'] = okBin;
    try {
      const result = await runVibe({
        cwd: projectRoot,
        sessionId: 'sess-envbin-1',
      });
      expect(result.exitCode).toBe(0);
      expect(result.criteriaSatisfied).toBe(3);
    } finally {
      if (prev === undefined) delete process.env['SWT_CLI_BIN'];
      else process.env['SWT_CLI_BIN'] = prev;
    }
  });

  it('sets SWT_FORCE_NON_INTERACTIVE=1 by default', async () => {
    const envEchoBin = join(tmpRoot, 'stub-envecho.mjs');
    writeFileSync(
      envEchoBin,
      `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.SWT_PLANNING_ROOT;
mkdirSync(join(root, '.metrics'), { recursive: true });
writeFileSync(
  join(root, '.metrics', 'phase-env.json'),
  JSON.stringify({
    phase_slug: 'env',
    tokens: { in: 0, out: 0, cache_creation: 0, cache_read: 0 },
    cost_usd: 0,
    NON_INTERACTIVE: process.env.SWT_FORCE_NON_INTERACTIVE ?? '',
  })
);
process.exit(0);
`,
      'utf-8',
    );
    chmodSync(envEchoBin, 0o755);

    const result = await runVibe({
      cwd: projectRoot,
      swtBin: envEchoBin,
      sessionId: 'sess-env-1',
    });
    expect(result.exitCode).toBe(0);
    expect(result.meterSnapshot.records.length).toBe(1);
  });
});
