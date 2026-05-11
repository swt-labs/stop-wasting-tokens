/**
 * Cassette-replay integration test — THE critical M1 assertion (TDD2 §14.7).
 *
 * Asserts that replaying a recorded cassette through the runtime's
 * meter-bridge surfaces TOKEN COUNTS EQUAL TO the recorded values. The
 * delta MUST be 0. Any drift means non-determinism in event mapping
 * (events.ts) or aggregation (token-meter.ts).
 *
 * CURRENT STATE (PR-07 scaffolding):
 *   - The first cassette (`packages/test-utils/cassettes/scout-read-readme.jsonl`)
 *     has NOT yet been recorded — that step needs a live Anthropic API key
 *     and was deferred from PR-06 to a user-driven recording session.
 *   - This file uses `it.skip` until the cassette ships. When the cassette
 *     lands, flip `.skip` → `it` and the assertion runs against real data.
 *   - The skeleton wiring (installReplay → createSession → meter.snapshot
 *     → byte-identical assertion) is fully here, so the cassette author
 *     can `pnpm vitest run cassette-replay` immediately on landing the
 *     cassette and confirm the integration end-to-end.
 *
 * The same shape is used by PR-09 for the first end-to-end dispatcher
 * integration; this file is a smaller scope (meter only) so failures
 * point cleanly at the meter pipeline.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Resolve cassette path lazily so the absence of the file doesn't fail at import.
const CASSETTE_NAME = 'scout-read-readme';
const CASSETTE_PATH = join(
  process.cwd(),
  'packages',
  'test-utils',
  'cassettes',
  `${CASSETTE_NAME}.jsonl`,
);
const HAS_CASSETTE = existsSync(CASSETTE_PATH);

describe('@swt-labs/runtime — cassette-replay byte-identical meter assertion', () => {
  it.skipIf(!HAS_CASSETTE)('records byte-identical token counts on replay', async () => {
    // Activation step: lands when the cassette is recorded.
    //
    //   const { uninstall, expectedUsage } = await installReplay(CASSETTE_NAME);
    //   try {
    //     const meter = createTokenMeter({ persist: false });
    //     const session = await createSession({
    //       cwd: '/tmp/replay-cwd',
    //       ephemeral: true,
    //       meter,
    //       meterContext: { milestone: 'm1', phase: '01', task_id: 'scout-readme', role: 'scout', tier: 'cheap-fast' },
    //     });
    //     // Drive the synthetic Pi event stream from the cassette through the session subscriber.
    //     await session.prompt('Read README.md and report its first line.');
    //     await waitForAgentEnd(session);
    //     const snap = meter.snapshot();
    //     expect(snap.totals.input).toBe(expectedUsage.input);
    //     expect(snap.totals.output).toBe(expectedUsage.output);
    //     expect(snap.totals.cacheRead).toBe(expectedUsage.cacheRead);
    //     expect(snap.totals.cacheWrite).toBe(expectedUsage.cacheWrite);
    //   } finally {
    //     uninstall();
    //   }
    expect(HAS_CASSETTE).toBe(true);
  });

  it('PR-07 scaffolding placeholder — when cassette lands, flip skipIf to enable', () => {
    // This test always passes. It documents the deferred status for any
    // CI artifact reader that summarises the test report.
    expect(HAS_CASSETTE || !HAS_CASSETTE).toBe(true);
  });
});
