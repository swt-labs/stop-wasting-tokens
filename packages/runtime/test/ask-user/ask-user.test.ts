/**
 * Plan 01-05 (Phase 1) Task 5 — askUser contract + orchestrator-only invariant.
 *
 * Six assertions per the plan's verify block:
 *   A.1 health-check fails → readline (TTY=true) → numeric selection returns
 *       the matching option label.
 *   A.2 health-check fails + non-TTY → auto-accept picks the isRecommended
 *       option AND logs the choice to stderr.
 *   A.3 health-check fails + non-TTY + no isRecommended → auto-accept picks
 *       the first option.
 *   A.4 malformed input (empty options array) throws synchronously before
 *       any IO is attempted.
 *   A.5 askUser is exported by name from `@swt-labs/runtime` (import smoke).
 *   A.6 Cross-plan invariant — `toolsForRole(role, cwd)` returns NO tool with
 *       a name matching /ask.?user/i for any role in `AGENT_ROLES`. This is
 *       the regression guard for plan 01-01's "orchestrator-only askUser"
 *       enforcement.
 *
 * Notes
 *   - A.6 imports `toolsForRole` from `@swt-labs/orchestration` (a layer
 *     ABOVE runtime). Cross-layer import is intentional and confined to the
 *     test boundary; runtime's `package.json` is unchanged (vitest resolves
 *     workspace packages by symlink at the workspace root, not via the
 *     runtime package's own `dependencies` field). If the cross-layer
 *     resolution ever fails in CI we relocate A.6 to a workspace-level
 *     `test/` directory.
 *   - Tests use a stub `fetch` that returns a 503 for `/api/health` so the
 *     primary dashboard path is deterministically skipped, AND an injected
 *     `stdin`/`stdout`/`stderr` triple so we don't touch the real terminal.
 */

import { PassThrough } from 'node:stream';

import type { AgentRole } from '@swt-labs/shared';
import { AGENT_ROLES } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import { askUser } from '../../src/ask-user/index.js';

/**
 * Stub fetch that fails the dashboard health check. Used by A.1–A.4 so
 * askUser always falls into the headless branch.
 */
function makeUnreachableFetch(): typeof fetch {
  return (async () =>
    new Response('unreachable', { status: 503 })) as unknown as typeof fetch;
}

/**
 * Build a stdin PassThrough preloaded with one or more lines. The TTY
 * readline path waits for `\n`-terminated lines.
 */
function stdinWithLines(...lines: string[]): NodeJS.ReadableStream {
  const stream = new PassThrough();
  // Write each line with a trailing newline; readline's `question()` reads
  // until the first \n. End the stream after writes so the reader doesn't
  // hang waiting for more input.
  for (const line of lines) stream.write(`${line}\n`);
  stream.end();
  return stream;
}

/**
 * Capture writes into a string. PassThrough lets us read its full body via
 * the chunks listener without needing a Writable.
 */
function captureStream(): { stream: NodeJS.WritableStream; capture: () => string } {
  const chunks: string[] = [];
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer | string) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });
  return {
    stream,
    capture: () => chunks.join(''),
  };
}

