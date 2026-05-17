// Covers the v9 layout storage shape (Options Menu Consolidation —
// plan 01-03 — ConfigPanel deleted, tools column shrinks from 4 → 3
// entries: [Doctor, DetectPhase, UserNotes]).
//
// Older v5/v6/v7/v8 entries become orphaned under their own keys;
// loadLayout only reads the current v9 key and falls through to
// DEFAULT_LAYOUT when it's absent. A v9 key containing a 4-entry
// `tools` (e.g. a stale read of pre-01-03 data manually copied into
// v9, or a hypothetical pre-key-bump dev cache) MIGRATES via
// `migrateToolsArray` — it is sliced to the new length with a one-time
// console.debug; the storage value itself is NOT auto-rewritten.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_LAYOUT,
  loadLayout,
  migrateToolsArray,
  saveLayout,
} from '../src/client/lib/layout-storage.ts';

const STORAGE_KEY = 'swt:dashboard:layout-v9';
const OLD_V5_KEY = 'swt:dashboard:layout-v5';
const OLD_V7_KEY = 'swt:dashboard:layout-v7';
const OLD_V8_KEY = 'swt:dashboard:layout-v8';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}

let memStorage: MemoryStorage;

beforeEach(() => {
  memStorage = new MemoryStorage();
  (globalThis as { localStorage?: MemoryStorage }).localStorage = memStorage;
});

afterEach(() => {
  delete (globalThis as { localStorage?: MemoryStorage }).localStorage;
});

