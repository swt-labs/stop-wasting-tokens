/**
 * Plan 03-03 (Phase 3) Task T5 — swt init handler coverage.
 *
 * Coverage:
 *   - Registered in buildRegistry()
 *   - Usage error when <name> is missing
 *   - Scaffold path (existing behaviour preserved)
 *   - --skip-lead bypasses spawnAgent (CI / smoke escape-hatch)
 *   - Default path spawns Lead exactly once with role: 'lead', loading
 *     commands/init.md (frontmatter stripped)
 *   - AlreadyInitializedError still surfaces as USAGE_ERROR
 *   - Lead spawn failure surfaces as RUNTIME_ERROR
 */

import { AlreadyInitializedError } from '@swt-labs/core/scaffold/init-project.js';
import type * as SwtRuntime from '@swt-labs/runtime';
import type { TaskResult } from '@swt-labs/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Phase 03 G-03 T5: controllable mock for resolveInstallRoot — toggled in the
// missing-precondition test. Defaults to passthrough so existing tests see the
// real runtime resolver (which honors process.env.SWT_INSTALL_ROOT).
const runtimeMockState = vi.hoisted(() => ({ resolveInstallRootShouldThrow: false }));
vi.mock('@swt-labs/runtime', async () => {
  const actual = await vi.importActual<typeof SwtRuntime>('@swt-labs/runtime');
  return {
    ...actual,
    resolveInstallRoot: () => {
      if (runtimeMockState.resolveInstallRootShouldThrow) {
        throw new Error(
          'swt:installRoot — could not locate the SWT package root. Set SWT_INSTALL_ROOT explicitly.',
        );
      }
      return actual.resolveInstallRoot();
    },
  };
});

import { makeInitHandler } from '../../src/commands/init.js';
import { buildRegistry } from '../../src/main.js';
import type { CommandIO } from '../../src/router.js';

const REPO_ROOT = '/tmp/swt-init-test-repo';
const TEST_SESSION_ID = 'init-test-session-id';

const STUB_INIT_MD = `---
name: swt:init
description: Bootstrap the SWT planning workspace.
---

# SWT Init

Detect stack for project: \${SWT_PROJECT_NAME}
Working directory: \${SWT_INSTALL_ROOT}
`;

interface HarnessOpts {
  readonly spawnResult?: Partial<TaskResult>;
  readonly spawnThrows?: Error;
  readonly initProjectThrows?: Error;
  /**
   * alpha.20 — inject a discovered global keychain credential. Default
   * is `undefined` (no keychain credential found), which exercises the
   * pre-alpha.20 path: configuredProvider stays undefined, spawn fires
   * with no provider/resolvedCredential — byte-identical to old behaviour.
   */
  readonly globalCredential?: { provider: string; authMode: 'api_key' | 'oauth' };
  /** alpha.20 — let `persistAuthConfigImpl` simulate a write failure. */
  readonly persistAuthConfigReturns?: boolean;
}

