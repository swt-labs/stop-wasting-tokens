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

describe('InitScreen (smoke)', () => {
  it('is a callable Solid component', () => {
    expect(typeof InitScreen).toBe('function');
  });

  it('satisfies the InitScreenProps contract', () => {
    // Typed `const` — if `InitScreenProps` ever drops `submitting`,
    // `brownfield`, `initSession`, or `onInit` (or changes their
    // signatures), this stops compiling. T01 retains `providerAuth`;
    // T02 will REMOVE that prop and add a stricter interface
    // assertion below.
    const sanity: InitScreenProps = {
      submitting: false,
      brownfield: false,
      initSession: () => null,
      onInit: async () => {
        // noop
      },
      providerAuth: () => null,
    };
    expect(typeof sanity.onInit).toBe('function');
    expect(typeof sanity.initSession).toBe('function');
  });
});
