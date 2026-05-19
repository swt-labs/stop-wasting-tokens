import { describe, expect, it } from 'vitest';

import { ConfigSchema, DEFAULT_CONFIG } from '../src/config/Config.js';
import { BUILTIN_PROFILES, PROFILE_IDS } from '../src/config/profiles.js';

describe('BUILTIN_PROFILES', () => {
  it('PROFILE_IDS lists all 4 builtin profile ids in canonical display order', () => {
    expect(PROFILE_IDS).toEqual(['default', 'turbo', 'quality', 'prototype']);
  });

  it('BUILTIN_PROFILES exports an entry for every PROFILE_IDS id', () => {
    for (const id of PROFILE_IDS) {
      expect(BUILTIN_PROFILES[id]).toBeDefined();
      expect(BUILTIN_PROFILES[id].name.length).toBeGreaterThan(0);
      expect(BUILTIN_PROFILES[id].description.length).toBeGreaterThan(0);
    }
  });

  it('every profile.id matches its BUILTIN_PROFILES key (referential integrity)', () => {
    for (const id of PROFILE_IDS) {
      expect(BUILTIN_PROFILES[id].id).toBe(id);
    }
  });

  it('every profile parses cleanly through ConfigSchema (no orphan keys, no type mismatches)', () => {
    for (const id of PROFILE_IDS) {
      expect(() =>
        ConfigSchema.parse({ ...DEFAULT_CONFIG, ...BUILTIN_PROFILES[id].values }),
      ).not.toThrow();
    }
  });

  it('Turbo profile writes prefer_teams: "never" (drift-lock — NOT the brief typo "serialized")', () => {
    expect(BUILTIN_PROFILES.turbo.values.prefer_teams).toBe('never');
    // Negative truth-table: 'serialized' isn't even a valid enum value, but we lock the
    // spelling defensively so a future contributor copy-pasting the brief fails fast.
    expect(BUILTIN_PROFILES.turbo.values.prefer_teams).not.toBe('serialized');
  });

  it('Turbo profile parses with prefer_teams="never" specifically', () => {
    const parsed = ConfigSchema.parse({ ...DEFAULT_CONFIG, ...BUILTIN_PROFILES.turbo.values });
    expect(parsed.prefer_teams).toBe('never');
  });

  it('default profile mirrors schema defaults for planning_tracking', () => {
    // Drift-lock: Default profile uses 'manual' (schema default), NOT the brief's 'ignore'.
    // The 'default' profile's semantic meaning is 'reset to schema defaults' — using
    // anything else would make the profile's own label dishonest.
    expect(BUILTIN_PROFILES.default.values.planning_tracking).toBe('manual');
  });

  it('no profile values contain active_profile (set separately by handleProfileSelect)', () => {
    for (const id of PROFILE_IDS) {
      expect(BUILTIN_PROFILES[id].values).not.toHaveProperty('active_profile');
    }
  });

  it('every key in every profile.values exists in ConfigSchema.shape (no orphan keys)', () => {
    const schemaKeys = new Set(Object.keys(ConfigSchema.shape));
    for (const id of PROFILE_IDS) {
      for (const key of Object.keys(BUILTIN_PROFILES[id].values)) {
        expect(schemaKeys.has(key)).toBe(true);
      }
    }
  });
});
