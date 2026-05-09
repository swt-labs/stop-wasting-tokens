import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  markOnboardingDismissed,
  shouldShowOnboarding,
} from '../src/client/lib/onboarding-storage.js';

const STORAGE_KEY = 'swt:dashboard:onboarded-v1';

interface FakeStorage {
  store: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function installFakeLocalStorage(): FakeStorage {
  const store = new Map<string, string>();
  const fake: FakeStorage = {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
  (globalThis as { localStorage?: FakeStorage }).localStorage = fake;
  return fake;
}

function uninstallFakeLocalStorage(): void {
  delete (globalThis as { localStorage?: unknown }).localStorage;
}

describe('shouldShowOnboarding / markOnboardingDismissed', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = installFakeLocalStorage();
  });

  afterEach(() => {
    uninstallFakeLocalStorage();
  });

  it('returns true on first visit (storage empty)', () => {
    expect(shouldShowOnboarding()).toBe(true);
  });

  it('returns false after markOnboardingDismissed is called', () => {
    markOnboardingDismissed();
    expect(shouldShowOnboarding()).toBe(false);
  });

  it('persists dismiss across calls (simulating page reload)', () => {
    markOnboardingDismissed();
    expect(storage.store.get(STORAGE_KEY)).toBe('dismissed');
    expect(shouldShowOnboarding()).toBe(false);
  });

  it('returns true when storage is unavailable (defensive default)', () => {
    uninstallFakeLocalStorage();
    expect(shouldShowOnboarding()).toBe(true);
  });

  it('markOnboardingDismissed is a no-op when storage is unavailable', () => {
    uninstallFakeLocalStorage();
    expect(() => markOnboardingDismissed()).not.toThrow();
  });

  it('returns true when storage has a non-dismissed value (forward-compat with future states)', () => {
    storage.store.set(STORAGE_KEY, 'some-future-state');
    expect(shouldShowOnboarding()).toBe(true);
  });
});
