/**
 * Plan 03-02 (milestone 12, Phase 03) T1 — `chat-panel-helpers` coverage.
 *
 * The dashboard workspace has no Solid testing-library installed and the
 * vitest config runs `environment: 'node'` with an esbuild transform that
 * cannot emit Solid-compatible JSX runtime calls (see options-menu.test.ts
 * and settings-section.test.ts for the same constraint). To keep this
 * plan's test deliverable shippable without a workspace dep bump, the
 * panel's load-bearing logic — class-name selection, usage badge, tool
 * annotation, clear-button gating — is factored into PURE exported helpers
 * (chat-panel-helpers.ts) and unit-tested directly here.
 *
 * Pure-helper precedent matches Plan 01-01 T4 (OptionsMenu). The panel
 * component itself (P02) is import-only smoke-tested implicitly via
 * typecheck — full render coverage waits on a jsdom dep bump (Phase 04 +).
 */

import { describe, expect, it } from 'vitest';

import {
  buildToolAnnotation,
  chatMsgClass,
  formatUsage,
  shouldDisableClear,
} from '../src/client/components/chat-panel-helpers.js';

describe('chatMsgClass', () => {
  it('returns the user class pair for a user message', () => {
    expect(chatMsgClass('user')).toBe('chat-msg chat-msg-user');
  });

  it('returns the assistant class pair for an assistant message', () => {
    expect(chatMsgClass('assistant')).toBe('chat-msg chat-msg-assistant');
  });
});

describe('formatUsage', () => {
  it('renders the up/down arrow badge for a non-zero turn', () => {
    expect(formatUsage({ input: 123, output: 456 })).toBe('↑123 ↓456');
  });

  it('renders the badge even when both counts are zero (defensive)', () => {
    // `chat.token_usage` is emitted once per turn regardless of cache state,
    // and a zero-input / zero-output payload IS valid for a fully-cached
    // turn. The badge still renders rather than collapsing to empty so the
    // user sees the turn completed accounting (just at zero cost).
    expect(formatUsage({ input: 0, output: 0 })).toBe('↑0 ↓0');
  });
});

describe('buildToolAnnotation', () => {
  it('wraps the tool name in the bracketed [tool: name] convention', () => {
    expect(buildToolAnnotation('read_file')).toBe('[tool: read_file]');
  });
});

describe('shouldDisableClear', () => {
  it('disables the clear button while a turn is streaming', () => {
    expect(shouldDisableClear({ streaming: true })).toBe(true);
  });

  it('enables the clear button when no turn is in-flight', () => {
    expect(shouldDisableClear({ streaming: false })).toBe(false);
  });
});
