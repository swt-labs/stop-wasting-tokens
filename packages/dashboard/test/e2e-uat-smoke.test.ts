/**
 * Plan 04-05 T2 — End-to-end smoke test for the UAT checkpoint round-trip.
 *
 * What this validates:
 *
 *   1. The dashboard exposes `POST /api/uat/:phase/checkpoint` as the closure
 *      endpoint that the Phase 3 03-03 `swt verify` INLINE handler invokes
 *      from the orchestrator (or the dashboard UatModal posts directly).
 *   2. A real `*-UAT.md` file on disk gains an appended `### P{NN}-T{NN}` block
 *      with the scenario, result, and (optional) notes — exactly the shape
 *      `swt verify`'s file-format contract expects.
 *   3. The test number auto-increments based on existing blocks; the second
 *      checkpoint of the same phase writes `P{NN}-T02` after `P{NN}-T01`.
 *
 * This is the final hop of the verify INLINE control surface: askUser opens
 * the card (covered by e2e-askuser-smoke), the user selects PASS/FAIL/SKIP,
 * the dashboard UatModal POSTs to /api/uat/:phase/checkpoint, and THAT route
 * mutates the artifact. If this contract drifts, verify's recovery loop on
 * resume reads stale UAT.md state and the QA lifecycle breaks.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerUatCheckpointRoute } from '../src/server/routes/uat-checkpoint.js';

describe('e2e: UAT checkpoint round-trip (verify INLINE → POST /api/uat/:phase/checkpoint → UAT.md append)', () => {
  let projectRoot: string;
  let app: Hono;
  let uatPath: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'swt-e2e-uat-'));
    const phaseDir = path.join(projectRoot, '.swt-planning', 'phases', '04-fixture');
    mkdirSync(phaseDir, { recursive: true });
    uatPath = path.join(phaseDir, '04-UAT.md');
    writeFileSync(
      uatPath,
      '# Phase 04 UAT\n\nUser-acceptance scenarios for the fixture phase.\n',
    );
    app = new Hono();
    registerUatCheckpointRoute(app, projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('first checkpoint: POST writes ### P04-T01 block with scenario + pass result + notes', async () => {
    const res = await app.request('http://x/api/uat/04-fixture/checkpoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: 'Dashboard launches at 127.0.0.1:54321 when user types bare `swt`',
        result: 'pass',
        note: 'Confirmed on macOS 14.5 with Safari + Chrome.',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean; path: string };
    expect(body.saved).toBe(true);
    expect(body.path).toContain('04-UAT.md');

    const updated = readFileSync(uatPath, 'utf8');
    expect(updated).toContain('### P04-T01: Dashboard launches at 127.0.0.1:54321');
    expect(updated).toContain('**Scenario:** Dashboard launches at 127.0.0.1:54321');
    expect(updated).toContain('**Result:** pass');
    expect(updated).toContain('**Notes:** Confirmed on macOS 14.5');
  });

  it('second checkpoint auto-increments to P04-T02 after P04-T01 exists', async () => {
    // First checkpoint
    await app.request('http://x/api/uat/04-fixture/checkpoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: 'First scenario',
        result: 'pass',
      }),
    });

    // Second checkpoint should be T02
    const res = await app.request('http://x/api/uat/04-fixture/checkpoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: 'Second scenario',
        result: 'fail',
        note: 'Reproduces on cold start.',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean; path: string };
    expect(body.saved).toBe(true);

    const updated = readFileSync(uatPath, 'utf8');
    expect(updated).toContain('### P04-T01: First scenario');
    expect(updated).toContain('### P04-T02: Second scenario');
    expect(updated).toContain('**Result:** fail');
    expect(updated).toContain('**Notes:** Reproduces on cold start.');
  });

  it('rejects unknown phase with 404 (verify gate before mutating any file)', async () => {
    const res = await app.request('http://x/api/uat/99-nonexistent/checkpoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'X', result: 'pass' }),
    });
    expect(res.status).toBe(404);
    // Original UAT.md untouched.
    const original = readFileSync(uatPath, 'utf8');
    expect(original).not.toContain('### P');
  });

  it('rejects invalid body with 400 before mutating any file', async () => {
    const res = await app.request('http://x/api/uat/04-fixture/checkpoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: 'maybe' }), // missing scenario; invalid result
    });
    expect(res.status).toBe(400);
    const original = readFileSync(uatPath, 'utf8');
    expect(original).not.toContain('### P');
  });
});