describe('DEFAULT_LAYOUT', () => {
  it('tools array has exactly 3 entries (Doctor, DetectPhase, UserNotes) — v9 shape', () => {
    expect(DEFAULT_LAYOUT.tools).toHaveLength(3);
  });

  it('tools fractions sum to 1.0 (within floating-point tolerance)', () => {
    const sum = DEFAULT_LAYOUT.tools.reduce((acc, n) => acc + n, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it('every tools entry is >= 0.1 (per the minSize floor)', () => {
    for (const n of DEFAULT_LAYOUT.tools) {
      expect(n).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('main has 4 entries (v8: artifactTree slot removed), center and right have 2 entries', () => {
    expect(DEFAULT_LAYOUT.main).toHaveLength(4);
    expect(DEFAULT_LAYOUT.center).toHaveLength(2);
    expect(DEFAULT_LAYOUT.right).toHaveLength(2);
  });

  it('main fractions sum to 1.0 (within floating-point tolerance)', () => {
    const sum = DEFAULT_LAYOUT.main.reduce((acc, n) => acc + n, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });
});

describe('loadLayout', () => {
  it('returns DEFAULT_LAYOUT when storage is empty', () => {
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('returns DEFAULT_LAYOUT when storage is unavailable', () => {
    delete (globalThis as { localStorage?: MemoryStorage }).localStorage;
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('round-trips a valid v9 layout', () => {
    const layout = {
      main: [0.27, 0.45, 0.13, 0.15],
      center: [0.6, 0.4],
      right: [0.7, 0.3],
      tools: [0.34, 0.33, 0.33],
    };
    saveLayout(layout);
    expect(loadLayout()).toEqual(layout);
  });

  it('plan 01-03 forward-migration: persisted 4-entry tools (pre-01-03 shape) slices to 3', () => {
    // A user with a stale v9 read of pre-01-03 data (or a dev who
    // copied 4-element tools into the v9 key) gets a one-time slice +
    // console.debug. The storage value itself is NOT auto-rewritten;
    // the next persist cycle overwrites with the new shape.
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const stale = {
      main: [0.27, 0.45, 0.13, 0.15],
      center: [0.65, 0.35],
      right: [0.65, 0.35],
      tools: [0.25, 0.25, 0.25, 0.25], // 4 entries — pre-01-03 shape
    };
    memStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    const loaded = loadLayout();
    expect(loaded.tools).toEqual([0.25, 0.25, 0.25]); // sliced to 3 entries
    // The other (valid) sections come through unchanged.
    expect(loaded.main).toEqual(stale.main);
    expect(loaded.center).toEqual(stale.center);
    expect(loaded.right).toEqual(stale.right);
    // The storage value is untouched — next persist will overwrite.
    const raw = memStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw as string)).toEqual(stale);
    debugSpy.mockRestore();
  });

  it('falls through to DEFAULT_LAYOUT.tools when stored tools array is 6 entries AND the sliced prefix is not a valid fraction array', () => {
    // The slice shim only succeeds when the head of the array is a
    // valid fraction array of the new length. A 6-entry array whose
    // first 3 entries happen to be valid fractions would be migrated
    // (which is fine — they were valid at some point); a non-fraction
    // sliced prefix falls through to DEFAULT_LAYOUT.tools.
    const oldShape = {
      main: [0.27, 0.45, 0.13, 0.15],
      center: [0.65, 0.35],
      right: [0.65, 0.35],
      tools: [0, 0.176, 0.176, 0.176, 0.176, 0.176], // 0 invalidates the slice
    };
    memStorage.setItem(STORAGE_KEY, JSON.stringify(oldShape));
    const loaded = loadLayout();
    expect(loaded.tools).toEqual(DEFAULT_LAYOUT.tools);
  });

  it('falls through to DEFAULT_LAYOUT.main when stored main is 5 entries (pre-v8 shape)', () => {
    // A pre-v8 user might have edited the v9 key directly with their
    // old 5-element main. The validator must reject the wrong length.
    // The 4-entry tools array goes through the plan 01-03 migration
    // shim (slices to 3 with a console.debug).
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const oldShape = {
      main: [0.12, 0.15, 0.45, 0.13, 0.15],
      center: [0.65, 0.35],
      right: [0.65, 0.35],
      tools: [0.25, 0.25, 0.25, 0.25],
    };
    memStorage.setItem(STORAGE_KEY, JSON.stringify(oldShape));
    const loaded = loadLayout();
    expect(loaded.main).toEqual(DEFAULT_LAYOUT.main);
    expect(loaded.tools).toEqual([0.25, 0.25, 0.25]);
    debugSpy.mockRestore();
  });

  it('a v5 key (6-entry tools) is orphaned: loadLayout returns DEFAULT_LAYOUT', () => {
    // Old v5 data lives under a different STORAGE_KEY entirely; the
    // current loadLayout only reads the v9 key, so a stranded v5
    // entry must NOT bleed into the result.
    memStorage.setItem(
      OLD_V5_KEY,
      JSON.stringify({
        main: [0.1, 0.1, 0.5, 0.15, 0.15],
        center: [0.6, 0.4],
        right: [0.6, 0.4],
        tools: [0.12, 0.176, 0.176, 0.176, 0.176, 0.176],
      }),
    );
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('a v7 key (5-entry main) is orphaned: loadLayout returns DEFAULT_LAYOUT', () => {
    // Pre-merge v7 data lives under its own key; the validator must
    // never read it as v9.
    memStorage.setItem(
      OLD_V7_KEY,
      JSON.stringify({
        main: [0.12, 0.15, 0.45, 0.13, 0.15],
        center: [0.65, 0.35],
        right: [0.65, 0.35],
        tools: [0.25, 0.25, 0.25, 0.25],
      }),
    );
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('a v8 key (4-entry tools) is orphaned: loadLayout returns DEFAULT_LAYOUT', () => {
    // Plan 01-03 bumped to v9 — a v8 key is never read. Stranded v8
    // data must NOT leak through into the result.
    memStorage.setItem(
      OLD_V8_KEY,
      JSON.stringify({
        main: [0.27, 0.45, 0.13, 0.15],
        center: [0.65, 0.35],
        right: [0.65, 0.35],
        tools: [0.25, 0.25, 0.25, 0.25],
      }),
    );
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('rejects a tools entry of 0 (not in the open (0,1) range)', () => {
    memStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_LAYOUT,
        tools: [0, 0.5, 0.5],
      }),
    );
    expect(loadLayout().tools).toEqual(DEFAULT_LAYOUT.tools);
  });

  it('rejects a tools entry of 1 (not in the open (0,1) range)', () => {
    memStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_LAYOUT,
        tools: [1, 0, 0],
      }),
    );
    expect(loadLayout().tools).toEqual(DEFAULT_LAYOUT.tools);
  });

  it('rejects a NaN tools entry', () => {
    memStorage.setItem(
      STORAGE_KEY,
      // JSON has no NaN literal; mimic the corrupted-shape case.
      '{"main":[0.27,0.45,0.13,0.15],"center":[0.65,0.35],"right":[0.65,0.35],"tools":[null,0.5,0.5]}',
    );
    expect(loadLayout().tools).toEqual(DEFAULT_LAYOUT.tools);
  });

  it('returns DEFAULT_LAYOUT on malformed JSON', () => {
    memStorage.setItem(STORAGE_KEY, 'not json {{{');
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });
});

describe('saveLayout', () => {
  it('writes to the v9 storage key', () => {
    const layout = {
      main: [0.27, 0.45, 0.13, 0.15],
      center: [0.65, 0.35],
      right: [0.65, 0.35],
      tools: [0.34, 0.33, 0.33],
    };
    saveLayout(layout);
    const raw = memStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(layout);
  });

  it('does not crash when storage is unavailable', () => {
    delete (globalThis as { localStorage?: MemoryStorage }).localStorage;
    expect(() => saveLayout(DEFAULT_LAYOUT)).not.toThrow();
  });
});

describe('migrateToolsArray (plan 01-03 forward-migration shim)', () => {
  it('slices a 4-entry array down to the v9 default length (3)', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(migrateToolsArray([0.25, 0.25, 0.25, 0.25])).toEqual([0.25, 0.25, 0.25]);
    debugSpy.mockRestore();
  });

  it('returns null for arrays at or below the target length (no migration needed)', () => {
    expect(migrateToolsArray([0.34, 0.33, 0.33])).toBeNull();
    expect(migrateToolsArray([0.5, 0.5])).toBeNull();
    expect(migrateToolsArray([])).toBeNull();
  });

  it('returns null when the sliced prefix is not a valid fraction array', () => {
    // The first 3 entries of [0, 0.176, 0.176, 0.176, 0.176, 0.176]
    // start with 0 — outside the open (0,1) range — so the slice
    // fails validation and migration returns null.
    expect(migrateToolsArray([0, 0.176, 0.176, 0.176, 0.176, 0.176])).toBeNull();
  });

  it('returns null for non-array input (defensive)', () => {
    expect(migrateToolsArray(null)).toBeNull();
    expect(migrateToolsArray(undefined)).toBeNull();
    expect(migrateToolsArray('not an array')).toBeNull();
    expect(migrateToolsArray({ tools: [0.25, 0.25, 0.25, 0.25] })).toBeNull();
  });
});
