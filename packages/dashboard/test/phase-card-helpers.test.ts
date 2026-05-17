/**
 * `phase-card-helpers` — pure-helper coverage for the merged
 * PHASES + ARTIFACTS card. Same node-env pattern as
 * `askuser-card-helpers.test.ts` and `phase-stepper-helpers.test.ts`:
 * no DOM, no Solid imports — only the structural decisions are tested.
 *
 * Cases (per design decisions in a_non_production_files/artifacts.md):
 *   1. isPhaseRowExpandable — true / false on artifacts.length
 *   2. chevronGlyph         — expanded / collapsed / non-expandable
 *   3. phaseRowChevronClass — appends disabled modifier only when empty
 *   4. isArtifactSelected   — match / mismatch / null selection
 *   5. KIND_BADGE / KIND_CLASS — every ArtifactKind has an entry
 */

import type { PhaseSummary } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import {
  KIND_BADGE,
  KIND_CLASS,
  chevronGlyph,
  isArtifactSelected,
  isPhaseRowExpandable,
  phaseRowChevronClass,
} from '../src/client/components/phase-card-helpers.js';

function phaseWith(artifactCount: number): Pick<PhaseSummary, 'artifacts'> {
  return {
    artifacts: Array.from({ length: artifactCount }, (_, i) => ({
      name: `f${i}.md`,
      kind: 'plan' as const,
    })),
  };
}

describe('isPhaseRowExpandable', () => {
  it('returns true when at least one artifact exists', () => {
    expect(isPhaseRowExpandable(phaseWith(1))).toBe(true);
    expect(isPhaseRowExpandable(phaseWith(5))).toBe(true);
  });

  it('returns false when artifact list is empty', () => {
    expect(isPhaseRowExpandable(phaseWith(0))).toBe(false);
  });
});

describe('chevronGlyph', () => {
  it('renders ▾ when expanded and expandable', () => {
    expect(chevronGlyph(true, true)).toBe('▾');
  });

  it('renders ▸ when collapsed but expandable', () => {
    expect(chevronGlyph(false, true)).toBe('▸');
  });

  it('renders ▸ when not expandable, regardless of expanded flag', () => {
    expect(chevronGlyph(true, false)).toBe('▸');
    expect(chevronGlyph(false, false)).toBe('▸');
  });
});

describe('phaseRowChevronClass', () => {
  it('returns the base class when expandable', () => {
    expect(phaseRowChevronClass(true)).toBe('phase-card-toggle');
  });

  it('appends the disabled modifier when not expandable', () => {
    expect(phaseRowChevronClass(false)).toBe('phase-card-toggle phase-card-toggle-disabled');
  });
});

describe('isArtifactSelected', () => {
  it('returns true when phase and name both match', () => {
    expect(isArtifactSelected({ phase: 'p1', name: 'a.md' }, 'p1', 'a.md')).toBe(true);
  });

  it('returns false when phase matches but name does not', () => {
    expect(isArtifactSelected({ phase: 'p1', name: 'a.md' }, 'p1', 'b.md')).toBe(false);
  });

  it('returns false when name matches but phase does not', () => {
    expect(isArtifactSelected({ phase: 'p1', name: 'a.md' }, 'p2', 'a.md')).toBe(false);
  });

  it('returns false when selection is null', () => {
    expect(isArtifactSelected(null, 'p1', 'a.md')).toBe(false);
  });
});

describe('KIND_BADGE / KIND_CLASS coverage', () => {
  it('exposes a badge + class for every ArtifactKind', () => {
    const kinds = ['research', 'plan', 'summary', 'verification', 'uat', 'context'] as const;
    for (const kind of kinds) {
      expect(KIND_BADGE[kind]).toMatch(/^[A-Z]$/);
      expect(KIND_CLASS[kind]).toBe(`artifact-${kind}`);
    }
  });

  it('preserves the pre-merge badge identities (R/P/S/V/U/C)', () => {
    // Locked from the deleted ArtifactTree so visual identity survives
    // the refactor — see artifacts.md design decisions §3.
    expect(KIND_BADGE.research).toBe('R');
    expect(KIND_BADGE.plan).toBe('P');
    expect(KIND_BADGE.summary).toBe('S');
    expect(KIND_BADGE.verification).toBe('V');
    expect(KIND_BADGE.uat).toBe('U');
    expect(KIND_BADGE.context).toBe('C');
  });
});
