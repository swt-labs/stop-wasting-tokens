/**
 * Plan 02-01 T4 — coverage for `<DashboardStatusline>` formatter helpers.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config uses esbuild (which can't emit Solid-compatible JSX runtime
 * calls). Per the Phase 02 Scout Q7 finding + the established
 * `active-agents-pane.test.ts` pattern, we cover the 5 exported pure
 * formatter helpers directly — full DOM rendering is exercised
 * end-to-end via the dashboard smoke flow.
 *
 * Each helper has its own describe block. Cases cover:
 *   - The happy path (real data → expected string)
 *   - Null/undefined fallback to U+2014 em-dash (`—`)
 *   - Edge values (0, NaN, large numbers, negative shouldn't crash)
 *   - The connection-dot's connected/disconnected branch
 *
 * The integer separator between in→out tokens is U+219B (`↛`,
 * RIGHTWARDS ARROW WITH STROKE) — re-verified verbatim in the assertions.
 */

import type { CostSummary, ProviderAuthSnapshot, UsageRollup, UsageWindow } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import {
  connectionDotState,
  formatAgentsCell,
  formatContextEstimate,
  formatStatuslineKnob,
  formatStatuslineProvider,
  formatStatuslineRollup,
  formatStatuslineSessionCost,
  formatStatuslineTokens,
  shortModelLabel,
} from '../src/client/components/DashboardStatusline.jsx';
import type { AgentLiveState } from '@swt-labs/shared';

describe('formatStatuslineProvider', () => {
  it('returns the provider name verbatim when non-empty', () => {
    expect(formatStatuslineProvider('anthropic')).toBe('anthropic');
    expect(formatStatuslineProvider('openai')).toBe('openai');
    expect(formatStatuslineProvider('openrouter')).toBe('openrouter');
  });

  it('returns U+2014 em-dash when null', () => {
    expect(formatStatuslineProvider(null)).toBe('—');
  });

  it('returns U+2014 em-dash when undefined', () => {
    expect(formatStatuslineProvider(undefined)).toBe('—');
  });

  it('returns U+2014 em-dash when empty string', () => {
    expect(formatStatuslineProvider('')).toBe('—');
  });
});

describe('connectionDotState', () => {
  // Minimal fixture — `connectionDotState` only reads `keychain_available`.
  // Tests pass partial shapes via `as ProviderAuthSnapshot` because the
  // helper is field-narrow on purpose.
  function snap(keychainAvailable: boolean | undefined): ProviderAuthSnapshot {
    return { keychain_available: keychainAvailable } as unknown as ProviderAuthSnapshot;
  }

  it('returns "connected" when keychain_available=true', () => {
    expect(connectionDotState(snap(true))).toBe('connected');
  });

  it('returns "disconnected" when keychain_available=false', () => {
    expect(connectionDotState(snap(false))).toBe('disconnected');
  });

  it('returns "disconnected" when keychain_available is undefined', () => {
    expect(connectionDotState(snap(undefined))).toBe('disconnected');
  });

  it('returns "disconnected" when providerAuth is null', () => {
    expect(connectionDotState(null)).toBe('disconnected');
  });
});

describe('formatStatuslineSessionCost', () => {
  it('formats <$1 with 4 decimal places to match CostPanel', () => {
    expect(formatStatuslineSessionCost(0.32)).toBe('$0.3200');
    expect(formatStatuslineSessionCost(0.0042)).toBe('$0.0042');
  });

  it('formats ≥$1 with 2 decimal places', () => {
    expect(formatStatuslineSessionCost(1.234)).toBe('$1.23');
    expect(formatStatuslineSessionCost(42.0)).toBe('$42.00');
  });

  it('formats $0 as $0.0000 (literal zero is a renderable session cost)', () => {
    expect(formatStatuslineSessionCost(0)).toBe('$0.0000');
  });

  it('returns $— for null / undefined / NaN', () => {
    expect(formatStatuslineSessionCost(null)).toBe('$—');
    expect(formatStatuslineSessionCost(undefined)).toBe('$—');
    expect(formatStatuslineSessionCost(Number.NaN)).toBe('$—');
  });
});

describe('formatStatuslineTokens', () => {
  it('renders <1K tokens as raw count', () => {
    expect(formatStatuslineTokens(123, 456)).toBe('(123↛456)');
  });

  it('compacts ≥1K tokens with K suffix (floor)', () => {
    expect(formatStatuslineTokens(12_345, 8_999)).toBe('(12K↛8K)');
    expect(formatStatuslineTokens(1_000, 1_500)).toBe('(1K↛1K)');
  });

  it('compacts ≥1M tokens with M suffix (floor)', () => {
    expect(formatStatuslineTokens(1_500_000, 2_300_000)).toBe('(1M↛2M)');
  });

  it('uses U+219B (right-arrow-with-stroke) as the in→out separator', () => {
    // Sentinel: assert the codepoint explicitly so a future refactor
    // can't quietly degrade `↛` to `->` or `/`.
    const result = formatStatuslineTokens(1, 2);
    expect(result).toContain('↛');
    expect(result).toBe('(1↛2)');
  });

  it('replaces missing sides with U+2014 em-dash', () => {
    expect(formatStatuslineTokens(null, 200)).toBe('(—↛200)');
    expect(formatStatuslineTokens(100, undefined)).toBe('(100↛—)');
    expect(formatStatuslineTokens(null, null)).toBe('(—↛—)');
  });

  it('renders 0 as `0` (zero is a renderable token count)', () => {
    expect(formatStatuslineTokens(0, 0)).toBe('(0↛0)');
  });
});

