// Covers the v8 layout storage shape (PHASES + ARTIFACTS panes merged
// into one PhaseStepper card — see a_non_production_files/artifacts.md).
// `main` shrinks from 5 → 4 entries: [phasesCard, center, right, tools].
// The artifactTree slot disappears entirely.
//
// Older v5/v6/v7 entries become orphaned under their own keys; loadLayout
// only reads the current v8 key and falls through to DEFAULT_LAYOUT
// when it's absent. The pre-v8 5-element `main` shape would still be
// silently rejected by `isFractionArray(..., 4)` if it ever leaked into
// the v8 key — never feed a 5-element array to the 4-panel layout.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_LAYOUT, loadLayout, saveLayout } from '../src/client/lib/layout-storage.ts';

const STORAGE_KEY = 'swt:dashboard:layout-v8';
const OLD_V5_KEY = 'swt:dashboard:layout-v5';
const OLD_V7_KEY = 'swt:dashboard:layout-v7';

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
  it('tools array has exactly 4 entries (Config, Doctor, DetectPhase, UserNotes)', () => {
    expect(DEFAULT_LAYOUT.tools).toHaveLength(4);
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

  it('round-trips a valid v8 layout', () => {
    const layout = {
      main: [0.27, 0.45, 0.13, 0.15],
      center: [0.6, 0.4],
      right: [0.7, 0.3],
      tools: [0.3, 0.2, 0.2, 0.3],
    };
    saveLayout(layout);
    expect(loadLayout()).toEqual(layout);
  });

  it('falls through to DEFAULT_LAYOUT.tools when stored tools array is 6 entries (v5 shape)', () => {
    // An old v5 layout might have made it into the v8 key by direct
    // user edit / dev console — the validator must reject it.
    const oldShape = {
      main: [0.27, 0.45, 0.13, 0.15],
      center: [0.65, 0.35],
      right: [0.65, 0.35],
      tools: [0.12, 0.176, 0.176, 0.176, 0.176, 0.176], // 6 entries — v5 shape, no longer valid
    };
    memStorage.setItem(STORAGE_KEY, JSON.stringify(oldShape));
    const loaded = loadLayout();
    expect(loaded.tools).toEqual(DEFAULT_LAYOUT.tools);
    // The other (valid) sections still come through.
    expect(loaded.main).toEqual(oldShape.main);
    expect(loaded.center).toEqual(oldShape.center);
    expect(loaded.right).toEqual(oldShape.right);
  });

  it('falls through to DEFAULT_LAYOUT.main when stored main is 5 entries (pre-v8 shape)', () => {
    // A pre-v8 user might have edited the v8 key directly with their
    // old 5-element main. The validator must reject the wrong length.
    const oldShape = {
      main: [0.12, 0.15, 0.45, 0.13, 0.15],
      center: [0.65, 0.35],
      right: [0.65, 0.35],
      tools: [0.25, 0.25, 0.25, 0.25],
    };
    memStorage.setItem(STORAGE_KEY, JSON.stringify(oldShape));
    const loaded = loadLayout();
    expect(loaded.main).toEqual(DEFAULT_LAYOUT.main);
    expect(loaded.tools).toEqual(oldShape.tools);
  });

  it('a v5 key (6-entry tools) is orphaned: loadLayout returns DEFAULT_LAYOUT', () => {
    // Old v5 data lives under a different STORAGE_KEY entirely; the
    // current loadLayout only reads the v8 key, so a stranded v5
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
    // never read it as v8. Acceptance criterion §6 in artifacts.md —
    // existing users with a 3-pane (here 5-element main) layout do not
    // crash on load.
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

  it('rejects a tools entry of 0 (not in the open (0,1) range)', () => {
    memStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_LAYOUT,
        tools: [0, 0.34, 0.33, 0.33],
      }),
    );
    expect(loadLayout().tools).toEqual(DEFAULT_LAYOUT.tools);
  });

  it('rejects a tools entry of 1 (not in the open (0,1) range)', () => {
    memStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_LAYOUT,
        tools: [1, 0, 0, 0],
      }),
    );
    expect(loadLayout().tools).toEqual(DEFAULT_LAYOUT.tools);
  });

  it('rejects a NaN tools entry', () => {
    memStorage.setItem(
      STORAGE_KEY,
      // JSON has no NaN literal; mimic the corrupted-shape case.
      '{"main":[0.27,0.45,0.13,0.15],"center":[0.65,0.35],"right":[0.65,0.35],"tools":[null,0.34,0.33,0.33]}',
    );
    expect(loadLayout().tools).toEqual(DEFAULT_LAYOUT.tools);
  });

  it('returns DEFAULT_LAYOUT on malformed JSON', () => {
    memStorage.setItem(STORAGE_KEY, 'not json {{{');
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });
});

describe('saveLayout', () => {
  it('writes to the v8 storage key', () => {
    const layout = {
      main: [0.27, 0.45, 0.13, 0.15],
      center: [0.65, 0.35],
      right: [0.65, 0.35],
      tools: [0.25, 0.25, 0.25, 0.25],
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