function buildInitHarness(opts: HarnessOpts = {}) {
  const spawnResult: TaskResult = {
    schema_version: 1,
    task_id: 'init-test-task',
    status: 'success',
    summary: 'ok',
    files_changed: [],
    must_haves: [],
    ...opts.spawnResult,
  };
  const spawnAgentImpl = vi.fn(async () => {
    if (opts.spawnThrows !== undefined) throw opts.spawnThrows;
    return spawnResult;
  });

  const readFileSyncImpl = vi.fn((_p: unknown, _enc?: unknown) => STUB_INIT_MD);

  const initProjectImpl = vi.fn(() => {
    if (opts.initProjectThrows !== undefined) throw opts.initProjectThrows;
    return { root: REPO_ROOT, files: ['.swt-planning/PROJECT.md', '.swt-planning/STATE.md'] };
  });

  // alpha.20 — keychain-inheritance seams. Default `globalCredential=undefined`
  // is the "no keychain creds" case (e.g. user has not logged in anywhere) and
  // makes init.ts fall through to the no-credential spawn — preserving the
  // pre-alpha.20 default behaviour for every test that doesn't opt into a
  // discovered credential.
  const discoverGlobalCredentialImpl = vi.fn(async () => opts.globalCredential);
  const persistAuthConfigImpl = vi.fn(
    (_path: string, _provider: string, _authMode: 'api_key' | 'oauth') =>
      opts.persistAuthConfigReturns ?? true,
  );

  const handler = makeInitHandler({
    spawnAgentImpl: spawnAgentImpl,
    readFileSyncImpl: readFileSyncImpl as never,
    initProjectImpl: initProjectImpl,
    discoverGlobalCredentialImpl: discoverGlobalCredentialImpl,
    persistAuthConfigImpl: persistAuthConfigImpl,
  });

  const stderr: string[] = [];
  const stdout: string[] = [];
  const io: CommandIO = {
    cwd: REPO_ROOT,
    stdout: {
      write: (chunk: string | Uint8Array) => {
        stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WritableStream,
    stderr: {
      write: (chunk: string | Uint8Array) => {
        stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WritableStream,
  };

  async function run(
    positionals: readonly string[] = ['test-proj'],
    flags: Record<string, string | boolean | undefined> = {},
  ) {
    return handler({ verb: 'init', positionals, flags }, io);
  }

  return {
    run,
    spawnAgentImpl,
    readFileSyncImpl,
    initProjectImpl,
    discoverGlobalCredentialImpl,
    persistAuthConfigImpl,
    stderr: () => stderr.join(''),
    stdout: () => stdout.join(''),
  };
}

beforeAll(() => {
  process.env['SWT_INSTALL_ROOT'] = REPO_ROOT;
  process.env['SWT_SESSION_ID'] = TEST_SESSION_ID;
});

describe('@swt-labs/cli — initHandler (Plan 03-03 T5)', () => {
  it('is registered in buildRegistry() as a real verb', () => {
    const reg = buildRegistry();
    const spec = reg.get('init');
    expect(spec).toBeDefined();
    expect(spec?.description.toLowerCase()).toContain('.swt-planning');
  });

  it('returns USAGE_ERROR when <name> positional is missing', async () => {
    const h = buildInitHarness();
    const exit = await h.run([]);
    expect(exit).toBe(1);
    expect(h.initProjectImpl).not.toHaveBeenCalled();
    expect(h.spawnAgentImpl).not.toHaveBeenCalled();
    expect(h.stderr()).toContain('Usage');
  });

  it('scaffolds .swt-planning/ (initProject called) then spawns Lead', async () => {
    const h = buildInitHarness();
    const exit = await h.run(['my-proj']);
    expect(exit).toBe(0);
    expect(h.initProjectImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnAgentImpl).toHaveBeenCalledTimes(1);
    const args = h.spawnAgentImpl.mock.calls[0]?.[0];
    expect(args?.role).toBe('lead');
    // Plan 04-01 (M13) — success stdout reflects unified panel + interview-driven cook.
    expect(h.stdout()).toContain('unified panel');
  });

  it('loads commands/init.md and strips frontmatter before passing to the Lead', async () => {
    const h = buildInitHarness();
    await h.run(['my-proj']);
    const readPath = String(h.readFileSyncImpl.mock.calls[0]?.[0]);
    expect(readPath.endsWith('init.md')).toBe(true);
    const promptPassed = h.spawnAgentImpl.mock.calls[0]?.[0]?.prompt ?? '';
    expect(promptPassed.startsWith('---')).toBe(false);
    expect(promptPassed).not.toContain('name: swt:init');
    // ${SWT_PROJECT_NAME} substitution applied
    expect(promptPassed).toContain('my-proj');
    expect(promptPassed).not.toContain('${SWT_PROJECT_NAME}');
  });

  it('--skip-lead bypasses the Lead spawn entirely (CI escape-hatch)', async () => {
    const h = buildInitHarness();
    const exit = await h.run(['my-proj'], { 'skip-lead': true });
    expect(exit).toBe(0);
    expect(h.initProjectImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnAgentImpl).not.toHaveBeenCalled();
    expect(h.stdout()).toContain('Skipping');
  });

  it('--skip-scaffold bypasses initProject and goes straight to the Lead (alpha.15 dashboard contract)', async () => {
    const h = buildInitHarness();
    const exit = await h.run(['my-proj'], { 'skip-scaffold': true });
    expect(exit).toBe(0);
    expect(h.initProjectImpl).not.toHaveBeenCalled();
    expect(h.spawnAgentImpl).toHaveBeenCalledTimes(1);
    expect(h.stdout()).toContain('Skipping scaffold');
  });

  it('--skip-scaffold does NOT crash when .swt-planning/ already exists (regression for Phase 02 double-scaffold bug)', async () => {
    const h = buildInitHarness({
      initProjectThrows: new AlreadyInitializedError('/tmp/swt-init-test-repo/.swt-planning'),
    });
    const exit = await h.run(['my-proj'], { 'skip-scaffold': true });
    // With --skip-scaffold, initProject is never called, so the
    // AlreadyInitializedError it would have thrown does not surface.
    expect(exit).toBe(0);
    expect(h.initProjectImpl).not.toHaveBeenCalled();
    expect(h.spawnAgentImpl).toHaveBeenCalledTimes(1);
  });

  it('AlreadyInitializedError surfaces as USAGE_ERROR (regression — pre-Plan-03-03 behaviour)', async () => {
    const h = buildInitHarness({
      initProjectThrows: new AlreadyInitializedError('/tmp/swt-init-test-repo/.swt-planning'),
    });
    const exit = await h.run(['my-proj']);
    expect(exit).toBe(1);
    expect(h.stderr()).toContain('already exists');
    expect(h.spawnAgentImpl).not.toHaveBeenCalled();
  });

  it('returns EXIT.RUNTIME_ERROR when the Lead spawn returns status="failed"', async () => {
    const h = buildInitHarness({ spawnResult: { status: 'failed' } });
    const exit = await h.run(['my-proj']);
    expect(exit).toBe(3);
    expect(h.initProjectImpl).toHaveBeenCalledTimes(1);
    expect(h.spawnAgentImpl).toHaveBeenCalledTimes(1);
  });

  it('returns EXIT.RUNTIME_ERROR when the Lead spawn throws', async () => {
    const h = buildInitHarness({ spawnThrows: new Error('spawn boom') });
    const exit = await h.run(['my-proj']);
    expect(exit).toBe(3);
    expect(h.stderr()).toContain('spawn boom');
  });

  it('accepts a description via --description flag and forwards to initProject', async () => {
    const h = buildInitHarness();
    await h.run(['my-proj'], { description: 'A test project' });
    const call = h.initProjectImpl.mock.calls[0]?.[0];
    expect(call?.description).toBe('A test project');
  });

  it('accepts a description via second positional and forwards to initProject', async () => {
    const h = buildInitHarness();
    await h.run(['my-proj', 'A test project']);
    const call = h.initProjectImpl.mock.calls[0]?.[0];
    expect(call?.description).toBe('A test project');
  });

  // ─────────────────────────────────────────────────────────────────────
  // alpha.20 — Bug A: credential inheritance from the global keychain
  // ─────────────────────────────────────────────────────────────────────
  // Pre-alpha.20, a brand-new project scaffolded via the dashboard had no
  // `auth` block in `.swt-planning/config.json`, so `init.ts` spawned the
  // Lead with no credential, Pi failed with "No API key found for the
  // selected model", and the user saw a cryptic "init exited with code 3
  // within 452ms" in the dashboard error card. Even if the user had
  // already completed an OAuth login (e.g., from a prior project), the
  // credential sat in the keychain unused — init only consulted the
  // project-local config.
  //
  // alpha.20 fixes this by:
  //  1. Falling back to a keychain enumeration when the project's auth
  //     block is empty (the `discoverGlobalCredentialImpl` seam).
  //  2. Persisting the discovered (provider, mode) pair into the project's
  //     config.json so future cook runs work without re-OAuth (the
  //     `persistAuthConfigImpl` seam).
  // The three tests below exercise the three branches of this logic.
  describe('alpha.20 — global keychain credential inheritance', () => {
    it('no keychain credentials + no project auth → spawn fires with no provider (graceful degrade)', async () => {
      // The default harness has `globalCredential: undefined`, so the
      // discovery returns undefined, no persist happens, and spawn fires
      // with no `provider`/`resolvedCredential` — preserving the existing
      // graceful-degrade contract (Pi surfaces a clear auth error if
      // env vars are also empty; the dashboard's Bug B fix shows that).
      const h = buildInitHarness();
      const exit = await h.run(['my-proj']);
      expect(exit).toBe(0);
      expect(h.discoverGlobalCredentialImpl).toHaveBeenCalledTimes(1);
      expect(h.persistAuthConfigImpl).not.toHaveBeenCalled();
      const spawnArgs = h.spawnAgentImpl.mock.calls[0]?.[0];
      expect(spawnArgs?.provider).toBeUndefined();
      expect(spawnArgs?.resolvedCredential).toBeUndefined();
    });

    it('keychain has anthropic:oauth + no project auth → inherits + persists with correct args + breadcrumb', async () => {
      const h = buildInitHarness({
        globalCredential: { provider: 'anthropic', authMode: 'oauth' },
      });
      const exit = await h.run(['my-proj']);
      expect(exit).toBe(0);
      // Discovery seam was queried exactly once.
      expect(h.discoverGlobalCredentialImpl).toHaveBeenCalledTimes(1);
      // Persist seam was invoked with the discovered (provider, mode) pair.
      // The first arg is the resolved config.json path.
      expect(h.persistAuthConfigImpl).toHaveBeenCalledTimes(1);
      const persistCall = h.persistAuthConfigImpl.mock.calls[0];
      expect(persistCall?.[0]).toContain('.swt-planning');
      expect(persistCall?.[0]).toContain('config.json');
      expect(persistCall?.[1]).toBe('anthropic');
      expect(persistCall?.[2]).toBe('oauth');
      // The user-visible breadcrumb confirms the success path.
      expect(h.stdout()).toContain('Inherited anthropic:oauth credential from keychain');
      // Note: whether the spawn ultimately carries `provider=anthropic` +
      // a resolved secret depends on whether the live keychain backend has
      // a secret for `anthropic:oauth`. That's environment-dependent
      // (different on CI vs the developer's machine), so we deliberately
      // don't assert on it here — the discovery+persist contract is the
      // unit-testable surface; the keychain-store leg is covered by
      // cook-auth-wiring.test.ts.
    });

    it('persist write fails → still discovers + logs the degraded breadcrumb', async () => {
      const h = buildInitHarness({
        globalCredential: { provider: 'openai', authMode: 'api_key' },
        persistAuthConfigReturns: false,
      });
      const exit = await h.run(['my-proj']);
      expect(exit).toBe(0);
      // Persist was attempted but reported failure.
      expect(h.persistAuthConfigImpl).toHaveBeenCalledTimes(1);
      // The degraded breadcrumb tells the user the credential is in use
      // for this spawn only — they can re-run or set up via Provider menu.
      expect(h.stdout()).toContain('config write failed; using for this spawn only');
      // Init handler still completes successfully — persist failure is a
      // soft warning, not a fatal error.
    });
  });

  // Phase 03 G-03 T5: missing-precondition regression — handler must hard-fail
  // when resolveInstallRoot throws. Per Locked Decision #6.
  it('exits EXIT.RUNTIME_ERROR when resolveInstallRoot throws (SWT_INSTALL_ROOT unresolvable)', async () => {
    runtimeMockState.resolveInstallRootShouldThrow = true;
    try {
      const h = buildInitHarness();
      const exit = await h.run(['my-proj']);
      expect(exit).toBe(3);
      expect(h.stderr()).toContain('SWT_INSTALL_ROOT');
    } finally {
      runtimeMockState.resolveInstallRootShouldThrow = false;
    }
  });
});