describe('formatStatuslineRollup', () => {
  function window(costUsd: number): UsageWindow {
    return {
      cost_usd: costUsd,
      tokens_in: 0,
      tokens_out: 0,
      sessions: 0,
    } as unknown as UsageWindow;
  }

  it('formats a populated 7d window as `7d:$X.XX`', () => {
    expect(formatStatuslineRollup(window(2.1), '7d')).toBe('7d:$2.10');
  });

  it('formats a populated 30d window as `30d:$X.XX`', () => {
    expect(formatStatuslineRollup(window(8.42), '30d')).toBe('30d:$8.42');
  });

  it('formats sub-$1 spend with 4 decimal places (matches session-cost helper)', () => {
    expect(formatStatuslineRollup(window(0.0042), '7d')).toBe('7d:$0.0042');
  });

  it('formats $0 spend as `$0.0000` (literal zero is renderable)', () => {
    expect(formatStatuslineRollup(window(0), '7d')).toBe('7d:$0.0000');
  });

  it('falls back to `<label>:—` when window is null', () => {
    expect(formatStatuslineRollup(null, '7d')).toBe('7d:—');
    expect(formatStatuslineRollup(null, '30d')).toBe('30d:—');
  });

  it('falls back to `<label>:—` when window is undefined (aggregator has no data yet)', () => {
    expect(formatStatuslineRollup(undefined, '7d')).toBe('7d:—');
    expect(formatStatuslineRollup(undefined, '30d')).toBe('30d:—');
  });
});

describe('end-to-end format coverage', () => {
  // One round-trip composition test pinning the full statusline output
  // string from a representative cost_summary + usage_rollup pair. Acts
  // as a regression sentinel against accidental spacing/separator drift
  // (per the milestone CONTEXT.md format contract).
  it('composes the canonical statusline output string', () => {
    const provider = formatStatuslineProvider('anthropic');
    const sessionCost = formatStatuslineSessionCost(0.32);
    const tokens = formatStatuslineTokens(12_345, 8_000);
    const week = formatStatuslineRollup(
      { cost_usd: 2.1, tokens_in: 0, tokens_out: 0, sessions: 0 } as unknown as UsageWindow,
      '7d',
    );
    const month = formatStatuslineRollup(
      { cost_usd: 8.42, tokens_in: 0, tokens_out: 0, sessions: 0 } as unknown as UsageWindow,
      '30d',
    );
    const composed = `${provider} ●  ctx —/—  ${sessionCost} ${tokens}  ${week}  ${month}`;
    expect(composed).toBe('anthropic ●  ctx —/—  $0.3200 (12K↛8K)  7d:$2.10  30d:$8.42');
  });

  it('composes a fully-empty statusline (no data sources yet)', () => {
    const composed = [
      formatStatuslineProvider(null),
      '●',
      ' ctx —/— ',
      formatStatuslineSessionCost(null),
      formatStatuslineTokens(null, null),
      formatStatuslineRollup(null, '7d'),
      formatStatuslineRollup(null, '30d'),
    ].join(' ');
    expect(composed).toContain('—');
    expect(composed).toContain('$—');
    expect(composed).toContain('(—↛—)');
    expect(composed).toContain('7d:—');
    expect(composed).toContain('30d:—');
  });

  // Suppress unused warnings on the type imports that exist solely for
  // type-narrowing assertions in the fixtures above.
  it('imports are used (type-coverage suppression)', () => {
    const _used: Array<CostSummary | UsageRollup | undefined> = [undefined];
    expect(_used).toHaveLength(1);
  });
});

// ── Statusline-extension milestone (step 8) — new helpers ──────────────
// Coverage matches the artifacts.md test list:
//   - all-cells-rendered with full data (formatStatuslineKnob full+missing)
//   - missing-knobs → em-dashes (formatStatuslineKnob with null)
//   - context-estimate when window unknown (formatContextEstimate)
//   - agents-list truncation (formatAgentsCell over the 40-char cap)
//   - horizontal scroll classes (deferred to CSS — exercised via the
//     dashboard's manual smoke flow per acceptance criterion §3)

describe('formatStatuslineKnob', () => {
  it('renders `key:value` when value is non-null', () => {
    expect(formatStatuslineKnob('eff', 'thorough')).toBe('eff:thorough');
    expect(formatStatuslineKnob('auto', 'standard')).toBe('auto:standard');
  });

  it('renders `key:—` when value is null or empty', () => {
    expect(formatStatuslineKnob('eff', null)).toBe('eff:—');
    expect(formatStatuslineKnob('auto', '')).toBe('auto:—');
  });
});