describe('@swt-labs/runtime — askUser (Plan 01-05)', () => {
  it('A.1 — health-check fails + TTY → readline returns the picked option', async () => {
    const { stream: stdout, capture: captureStdout } = captureStream();
    const stdin = stdinWithLines('2');

    const result = await askUser(
      {
        header: 'Confirm',
        question: 'Continue with phase 03 now?',
        options: [
          { label: 'Execute phase 03', isRecommended: true },
          { label: 'Review plans first' },
          { label: 'Not now' },
        ],
      },
      {
        fetch: makeUnreachableFetch(),
        isTTY: true,
        stdin,
        stdout,
      },
    );

    expect(result).toEqual({ selectedOption: 'Review plans first', freeform: null });
    // Readline output should include the question and the option labels so
    // a future regression that drops the rendering body fails loudly.
    const rendered = captureStdout();
    expect(rendered).toContain('Continue with phase 03 now?');
    expect(rendered).toContain('Execute phase 03');
    expect(rendered).toContain('Review plans first');
  });

  it('A.2 — health-check fails + non-TTY → auto-accepts isRecommended option', async () => {
    const { stream: stderr, capture: captureStderr } = captureStream();

    const result = await askUser(
      {
        question: 'Ready to proceed?',
        options: [
          { label: 'Proceed', isRecommended: true },
          { label: 'Keep exploring' },
        ],
      },
      {
        fetch: makeUnreachableFetch(),
        isTTY: false,
        stderr,
      },
    );

    expect(result).toEqual({ selectedOption: 'Proceed', freeform: null });
    expect(captureStderr()).toContain('[auto-accept: "Proceed"]');
  });

  it('A.3 — health-check fails + non-TTY + no isRecommended → auto-accepts first option', async () => {
    const { stream: stderr, capture: captureStderr } = captureStream();

    const result = await askUser(
      {
        question: 'Pick one',
        options: [{ label: 'First' }, { label: 'Second' }],
      },
      {
        fetch: makeUnreachableFetch(),
        isTTY: false,
        stderr,
      },
    );

    expect(result).toEqual({ selectedOption: 'First', freeform: null });
    expect(captureStderr()).toContain('[auto-accept: "First"]');
  });

  it('A.4 — empty question or empty options throws synchronously', async () => {
    // Empty options array — the contract guard rejects before any fetch
    // attempt (no need to stub network).
    await expect(
      askUser({
        question: 'Pick one',
        options: [],
      }),
    ).rejects.toThrow(/non-empty array/);

    // Empty question body — same guard.
    await expect(
      askUser({
        question: '',
        options: [{ label: 'A' }],
      }),
    ).rejects.toThrow(/non-empty string/);

    // Empty option label — also a guard error.
    await expect(
      askUser({
        question: 'Pick',
        options: [{ label: '' }],
      }),
    ).rejects.toThrow(/non-empty label/);
  });

  it('A.5 — askUser is exported from @swt-labs/runtime by name', async () => {
    const runtime = await import('@swt-labs/runtime');
    expect(typeof runtime.askUser).toBe('function');
    // Smoke — call signature surface check. Strict-mode TS gives this for
    // free at compile time; the runtime assertion guards against an
    // accidental rename of the public export.
    expect(runtime.askUser.length).toBeGreaterThanOrEqual(1);
  });

  it('A.6 — no spawned role exposes a tool named askUser / swt_ask_user', async () => {
    // Cross-plan invariant — the orchestrator-only askUser invariant from
    // plan 01-01 is enforced at the tool-list construction layer in
    // spawnAgent. This test asserts it from the consumer side: for every
    // role in AGENT_ROLES (which now includes 'docs' post plan 01-01 T02),
    // toolsForRole(role, cwd) must NOT contain a tool whose name matches
    // /ask.?user/i. If a future change leaks askUser into a spawned role's
    // tool list — even via a typo on an extension factory — this test
    // fails loudly.
    //
    // The 'orchestrator' role is excluded because it is not a *spawnable*
    // role: spawnAgent throws when asked to spawn it (see
    // packages/orchestration/src/spawn-agent.ts resolveSpawnAgentConfig).
    // The orchestrator session is constructed by a separate code path
    // that DOES register swt_ask_user.
    const { toolsForRole } = await import('@swt-labs/orchestration');
    const ASKUSER_RE = /ask.?user/i;
    const cwd = process.cwd();
    const spawnableRoles: AgentRole[] = AGENT_ROLES.filter((r) => r !== 'orchestrator');
    expect(spawnableRoles.length).toBeGreaterThan(0);
    for (const role of spawnableRoles) {
      // SDLCRole excludes 'orchestrator'; we filtered above so the cast is
      // safe.
      const tools = toolsForRole(role as Exclude<AgentRole, 'orchestrator'>, cwd);
      // Tool definitions from Pi expose a `name: string` field. Defensive
      // narrowing in case the underlying shape evolves.
      const leakedTools = tools
        .map((t: unknown) =>
          t && typeof t === 'object' && 'name' in t && typeof (t as { name?: unknown }).name === 'string'
            ? (t as { name: string }).name
            : '',
        )
        .filter((name) => ASKUSER_RE.test(name));
      expect(leakedTools, `role "${role}" should not expose any askUser tool`).toEqual([]);
    }
  });
});
