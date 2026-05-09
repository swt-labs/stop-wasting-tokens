import { Show, createMemo, createSignal, type Component } from 'solid-js';

import type { Backend, MilestoneSummary, ProjectSummary } from '@swt-labs/dashboard-core';

import type { ConnectionState } from '../state/dashboard-store.js';

export interface TopBarProps {
  project: ProjectSummary | null;
  milestone: MilestoneSummary | null;
  connection: ConnectionState;
  commandSubmitting: boolean;
  onCommand: (input: string) => Promise<unknown>;
}

const PILL_LABEL: Record<ConnectionState, string> = {
  connecting: '◇ CONNECTING',
  connected: '◯ CONNECTED',
  error: '✗ DISCONNECTED',
};

const BACKEND_LABEL: Record<Backend, string> = {
  codex: 'codex',
  'claude-code': 'claude-code',
  ollama: 'ollama',
};

// Mirrors packages/dashboard/src/server/lib/allowed-verbs.ts. Kept in sync by
// hand because the SPA bundle ships separately from the dashboard server bundle
// per tsup.config.ts; a runtime import would couple the build graphs.
const ALLOWLIST = new Set(['help', 'version', 'status', 'doctor', 'detect-phase', 'update']);
const INTERACTIVE = new Set(['vibe', 'watch', 'dashboard']);

type VerbStatus = 'empty' | 'literal' | 'interactive' | 'unknown';

function classifyInput(input: string): VerbStatus {
  const trimmed = input.trim();
  if (trimmed.length === 0) return 'empty';
  const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (ALLOWLIST.has(firstToken)) return 'literal';
  if (INTERACTIVE.has(firstToken)) return 'interactive';
  return 'unknown';
}

export const TopBar: Component<TopBarProps> = (props) => {
  const [input, setInput] = createSignal('');
  const status = createMemo<VerbStatus>(() => classifyInput(input()));

  const onSubmit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const value = input().trim();
    if (value.length === 0) return;
    setInput('');
    await props.onCommand(value);
  };

  return (
    <header class="topbar" role="banner">
      <h1 class="topbar-brand">
        <span class="topbar-brand-mark">swt</span>
        <span class="topbar-brand-cursor">_</span>
      </h1>
      <form class="topbar-cmd" onSubmit={(e) => void onSubmit(e)} aria-label="Run swt command">
        <span class="topbar-cmd-prompt">$</span>
        <input
          type="text"
          class="topbar-cmd-input"
          placeholder="status / doctor / help / detect-phase / version / update …"
          autocomplete="off"
          spellcheck={false}
          disabled={props.commandSubmitting}
          value={input()}
          onInput={(e) => setInput((e.currentTarget as HTMLInputElement).value)}
        />
        <Show when={status() === 'unknown'}>
          <span class="topbar-cmd-hint" data-hint="unknown" role="status">
            ↪ Try: status, doctor, help, detect-phase, version, update
          </span>
        </Show>
        <Show when={status() === 'interactive'}>
          <span class="topbar-cmd-hint" data-hint="interactive" role="status">
            ↪ Interactive — run from your terminal
          </span>
        </Show>
      </form>
      <Show when={props.project && props.milestone} fallback={<div class="topbar-status">…</div>}>
        <div class="topbar-status">
          <span>{props.project?.name}</span>
          <span class="topbar-sep">·</span>
          <span>{props.milestone?.name}</span>
          <span class="topbar-sep">·</span>
          <span>
            phase {props.milestone?.phase_index} of {props.milestone?.phase_count}
          </span>
        </div>
      </Show>
      <div class="topbar-controls">
        <Show when={props.project}>
          <span class="topbar-pill">backend: {BACKEND_LABEL[props.project!.backend]}</span>
        </Show>
        <span class="connection-pill" data-state={props.connection}>
          {PILL_LABEL[props.connection]}
        </span>
      </div>
    </header>
  );
};
