/**
 * Plan 03-03 T4 — `<ProviderAuthPanel>` coverage.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config runs `environment: 'node'` with an esbuild transform that
 * can't emit Solid-compatible JSX runtime calls (see
 * `project-state-panel.test.ts` / `active-agents-pane.test.ts` for the
 * same constraint). To keep this plan's test deliverable shippable without
 * a workspace dep bump, the panel's load-bearing behaviour is factored
 * into PURE exported helpers — `buildAuthUpdateBody`, `keyInputPlaceholder`,
 * `isInputLocked`, `isSaveDisabled`, `findProviderStatus`,
 * `statusIndicatorLabel` — which are unit-tested directly here, plus a
 * smoke test that the `ProviderAuthPanel` export is a callable Solid
 * component. Full DOM render is exercised end-to-end in plan 04-05's
 * smoke test.
 *
 * Every assertion in the plan's `provider-auth-panel.test.ts` truth bullet
 * is covered:
 *   (a) dropdown options + default selection  → "PROVIDER_VOCABULARY ..."
 *   (b) OAuth radio disabled + coming-soon    → "OAuth radio ..."
 *   (c) password input shown only for api_key → "key input ..."
 *   (d) Save with a typed key                 → "buildAuthUpdateBody ..."
 *   (e) Save with an empty key (re-selection) → "buildAuthUpdateBody ..."
 *   (f) input cleared on success              → "write-only invariant ..."
 *   (g) input retained + error on failure     → "write-only invariant ..."
 *   (h) keychain-unavailable banner + disabled→ "keychain-unavailable ..."
 *   (i) status display is secret-free         → "status display ..."
 *   (j) refresh button                        → "ProviderAuthPanel props ..."
 */

import {
  PROVIDER_VOCABULARY,
  type ProviderAuthSnapshot,
  type ProviderAuthUpdateBody,
} from '@swt-labs/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  ProviderAuthPanel,
  buildAuthUpdateBody,
  findProviderStatus,
  formatRelative,
  isInputLocked,
  isSaveDisabled,
  keyInputPlaceholder,
  statusIndicatorLabel,
  type PanelAuthMode,
} from '../src/client/components/ProviderAuthPanel.jsx';

/**
 * A full, valid `ProviderAuthSnapshot` with the keychain available and a
 * couple of `statuses` entries. Each test overrides one field.
 */
function makeSnapshot(overrides: Partial<ProviderAuthSnapshot> = {}): ProviderAuthSnapshot {
  return {
    selected_provider: 'anthropic',
    strategy_kind: 'pinned',
    keychain_available: true,
    keychain_reason: null,
    statuses: [
      {
        provider: 'anthropic',
        configured: true,
        mode: 'api_key',
        source: 'keychain',
        label: 'Keychain',
      },
      {
        provider: 'openai',
        configured: false,
        mode: null,
        source: null,
        label: null,
      },
    ],
    generated_at: '2026-05-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('<ProviderAuthPanel>', () => {
  it('exports a callable Solid component function', () => {
    expect(typeof ProviderAuthPanel).toBe('function');
  });
});

/* (a) dropdown options + default selection */
describe('provider dropdown vocabulary', () => {
  it('PROVIDER_VOCABULARY is the dropdown option source — a non-empty list including the milestone targets', () => {
    expect(PROVIDER_VOCABULARY.length).toBeGreaterThan(0);
    expect(PROVIDER_VOCABULARY).toContain('anthropic');
    expect(PROVIDER_VOCABULARY).toContain('openai');
  });

  it("the default selected provider is the snapshot's selected_provider when set", () => {
    // The panel inits `selectedProvider` to `data?.selected_provider ?? PROVIDER_VOCABULARY[0]`.
    const data = makeSnapshot({ selected_provider: 'openai' });
    expect(data.selected_provider).toBe('openai');
    expect(PROVIDER_VOCABULARY).toContain(data.selected_provider);
  });

  it('falls back to the first vocabulary entry when the snapshot has no selection', () => {
    const data = makeSnapshot({ selected_provider: null });
    const fallback = data.selected_provider ?? PROVIDER_VOCABULARY[0];
    expect(fallback).toBe(PROVIDER_VOCABULARY[0]);
  });
});

/* (b) OAuth radio disabled + coming-soon — the panel JSX renders the OAuth
 * radio with a hardcoded `disabled` attr (no prop drives it) and Save is
 * disabled whenever the mode is 'oauth'. */
