/**
 * Milestone 23 Phase 02 — Initialize Wizard v2.
 *
 * Pure-function + interface-contract tests for the new 4-step wizard
 * exported from `InitScreen.tsx`. The dashboard test convention is
 * "Pattern 1 — pure helper isolation" (see `init-screen-helpers.test.ts`,
 * `themes-dropdown-helpers.test.ts`). The vitest config runs
 * `environment: 'node'` and there is no Solid testing-library — so this
 * file:
 *   - imports the helpers and the component as functions,
 *   - tests the helpers exhaustively,
 *   - smoke-tests the component for `typeof === 'function'`,
 *   - locks the `InitScreenProps` shape via a typed `const` so any
 *     interface drift breaks compilation.
 *
 * T01 covers `isStep1Complete` + `buildInitBody`. T02 extends with
 * `describeGitState` + `describePrecheckMode` + the no-providerAuth
 * interface assertion. T03 extends with response-handling helpers if
 * extracted.
 */

import { describe, expect, it } from 'vitest';

import {
  buildInitBody,
  classifyInitError,
  describeGitState,
  describePrecheckMode,
  InitScreen,
  isStep1Complete,
  summarizeInitResponse,
  type InitScreenProps,
} from '../src/client/components/InitScreen.js';
import { ApiError } from '../src/client/services/api.js';
import type { InitResponse } from '../src/client/services/api.js';

