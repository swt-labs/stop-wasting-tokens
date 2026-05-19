/**
 * Plan 02-03 — `ProfileDropdown` pure-helper coverage.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config runs `environment: 'node'` with an esbuild transform that
 * can't emit Solid-compatible JSX runtime calls (see
 * `settings-section.test.ts` / `options-menu.test.ts` for the same
 * constraint). To keep this plan's test deliverable shippable without a
 * workspace dep bump, the dropdown's load-bearing behaviour is factored
 * into PURE exported helpers — `shouldConfirmSwitch`,
 * `stageProfileValues` — which are unit-tested directly here, plus a
 * smoke test that the `ProfileDropdown` export is a callable Solid
 * component.
 *
 * The `shouldConfirmSwitch` group is THE regression guard for the
 * confirmation gate invariant (Locked Decision #6 — no silent
 * fallbacks): the gate fires ONLY when the user picks a different
 * profile id AND has unsaved manual edits. Any other condition either
 * passes through (no edits to lose) or no-ops (identity switch).
 *
 * The `stageProfileValues` group is THE regression guard for the
 * data-loss-by-replace contract: profile values overwrite pending
 * edits on every key the profile defines, and `active_profile` is the
 * LAST write so the explicit assignment always wins (defense-in-depth
 * against a future contributor planting `active_profile` inside a
 * profile's `values`).
 */

import { BUILTIN_PROFILES, PROFILE_IDS } from '@swt-labs/core';
import { describe, expect, it } from 'vitest';

import {
  ProfileDropdown,
  shouldConfirmSwitch,
  stageProfileValues,
} from '../src/client/components/ProfileDropdown.jsx';

describe('ProfileDropdown helpers', () => {
  describe('shouldConfirmSwitch', () => {
    it('returns false when nextId === currentId (identity switch never confirms)', () => {
      expect(shouldConfirmSwitch('default', 'default', true)).toBe(false);
      expect(shouldConfirmSwitch('default', 'default', false)).toBe(false);
      expect(shouldConfirmSwitch('turbo', 'turbo', true)).toBe(false);
    });

    it('returns false when hasPendingEdits is false (no pending → no data loss → no confirm)', () => {
      expect(shouldConfirmSwitch('default', 'turbo', false)).toBe(false);
      expect(shouldConfirmSwitch('turbo', 'quality', false)).toBe(false);
      expect(shouldConfirmSwitch('quality', 'prototype', false)).toBe(false);
      expect(shouldConfirmSwitch('prototype', 'default', false)).toBe(false);
    });

    it('returns true when nextId !== currentId AND hasPendingEdits is true', () => {
      expect(shouldConfirmSwitch('default', 'turbo', true)).toBe(true);
      expect(shouldConfirmSwitch('turbo', 'quality', true)).toBe(true);
      expect(shouldConfirmSwitch('quality', 'prototype', true)).toBe(true);
      expect(shouldConfirmSwitch('prototype', 'default', true)).toBe(true);
    });

    it('truth-table: every cross-id pair with hasPendingEdits=true returns true', () => {
      for (const curr of PROFILE_IDS) {
        for (const next of PROFILE_IDS) {
          const expected = curr !== next;
          expect(shouldConfirmSwitch(curr, next, true)).toBe(expected);
        }
      }
    });
  });

  describe('stageProfileValues', () => {
    it('merges profile values into pendingEdits (existing pending keys preserved when profile is silent)', () => {
      const result = stageProfileValues(
        'turbo',
        { effort: 'turbo', autonomy: 'pure-vibe' },
        { auto_uat: false },
      );
      expect(result.auto_uat).toBe(false);
      expect(result.effort).toBe('turbo');
      expect(result.autonomy).toBe('pure-vibe');
    });

    it('profile values overwrite existing pending edits for keys the profile defines', () => {
      const result = stageProfileValues('turbo', { effort: 'turbo' }, { effort: 'thorough' });
      expect(result.effort).toBe('turbo');
    });

    it('sets active_profile to the chosen profile id (LAST write wins)', () => {
      const result = stageProfileValues(
        'quality',
        { effort: 'thorough' },
        { active_profile: 'default' },
      );
      expect(result.active_profile).toBe('quality');
    });

    it('does NOT mutate the input pendingEdits (purity)', () => {
      const input: Record<string, unknown> = { auto_uat: false, foo: 'bar' };
      const inputCopy = { ...input };
      const result = stageProfileValues('turbo', { effort: 'turbo' }, input);
      expect(input).toEqual(inputCopy);
      // Reference inequality: the helper returns a NEW object, never the input cell.
      expect(result).not.toBe(input);
    });

    it('does NOT mutate the input profileValues (handles a frozen object)', () => {
      const profileValues = Object.freeze({ effort: 'turbo' });
      expect(() => stageProfileValues('turbo', profileValues, {})).not.toThrow();
    });

    it('truth-table: each builtin profile resolves correctly through stageProfileValues', () => {
      for (const id of PROFILE_IDS) {
        const result = stageProfileValues(id, BUILTIN_PROFILES[id].values, {});
        expect(result.active_profile).toBe(id);
        // Every key in the profile's values is present in the staged result.
        for (const key of Object.keys(BUILTIN_PROFILES[id].values)) {
          expect(result).toHaveProperty(key);
        }
      }
    });

    it('explicit active_profile assignment beats a planted active_profile inside profile.values', () => {
      // Defense-in-depth: even if a future contributor plants
      // active_profile inside a profile's values (which Plan 02-01
      // forbids), the explicit final assignment wins.
      const result = stageProfileValues(
        'turbo',
        { active_profile: 'default', effort: 'turbo' },
        {},
      );
      expect(result.active_profile).toBe('turbo'); // NOT 'default'
    });
  });

  describe('ProfileDropdown component', () => {
    it('is a callable function (smoke)', () => {
      expect(typeof ProfileDropdown).toBe('function');
    });
  });
});