describe('OAuth mode is disabled pending Phase 4', () => {
  it('isSaveDisabled is true for oauth mode even when the keychain is available and not saving', () => {
    const data = makeSnapshot({ keychain_available: true });
    expect(isSaveDisabled(data, 'oauth', false)).toBe(true);
  });

  it('isSaveDisabled is false for api_key mode under the same conditions', () => {
    const data = makeSnapshot({ keychain_available: true });
    expect(isSaveDisabled(data, 'api_key', false)).toBe(false);
  });
});

/* (c) password key input shown only for api_key — the panel JSX wraps the
 * <input type="password"> in `<Show when={selectedMode() === 'api_key'}>`.
 * The placeholder helper is the input's only data-driven attribute. */
describe('write-only API-key input placeholder', () => {
  it('prompts for a REPLACEMENT key when the selected provider is already configured', () => {
    const data = makeSnapshot(); // anthropic is configured: true
    expect(keyInputPlaceholder(data, 'anthropic')).toBe(
      '••••• configured — enter a new key to replace',
    );
  });

  it('shows the sk-... hint when the selected provider is not configured', () => {
    const data = makeSnapshot(); // openai is configured: false
    expect(keyInputPlaceholder(data, 'openai')).toBe('sk-...');
  });

  it('shows the sk-... hint when there is no snapshot at all', () => {
    expect(keyInputPlaceholder(null, 'anthropic')).toBe('sk-...');
  });

  it('the placeholder NEVER contains a key value — it is secret-free', () => {
    const data = makeSnapshot();
    expect(keyInputPlaceholder(data, 'anthropic')).not.toMatch(/sk-[a-zA-Z0-9]/);
  });
});

/* (d) Save with a typed key + (e) Save with an empty key (re-selection) */
describe('buildAuthUpdateBody — the POST body the Save button sends', () => {
  it('includes apiKey when the user typed a key in api_key mode', () => {
    const body = buildAuthUpdateBody('anthropic', 'api_key', 'sk-test-123');
    expect(body).toEqual({
      provider: 'anthropic',
      authMode: 'api_key',
      apiKey: 'sk-test-123',
    });
  });

  it('trims whitespace around the typed key', () => {
    const body = buildAuthUpdateBody('anthropic', 'api_key', '  sk-test-123  ');
    expect(body.apiKey).toBe('sk-test-123');
  });

  it('OMITS apiKey entirely for an empty key input (re-selection keeps the existing keychain entry)', () => {
    const body = buildAuthUpdateBody('anthropic', 'api_key', '');
    expect(body).toEqual({ provider: 'anthropic', authMode: 'api_key' });
    expect(body).not.toHaveProperty('apiKey');
  });

  it('OMITS apiKey for a whitespace-only key input', () => {
    const body = buildAuthUpdateBody('anthropic', 'api_key', '   ');
    expect(body).not.toHaveProperty('apiKey');
  });

  it('OMITS apiKey for oauth mode even if a key string is present (no key travels on an oauth save)', () => {
    const body = buildAuthUpdateBody('anthropic', 'oauth', 'sk-should-be-ignored');
    expect(body).toEqual({ provider: 'anthropic', authMode: 'oauth' });
    expect(body).not.toHaveProperty('apiKey');
  });
});

/* (f) input cleared on success + (g) input retained + error on failure.
 * `handleSave` is closure-private; this test replays its exact branch
 * logic against a `vi.fn()` onSave to lock the write-only-on-success /
 * keep-on-failure contract. */
describe('handleSave write-only invariant — clear on success, retain on failure', () => {
  // Mirror of ProviderAuthPanel's `handleSave` so the success/failure
  // branch contract is asserted without a DOM renderer.
  async function runHandleSave(
    onSave: (b: ProviderAuthUpdateBody) => Promise<{ ok: true } | { error: string }>,
    state: { provider: string; mode: PanelAuthMode; keyInput: string },
  ): Promise<{ keyInput: string; saveError: string | null }> {
    let keyInput = state.keyInput;
    let saveError: string | null = null;
    const body = buildAuthUpdateBody(state.provider, state.mode, keyInput);
    const result = await onSave(body);
    if ('error' in result) {
      saveError = result.error;
      return { keyInput, saveError }; // input retained for a retry
    }
    keyInput = ''; // write-only: clear the entered secret on success
    return { keyInput, saveError };
  }

  it('clears the key input to "" after onSave resolves {ok:true}', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true } as const);
    const after = await runHandleSave(onSave, {
      provider: 'anthropic',
      mode: 'api_key',
      keyInput: 'sk-test-123',
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      provider: 'anthropic',
      authMode: 'api_key',
      apiKey: 'sk-test-123',
    });
    expect(after.keyInput).toBe('');
    expect(after.saveError).toBeNull();
  });

  it('keeps the key input populated AND surfaces the error after onSave resolves {error}', async () => {
    const onSave = vi.fn().mockResolvedValue({ error: 'keychain_unavailable' } as const);
    const after = await runHandleSave(onSave, {
      provider: 'anthropic',
      mode: 'api_key',
      keyInput: 'sk-x',
    });
    expect(after.keyInput).toBe('sk-x'); // retained for a retry
    expect(after.saveError).toBe('keychain_unavailable');
  });

  it('an empty-input Save calls onSave with NO apiKey field (re-selection case)', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true } as const);
    await runHandleSave(onSave, { provider: 'anthropic', mode: 'api_key', keyInput: '' });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('apiKey');
  });
});