describe('isStep1Complete', () => {
  it('returns false for empty string', () => {
    expect(isStep1Complete('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(isStep1Complete('   ')).toBe(false);
    expect(isStep1Complete('\t\n  ')).toBe(false);
  });

  it('returns true for any non-empty trimmed name', () => {
    expect(isStep1Complete('my-project')).toBe(true);
    expect(isStep1Complete('a')).toBe(true);
  });

  it('returns true when name has leading/trailing whitespace but a non-empty core', () => {
    expect(isStep1Complete('  my-project  ')).toBe(true);
  });
});

describe('buildInitBody', () => {
  it('produces a body with name + defaults when description is empty', () => {
    expect(
      buildInitBody({
        name: 'my-project',
        description: '',
        planningTracking: 'manual',
        autoPush: 'never',
      }),
    ).toEqual({
      name: 'my-project',
      planning_tracking: 'manual',
      auto_push: 'never',
    });
  });

  it('trims the name', () => {
    const body = buildInitBody({
      name: '  spaced-name  ',
      description: '',
      planningTracking: 'manual',
      autoPush: 'never',
    });
    expect(body.name).toBe('spaced-name');
  });

  it('includes description when non-empty after trim', () => {
    const body = buildInitBody({
      name: 'my-project',
      description: '  A useful project.  ',
      planningTracking: 'manual',
      autoPush: 'never',
    });
    expect(body.description).toBe('A useful project.');
  });

  it('omits description when whitespace-only', () => {
    const body = buildInitBody({
      name: 'my-project',
      description: '   ',
      planningTracking: 'manual',
      autoPush: 'never',
    });
    expect(body).not.toHaveProperty('description');
  });

  it('forwards non-default planningTracking + autoPush literally', () => {
    expect(
      buildInitBody({
        name: 'my-project',
        description: '',
        planningTracking: 'commit',
        autoPush: 'always',
      }),
    ).toEqual({
      name: 'my-project',
      planning_tracking: 'commit',
      auto_push: 'always',
    });
  });

  it('supports the full enum surface', () => {
    for (const planning of ['manual', 'ignore', 'commit'] as const) {
      for (const push of ['never', 'after_phase', 'always'] as const) {
        const body = buildInitBody({
          name: 'p',
          description: '',
          planningTracking: planning,
          autoPush: push,
        });
        expect(body.planning_tracking).toBe(planning);
        expect(body.auto_push).toBe(push);
      }
    }
  });
});

describe('describeGitState', () => {
  it('maps absent → "No git repository (SWT will run `git init` for you)"', () => {
    expect(describeGitState('absent')).toBe('No git repository (SWT will run `git init` for you)');
  });

  it('maps repo → "Git repository detected"', () => {
    expect(describeGitState('repo')).toBe('Git repository detected');
  });

  it('maps parent_repo → "Inside parent git repository"', () => {
    expect(describeGitState('parent_repo')).toBe('Inside parent git repository');
  });
});

describe('describePrecheckMode', () => {
  it('returns the greenfield label when brownfield is false', () => {
    expect(describePrecheckMode(false, 0)).toBe('Greenfield (no existing source files)');
  });

  it('returns greenfield even when sourceFileCount is non-zero (defensive)', () => {
    // Defensive: the server guarantees `brownfield === false ⇒ count===0`,
    // but a future schema drift shouldn't make the label misleading.
    expect(describePrecheckMode(false, 12)).toBe('Greenfield (no existing source files)');
  });

  it('uses singular noun for 1 source file', () => {
    expect(describePrecheckMode(true, 1)).toBe('Brownfield (1 source file detected)');
  });

  it('uses plural noun for 0 source files (brownfield with no files is a weird-but-possible boundary)', () => {
    // Per Phase 01 schema, source_file_count is non-negative; brownfield
    // typically implies count > 0 but the type allows 0. Test the label
    // stays grammatical for the plural-by-convention boundary.
    expect(describePrecheckMode(true, 0)).toBe('Brownfield (0 source files detected)');
  });

  it('uses plural noun for N > 1 source files', () => {
    expect(describePrecheckMode(true, 42)).toBe('Brownfield (42 source files detected)');
    expect(describePrecheckMode(true, 1000)).toBe('Brownfield (1000 source files detected)');
  });
});

describe('InitScreen (smoke)', () => {
  it('is a callable Solid component', () => {
    expect(typeof InitScreen).toBe('function');
  });

  it('satisfies the InitScreenProps contract WITHOUT providerAuth', () => {
    // Typed `const` — if `InitScreenProps` ever drops `submitting`,
    // `brownfield`, `initSession`, or `onInit` (or changes their
    // signatures), this stops compiling. Milestone 23 Phase 02 T02:
    // `providerAuth` is REMOVED from the interface (Locked Decision
    // #10 — vendor-agnostic invariant). The `Record<keyof…>` line
    // below TYPE-LOCKS that providerAuth is NOT a key of
    // InitScreenProps — adding it back would require this record to
    // grow a corresponding entry, surfacing the drift in CI.
    const sanity: InitScreenProps = {
      submitting: false,
      brownfield: false,
      initSession: () => null,
      onInit: async () => ({
        initialized: true,
        root: '/tmp/p',
        files: [],
        brownfield: false,
        git_initialized: false,
        stack: [],
      }),
      // Milestone 23 Phase 03 (PA-1, PA-6) — Step 4 [Map codebase] button
      // now reads the hoisted store flag + calls the hoisted action via
      // these two new props (the former component-local `mapClicked`
      // signal is gone).
      isMappingCodebase: () => false,
      onMapCodebase: () => {
        /* no-op */
      },
    };
    expect(typeof sanity.onInit).toBe('function');
    expect(typeof sanity.initSession).toBe('function');
    expect(typeof sanity.isMappingCodebase).toBe('function');
    expect(typeof sanity.onMapCodebase).toBe('function');

    // Compile-time gate: this assignment fails if providerAuth (or any
    // other unexpected key) is added to InitScreenProps.
    const _typecheck: Record<keyof InitScreenProps, true> = {
      submitting: true,
      brownfield: true,
      initSession: true,
      onInit: true,
      isMappingCodebase: true,
      onMapCodebase: true,
    };
    expect(Object.keys(_typecheck).sort()).toEqual(
      [
        'brownfield',
        'initSession',
        'isMappingCodebase',
        'onInit',
        'onMapCodebase',
        'submitting',
      ].sort(),
    );
  });

  it('InitScreenProps does NOT include providerAuth (vendor-agnostic invariant)', () => {
    // Constructing a typed object with ONLY the allowed keys — if the
    // type ever regrows providerAuth as required, the object literal
    // above (sanity) would fail to compile. This `it` block exists so
    // the assertion survives as a runtime-visible test name in the
    // suite reporter.
    expect(true).toBe(true);
  });
});

// ── T03 — submit response classification + summary ─────────────────────

describe('buildInitBody — snapshot', () => {
  it('produces the exact wire body the wizard POSTs to /api/init', () => {
    const body = buildInitBody({
      name: 'snapshot-project',
      description: 'A baseline body for the wizard submit.',
      planningTracking: 'commit',
      autoPush: 'after_phase',
    });
    expect(body).toMatchInlineSnapshot(`
      {
        "auto_push": "after_phase",
        "description": "A baseline body for the wizard submit.",
        "name": "snapshot-project",
        "planning_tracking": "commit",
      }
    `);
  });

  it('omits description from the wire body when blank', () => {
    const body = buildInitBody({
      name: 'no-desc',
      description: '',
      planningTracking: 'manual',
      autoPush: 'never',
    });
    expect(body).toMatchInlineSnapshot(`
      {
        "auto_push": "never",
        "name": "no-desc",
        "planning_tracking": "manual",
      }
    `);
  });
});

describe('classifyInitError', () => {
  it('classifies a 409 ApiError as already-initialized', () => {
    expect(classifyInitError(new ApiError('AlreadyInitialized', 409))).toBe('already-initialized');
  });

  it('classifies any 5xx ApiError as retryable', () => {
    expect(classifyInitError(new ApiError('Internal', 500))).toBe('retryable');
    expect(classifyInitError(new ApiError('Bad gateway', 502))).toBe('retryable');
    expect(classifyInitError(new ApiError('Timeout', 504))).toBe('retryable');
  });

  it('classifies other 4xx ApiErrors as fatal', () => {
    expect(classifyInitError(new ApiError('Bad request', 400))).toBe('fatal');
    expect(classifyInitError(new ApiError('Unauthorized', 401))).toBe('fatal');
    expect(classifyInitError(new ApiError('Forbidden', 403))).toBe('fatal');
    expect(classifyInitError(new ApiError('Not found', 404))).toBe('fatal');
  });

  it('classifies a generic Error (network / parse / DOM) as retryable', () => {
    expect(classifyInitError(new Error('Failed to fetch'))).toBe('retryable');
    expect(classifyInitError(new TypeError('Cannot read prop'))).toBe('retryable');
  });

  it('classifies a non-Error throw as retryable (defensive)', () => {
    expect(classifyInitError('something weird')).toBe('retryable');
    expect(classifyInitError(null)).toBe('retryable');
    expect(classifyInitError(undefined)).toBe('retryable');
  });
});

describe('summarizeInitResponse', () => {
  const baseGreenfield: InitResponse = {
    initialized: true,
    root: '/tmp/proj',
    files: ['.swt-planning/PROJECT.md', '.swt-planning/STATE.md', '.swt-planning/config.json'],
    brownfield: false,
    git_initialized: true,
    stack: [],
  };

  const baseBrownfield: InitResponse = {
    initialized: true,
    root: '/tmp/proj',
    files: [
      '.swt-planning/PROJECT.md',
      '.swt-planning/STATE.md',
      '.swt-planning/config.json',
      '.swt-planning/stack.json',
      '.swt-planning/REQUIREMENTS.md',
      '.swt-planning/ROADMAP.md',
    ],
    brownfield: true,
    git_initialized: false,
    stack: ['typescript', 'react', 'vite'],
  };

  it('labels mode correctly for greenfield', () => {
    expect(summarizeInitResponse(baseGreenfield).modeLabel).toBe('Mode: Greenfield');
  });

  it('labels mode correctly for brownfield', () => {
    expect(summarizeInitResponse(baseBrownfield).modeLabel).toBe('Mode: Brownfield');
  });

  it('emits a git-initialized label only when git_initialized is true', () => {
    expect(summarizeInitResponse(baseGreenfield).gitInitializedLabel).toBe(
      '✓ git repository initialized',
    );
    expect(summarizeInitResponse(baseBrownfield).gitInitializedLabel).toBeNull();
  });

  it('emits a comma-joined stack label only when stack is non-empty', () => {
    expect(summarizeInitResponse(baseGreenfield).stackLabel).toBeNull();
    expect(summarizeInitResponse(baseBrownfield).stackLabel).toBe('Stack: typescript, react, vite');
  });

  it('caps filesPreview at 5 entries while keeping fileCount accurate', () => {
    const summary = summarizeInitResponse(baseBrownfield);
    expect(summary.fileCount).toBe(6);
    expect(summary.filesPreview).toHaveLength(5);
    expect(summary.filesPreview).toEqual(baseBrownfield.files.slice(0, 5));
  });

  it('shows the full file list when count is <= 5', () => {
    const summary = summarizeInitResponse(baseGreenfield);
    expect(summary.fileCount).toBe(3);
    expect(summary.filesPreview).toHaveLength(3);
    expect(summary.filesPreview).toEqual(baseGreenfield.files);
  });
});

describe('InitScreen state-machine smoke (mocked onInit return)', () => {
  it('handles a successful onInit by capturing the parsed response shape', async () => {
    // Pure data smoke: assert the contract the wizard depends on —
    // `await props.onInit(body)` resolves to an InitResponse the
    // component can hand to `summarizeInitResponse`. The actual
    // component-level mounting is not exercised (no DOM), so this is
    // a contract-level test only.
    const fakeResponse: InitResponse = {
      initialized: true,
      root: '/tmp/x',
      files: ['.swt-planning/PROJECT.md'],
      brownfield: false,
      git_initialized: true,
      stack: [],
    };
    const onInit = async (): Promise<InitResponse> => fakeResponse;
    const result = await onInit();
    expect(summarizeInitResponse(result).modeLabel).toBe('Mode: Greenfield');
  });

  it('handles a 409 ApiError reject by classifying as already-initialized', async () => {
    const onInit = async (): Promise<InitResponse> => {
      throw new ApiError('already initialized', 409);
    };
    let caught: unknown = null;
    try {
      await onInit();
    } catch (err) {
      caught = err;
    }
    expect(classifyInitError(caught)).toBe('already-initialized');
  });

  it('handles a 503 ApiError reject by classifying as retryable', async () => {
    const onInit = async (): Promise<InitResponse> => {
      throw new ApiError('upstream gone', 503);
    };
    let caught: unknown = null;
    try {
      await onInit();
    } catch (err) {
      caught = err;
    }
    expect(classifyInitError(caught)).toBe('retryable');
  });
});
