/**
 * Milestone 23 Phase 03 T02 — pure-helper + interface-contract tests for
 * `CodebaseMapPrompt.tsx`. Follows the Phase 02 wizard convention
 * (init-screen.test.ts / themes-dropdown.test.ts): vitest node-environment,
 * NO Solid testing-library, NO DOM. Pure helpers are exhaustively covered;
 * the component itself is smoke-tested for `typeof === 'function'` and the
 * props shape is type-locked.
 */

import type { Snapshot } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import {
  CodebaseMapPrompt,
  describeMapState,
  shouldShowMapPrompt,
  type CodebaseMapPromptProps,
} from '../src/client/components/CodebaseMapPrompt.js';

// Minimal Snapshot factory so each test can express ONLY the fields it
// cares about and let the rest default to a sensible shape.
function snap(overrides: Partial<Snapshot>): Snapshot {
  return {
    schema_version: '1',
    generated_at: '2026-05-20T00:00:00.000Z',
    project: null,
    milestone: null,
    phases: [],
    active_agents: [],
    recent_events: [],
    cost_summary: null,
    is_initialized: false,
    ...overrides,
  };
}

describe('shouldShowMapPrompt', () => {
  it('returns true when is_initialized=true && brownfield=true && codebase_mapped=false', () => {
    expect(
      shouldShowMapPrompt(snap({ is_initialized: true, brownfield: true, codebase_mapped: false })),
    ).toBe(true);
  });

  it('returns false when is_initialized=false (not yet initialized)', () => {
    expect(
      shouldShowMapPrompt(
        snap({ is_initialized: false, brownfield: true, codebase_mapped: false }),
      ),
    ).toBe(false);
  });

  it('returns false when brownfield=false (greenfield project)', () => {
    expect(
      shouldShowMapPrompt(
        snap({ is_initialized: true, brownfield: false, codebase_mapped: false }),
      ),
    ).toBe(false);
  });

  it('returns false when codebase_mapped=true (already mapped)', () => {
    expect(
      shouldShowMapPrompt(snap({ is_initialized: true, brownfield: true, codebase_mapped: true })),
    ).toBe(false);
  });

  it('returns false when snapshot is null', () => {
    expect(shouldShowMapPrompt(null)).toBe(false);
  });

  it('returns false when snapshot is undefined', () => {
    expect(shouldShowMapPrompt(undefined)).toBe(false);
  });

  it('returns false when brownfield + codebase_mapped are both undefined (old snapshot)', () => {
    // Old pre-milestone-23 snapshot — both fields absent. `?? false`
    // defaults take effect: brownfield reads false → guard short-circuits.
    expect(shouldShowMapPrompt(snap({ is_initialized: true }))).toBe(false);
  });
});

describe('describeMapState', () => {
  it("returns 'mapped' when codebase_mapped === true", () => {
    expect(describeMapState(snap({ codebase_mapped: true }), false)).toBe('mapped');
    // `mapped` wins over in-flight: a stale flag shouldn't override the
    // canonical snapshot signal.
    expect(describeMapState(snap({ codebase_mapped: true }), true)).toBe('mapped');
  });

  it("returns 'mapping' when codebase_mapped !== true && isMappingCodebase === true", () => {
    expect(describeMapState(snap({ codebase_mapped: false }), true)).toBe('mapping');
    expect(describeMapState(snap({}), true)).toBe('mapping');
    expect(describeMapState(null, true)).toBe('mapping');
  });

  it("returns 'absent' when codebase_mapped !== true && isMappingCodebase === false", () => {
    expect(describeMapState(snap({ codebase_mapped: false }), false)).toBe('absent');
    expect(describeMapState(snap({}), false)).toBe('absent');
    expect(describeMapState(null, false)).toBe('absent');
    expect(describeMapState(undefined, false)).toBe('absent');
  });
});

describe('CodebaseMapPrompt (smoke)', () => {
  it('is a callable Solid component', () => {
    expect(typeof CodebaseMapPrompt).toBe('function');
  });

  it('satisfies the CodebaseMapPromptProps contract', () => {
    // Typed `const` — if `CodebaseMapPromptProps` ever drops `snapshot`,
    // `isMappingCodebase`, or `onMapCodebase` (or changes their
    // signatures), this stops compiling. Matches the init-screen.test.ts
    // interface-lock pattern.
    const sanity: CodebaseMapPromptProps = {
      snapshot: () => null,
      isMappingCodebase: () => false,
      onMapCodebase: () => {
        /* no-op */
      },
    };
    expect(typeof sanity.snapshot).toBe('function');
    expect(typeof sanity.isMappingCodebase).toBe('function');
    expect(typeof sanity.onMapCodebase).toBe('function');

    // Compile-time gate: this assignment fails if a key is added to
    // CodebaseMapPromptProps without a corresponding entry here.
    const _typecheck: Record<keyof CodebaseMapPromptProps, true> = {
      snapshot: true,
      isMappingCodebase: true,
      onMapCodebase: true,
    };
    expect(Object.keys(_typecheck).sort()).toEqual(
      ['isMappingCodebase', 'onMapCodebase', 'snapshot'].sort(),
    );
  });

  it('CodebaseMapPromptProps does NOT include a provider-auth prop (vendor-agnostic invariant)', () => {
    // Locked Decision #10 — the route + banner read no provider-auth
    // tools-cell. If a future refactor were to add such a prop, the
    // Record-keyof type lock in the previous test would require a
    // corresponding entry — surfacing the drift in CI. This runtime test
    // keeps the intent visible in the suite reporter.
    expect(true).toBe(true);
  });
});
