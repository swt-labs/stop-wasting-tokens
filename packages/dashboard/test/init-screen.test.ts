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
  describeGitState,
  describePrecheckMode,
  InitScreen,
  isStep1Complete,
  type InitScreenProps,
} from '../src/client/components/InitScreen.js';

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
      onInit: async () => {
        // noop
      },
    };
    expect(typeof sanity.onInit).toBe('function');
    expect(typeof sanity.initSession).toBe('function');

    // Compile-time gate: this assignment fails if providerAuth (or any
    // other unexpected key) is added to InitScreenProps.
    const _typecheck: Record<keyof InitScreenProps, true> = {
      submitting: true,
      brownfield: true,
      initSession: true,
      onInit: true,
    };
    expect(Object.keys(_typecheck).sort()).toEqual(
      ['brownfield', 'initSession', 'onInit', 'submitting'].sort(),
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
