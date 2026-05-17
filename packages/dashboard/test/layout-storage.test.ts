// Covers the v10 layout storage shape — DoctorPanel + DetectPhasePanel
// were removed at user request; UserNotesPanel is the only remaining
// tools-column card and the inner vertical Resizable wrapper is gone.
// The `tools` array shrinks from 3 → 0 entries (kept as an empty field
// on the shape so a future multi-panel tools column doesn't need a
// schema migration).
//
// Older v5/v6/v7/v8/v9 entries become orphaned under their own keys;
// loadLayout only reads the current v10 key and falls through to
// DEFAULT_LAYOUT when it's absent. A v10 key containing a non-empty
// `tools` (anyone who manually edited it, or stale data) MIGRATES via
// `migrateToolsArray` — it is sliced down to `[]` with a one-time
// console.debug; the storage value itself is NOT auto-rewritten.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_LAYOUT,
  loadLayout,
  migrateToolsArray,
  saveLayout,
} from '../src/client/lib/layout-storage.ts';

const STORAGE_KEY = 'swt:dashboard:layout-v10';
const OLD_V5_KEY = 'swt:dashboard:layout-v5';
const OLD_V7_KEY = 'swt:dashboard:layout-v7';
const OLD_V8_KEY = 'swt:dashboard:layout-v8';
const OLD_V9_KEY = 'swt:dashboard:layout-v9';

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
  it('tools array has exactly 0 entries (v10: only UserNotesPanel, no inner resize stack)', () => {
    expect(DEFAULT_LAYOUT.tools).toHaveLength(0);
  });

  it('main has 4 entries, center and right have 2 entries', () => {
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

  it('round-trips a valid v10 layout', () => {
    const layout = {
      main: [0.27, 0.45, 0.13, 0.15],
      center: [0.6, 0.4],
      right: [0.7, 0.3],
      tools: [],
    };
    saveLayout(layout);
    expect(loadLayout()).toEqual(layout);
  });

  it('v10 forward-migration: persisted 3-entry tools (v9 shape) slices to empty', () => {
    // A user with a stale v10 read of v9 data (or anyone who manually
    // copied a 3-element tools into the v10 key) gets a one-time slice +
    // console.debug. The storage value itself is NOT auto-rewritten;
    // the next persist cycle overwrites with the new shape.
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const stale = {
      main: [0.27, 0.45, 0.13, 0.15],
      center: [0.65, 0.35],
      right: [0.65, 0.35],
      tools: [0.34, 0.33, 0.33], // 3 entries — v9 shape
    };
    memStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    const loaded = loadLayout();
    expect(loaded.tools).toEqual([]); // sliced to empty
    // The other (valid) sections come through unchanged.
    expect(loaded.main).toEqual(stale.main);
    expect(loaded.center).toEqual(stale.center);
    expect(loaded.right).toEqual(stale.right);
    // The storage value is untouched — next persist will overwrite.
    const raw = memStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw as string)).toEqual(stale);
    debugSpy.mockRestore();
  });

  it('v10 forward-migration: persisted 4-entry tools (v8 shape) slices to empty', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const stale = {
      main: [0.27, 0.45, 0.13, 0.15],
      center: [0.65, 0.35],
      right: [0.65, 0.35],
      tools: [0.25, 0.25, 0.25, 0.25], // 4 entries — pre-v9 shape
    };
    memStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    const loaded = loadLayout();
    expect(loaded.tools).toEqual([]);
    debugSpy.mockRestore();
  });

  it('falls through to DEFAULT_LAYOUT.main when stored main is 5 entries (pre-v8 shape)', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const oldShape = {
      main: [0.12, 0.15, 0.45, 0.13, 0.15],
      center: [0.65, 0.35],
      right: [0.65, 0.35],
      tools: [],
    };
    memStorage.setItem(STORAGE_KEY, JSON.stringify(oldShape));
    const loaded = loadLayout();
    expect(loaded.main).toEqual(DEFAULT_LAYOUT.main);
    expect(loaded.tools).toEqual([]);
    debugSpy.mockRestore();
  });

  it('a v5 key (6-entry tools) is orphaned: loadLayout returns DEFAULT_LAYOUT', () => {
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

  it('a v9 key (3-entry tools) is orphaned: loadLayout returns DEFAULT_LAYOUT', () => {
    // v10 bumped the storage key — a stranded v9 entry must NOT bleed
    // through into the result.
    memStorage.setItem(
      OLD_V9_KEY,
      JSON.stringify({
        main: [0.27, 0.45, 0.13, 0.15],
        center: [0.65, 0.35],
        right: [0.65, 0.35],
        tools: [0.34, 0.33, 0.33],
      }),
    );
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('returns DEFAULT_LAYOUT on malformed JSON', () => {
    memStorage.setItem(STORAGE_KEY, 'not json {{{');
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });
});

describe('saveLayout', () => {
  it('writes to the v10 storage key', () => {
    const layout = {
      main: [0.27, 0.45, 0.13, 0.15],
      center: [0.65, 0.35],
      right: [0.65, 0.35],
      tools: [],
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

describe('migrateToolsArray (v10 forward-migration shim)', () => {
  it('slices a 3-entry array down to the v10 default length (0)', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(migrateToolsArray([0.34, 0.33, 0.33])).toEqual([]);
    debugSpy.mockRestore();
  });

  it('slices a 4-entry array down to the v10 default length (0)', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(migrateToolsArray([0.25, 0.25, 0.25, 0.25])).toEqual([]);
    debugSpy.mockRestore();
  });

  it('returns null for arrays already at the target length (no migration needed)', () => {
    expect(migrateToolsArray([])).toBeNull();
  });

  it('returns null for non-array input (defensive)', () => {
    expect(migrateToolsArray(null)).toBeNull();
    expect(migrateToolsArray(undefined)).toBeNull();
    expect(migrateToolsArray('not an array')).toBeNull();
    expect(migrateToolsArray({ tools: [0.25, 0.25, 0.25, 0.25] })).toBeNull();
  });
});