describe('shortModelLabel', () => {
  it('strips the `claude-` family prefix from Anthropic ids', () => {
    expect(shortModelLabel('claude-sonnet-4-6')).toBe('sonnet-4-6');
    expect(shortModelLabel('claude-opus-4-7')).toBe('opus-4-7');
    expect(shortModelLabel('claude-haiku-4-5-20251001')).toBe('haiku-4-5-20251001');
  });

  it('leaves non-Anthropic ids unchanged', () => {
    expect(shortModelLabel('gpt-5-codex')).toBe('gpt-5-codex');
    expect(shortModelLabel('llama3.1:8b')).toBe('llama3.1:8b');
  });

  it('returns `—` for null / undefined / empty inputs', () => {
    expect(shortModelLabel(null)).toBe('—');
    expect(shortModelLabel(undefined)).toBe('—');
    expect(shortModelLabel('')).toBe('—');
  });
});

describe('formatAgentsCell', () => {
  const mkAgent = (sub: string, role: string, model?: string): AgentLiveState => ({
    sub_session_id: sub,
    role,
    status: 'running',
    tokens_in: 0,
    tokens_out: 0,
    cache_read: 0,
    cache_creation: 0,
    cost_usd: 0,
    elapsed_ms: 0,
    started_at: '2026-05-17T10:00:00Z',
    ...(model !== undefined ? { model } : {}),
  });

  it('returns `agents:0` for an empty map', () => {
    const out = formatAgentsCell(new Map());
    expect(out.display).toBe('agents:0');
    expect(out.fullList).toBe('');
    expect(out.truncated).toBe(false);
  });

  it('inlines a short agent list', () => {
    const map = new Map<string, AgentLiveState>([
      ['s1', mkAgent('s1', 'dev', 'claude-sonnet-4-6')],
    ]);
    const out = formatAgentsCell(map);
    expect(out.display).toBe('agents:1 [dev:sonnet-4-6]');
    expect(out.fullList).toBe('dev:sonnet-4-6');
    expect(out.truncated).toBe(false);
  });

  it('uses `—` for agents missing a model id', () => {
    const map = new Map<string, AgentLiveState>([['s1', mkAgent('s1', 'dev')]]);
    const out = formatAgentsCell(map);
    expect(out.display).toContain('dev:—');
    expect(out.truncated).toBe(false);
  });

  it('truncates to count when the inline list exceeds ~40 chars', () => {
    // 3 verbose-model agents → roughly 60 chars of `role:model |` joiner.
    const map = new Map<string, AgentLiveState>([
      ['s1', mkAgent('s1', 'orchestrator', 'claude-opus-4-7')],
      ['s2', mkAgent('s2', 'scout', 'claude-haiku-4-5-20251001')],
      ['s3', mkAgent('s3', 'dev', 'claude-sonnet-4-6')],
    ]);
    const out = formatAgentsCell(map);
    expect(out.display).toBe('agents:3');
    expect(out.fullList).toContain('orchestrator:opus-4-7');
    expect(out.fullList).toContain('scout:haiku-4-5-20251001');
    expect(out.fullList).toContain('dev:sonnet-4-6');
    expect(out.truncated).toBe(true);
  });
});

describe('formatContextEstimate', () => {
  it('renders both sides when known', () => {
    expect(formatContextEstimate(42_000, 200_000)).toBe('ctx ~42k/200k');
    expect(formatContextEstimate(0, 1_000_000)).toBe('ctx ~0k/1000k');
  });

  it('renders `ctx —/—` when both are unknown', () => {
    expect(formatContextEstimate(null, null)).toBe('ctx —/—');
    expect(formatContextEstimate(undefined, undefined)).toBe('ctx —/—');
  });

  it('renders `ctx ~Xk/—` when only the window is unknown', () => {
    expect(formatContextEstimate(42_000, null)).toBe('ctx ~42k/—');
  });

  it('renders `ctx —/Yk` when only the cumulative is unknown', () => {
    // The cumulative side is `null` only as a defensive case — in
    // practice App.tsx always passes a number (cost_summary sums to 0
    // pre-spawn). Still tested for robustness.
    expect(formatContextEstimate(null, 200_000)).toBe('ctx —/200k');
  });

  it('rounds DOWN to the nearest 1k on both sides', () => {
    expect(formatContextEstimate(42_999, 200_999)).toBe('ctx ~42k/200k');
  });

  it('treats NaN cumulative as unknown', () => {
    expect(formatContextEstimate(Number.NaN, 200_000)).toBe('ctx —/200k');
  });

  it('treats zero / negative window as unknown', () => {
    // Defensive — getContextWindow returns null for unknown models,
    // so 0 or negative is structurally impossible in practice. The
    // helper still maps them to `—` rather than printing `0k`.
    expect(formatContextEstimate(42_000, 0)).toBe('ctx ~42k/—');
    expect(formatContextEstimate(42_000, -1)).toBe('ctx ~42k/—');
  });
});
