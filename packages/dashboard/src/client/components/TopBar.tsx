import { Show, createSignal, type Component } from 'solid-js';

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

export const TopBar: Component<TopBarProps> = (props) => {
  const [input, setInput] = createSignal('');

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
          placeholder="status / doctor / help / detect-phase / vibe …"
          autocomplete="off"
          spellcheck={false}
          disabled={props.commandSubmitting}
          value={input()}
          onInput={(e) => setInput((e.currentTarget as HTMLInputElement).value)}
        />
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