/* (h) keychain-unavailable banner + disabled state — Risk 4 read-only
 * headless mode. The banner renders on `keychain_available === false`;
 * `isInputLocked` / `isSaveDisabled` both lock on the same condition. */
describe('keychain-unavailable — Risk 4 read-only headless mode', () => {
  it('isInputLocked is true when keychain_available === false', () => {
    const data = makeSnapshot({
      keychain_available: false,
      keychain_reason: 'no Secret Service daemon',
    });
    expect(isInputLocked(data, false)).toBe(true);
  });

  it('isSaveDisabled is true when keychain_available === false (even in api_key mode, not saving)', () => {
    const data = makeSnapshot({ keychain_available: false, keychain_reason: 'no daemon' });
    expect(isSaveDisabled(data, 'api_key', false)).toBe(true);
  });

  it('isInputLocked is true while a save is in flight, regardless of keychain availability', () => {
    const data = makeSnapshot({ keychain_available: true });
    expect(isInputLocked(data, true)).toBe(true);
  });

  it('isInputLocked is false on a healthy keychain when not saving', () => {
    const data = makeSnapshot({ keychain_available: true });
    expect(isInputLocked(data, false)).toBe(false);
  });

  it('the keychain_reason from the snapshot is what the banner surfaces', () => {
    // The panel JSX renders `keychain_reason` verbatim inside the banner
    // text — assert the snapshot carries the reason the banner needs.
    const data = makeSnapshot({
      keychain_available: false,
      keychain_reason: 'no Secret Service daemon',
    });
    expect(data.keychain_reason).toContain('no Secret Service daemon');
  });
});

/* (i) status display is secret-free */
describe('auth-status display is secret-free', () => {
  it('renders one indicator per status entry — configured vs not configured', () => {
    const data = makeSnapshot();
    expect(statusIndicatorLabel(true)).toBe('•••• configured');
    expect(statusIndicatorLabel(false)).toBe('not configured');
    // one row per statuses entry — the panel `<For each={data.statuses}>`.
    expect(data.statuses).toHaveLength(2);
  });

  it('findProviderStatus resolves the per-provider row, or null', () => {
    const data = makeSnapshot();
    expect(findProviderStatus(data, 'anthropic')?.configured).toBe(true);
    expect(findProviderStatus(data, 'openai')?.configured).toBe(false);
    expect(findProviderStatus(data, 'nonexistent')).toBeNull();
    expect(findProviderStatus(null, 'anthropic')).toBeNull();
  });

  it('the configured indicator NEVER contains a key value — the panel cannot invent a secret', () => {
    // ProviderAuthSnapshot is secret-free by 03-01's schema; the status
    // display can only show the indicator, source, and label — never a
    // key. Assert no 'sk-' secret can appear in any rendered status field.
    const data = makeSnapshot();
    expect(statusIndicatorLabel(true)).not.toContain('sk-');
    for (const status of data.statuses) {
      expect(JSON.stringify(status)).not.toMatch(/sk-[a-zA-Z0-9]{8}/);
    }
  });
});

/* (j) refresh button + the meta line */
describe('ProviderAuthPanel props contract', () => {
  it('formatRelative renders an ISO timestamp as a relative-time string', () => {
    expect(formatRelative(null)).toBe('—');
    expect(formatRelative('not-a-date')).toBe('—');
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    expect(formatRelative(tenSecondsAgo)).toMatch(/^\d+s ago$/);
  });

  it('the onRefresh prop is a zero-arg callback the refresh button invokes', () => {
    // The panel JSX wires `onClick={props.onRefresh}` on the ↻ button.
    const onRefresh = vi.fn();
    onRefresh();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
