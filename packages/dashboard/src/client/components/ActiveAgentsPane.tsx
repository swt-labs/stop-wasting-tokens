import type { AgentLiveState } from '@swt-labs/shared';
import { For, Show, createSignal, type Accessor, type Component } from 'solid-js';

export type CookControlAction = 'pause' | 'resume' | 'cancel';

const ROLE_ICON: Record<string, string> = {
  orchestrator: '◈',
  scout: '◇',
  lead: '◆',
  dev: '●',
  qa: '□',
  debugger: '▲',
  architect: '△',
  docs: '▽',
};

export interface ActiveAgentsPaneProps {
  agents: Accessor<Map<string, AgentLiveState>>;
  sessionId: Accessor<string | null>;
  /**
   * Injected for unit testing. Production callers fall back to `fetch`.
   */
  postControl?: (sessionId: string, action: CookControlAction) => Promise<unknown>;
}

const DEFAULT_POST_CONTROL = async (sessionId: string, action: CookControlAction): Promise<void> => {
  await fetch(`/api/cook/${sessionId}/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
};

export function roleIcon(role: string): string {
  return ROLE_ICON[role] ?? '·';
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0.0000';
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds - minutes * 60;
  return `${minutes}m${remSec.toString().padStart(2, '0')}s`;
}

export const ActiveAgentsPane: Component<ActiveAgentsPaneProps> = (props) => {
  const post = props.postControl ?? DEFAULT_POST_CONTROL;
  const [confirmingCancel, setConfirmingCancel] = createSignal(false);
  const [pending, setPending] = createSignal<CookControlAction | null>(null);

  const rows = (): AgentLiveState[] =>
    Array.from(props.agents().values()).sort((a, b) =>
      b.started_at.localeCompare(a.started_at),
    );

  const sendControl = async (action: CookControlAction): Promise<void> => {
    const sid = props.sessionId();
    if (!sid) return;
    setPending(action);
    try {
      await post(sid, action);
    } finally {
      setPending(null);
    }
  };

  return (
    <section class="panel active-agents-pane" aria-label="Active agents">
      <header class="active-agents-header">
        <h2 class="panel-header">Active agents</h2>
        <Show
          when={props.sessionId()}
          fallback={<span class="active-agents-idle">No active cook session</span>}
        >
          <div class="active-agents-controls">
            <span class="active-agents-session">
              session <code>{props.sessionId()!.slice(0, 8)}</code>
            </span>
            <button
              type="button"
              disabled={pending() !== null}
              onClick={() => void sendControl('pause')}
            >
              Pause
            </button>
            <button
              type="button"
              disabled={pending() !== null}
              onClick={() => void sendControl('resume')}
            >
              Resume
            </button>
            <Show
              when={confirmingCancel()}
              fallback={
                <button
                  type="button"
                  class="danger"
                  disabled={pending() !== null}
                  onClick={() => setConfirmingCancel(true)}
                >
                  Cancel
                </button>
              }
            >
              <span class="active-agents-confirm">
                Cancel cook?
                <button
                  type="button"
                  class="danger"
                  disabled={pending() !== null}
                  onClick={() => {
                    setConfirmingCancel(false);
                    void sendControl('cancel');
                  }}
                >
                  Yes, cancel
                </button>
                <button type="button" onClick={() => setConfirmingCancel(false)}>
                  Keep running
                </button>
              </span>
            </Show>
          </div>
        </Show>
      </header>
      <Show
        when={rows().length > 0}
        fallback={<p class="active-agents-empty">No active agents</p>}
      >
        <table class="active-agents-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Status</th>
              <th>Tool</th>
              <th>Tokens (in / out)</th>
              <th>Cost</th>
              <th>Elapsed</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(row) => (
                <tr class={`status-${row.status}`}>
                  <td>
                    <span class="active-agents-role-icon" aria-hidden="true">
                      {roleIcon(row.role)}
                    </span>
                    {row.role}
                  </td>
                  <td>{row.status}</td>
                  <td>
                    <Show when={row.current_tool} fallback={<span class="active-agents-dash">—</span>}>
                      <code title={row.current_tool_input_excerpt ?? undefined}>
                        {row.current_tool}
                      </code>
                    </Show>
                  </td>
                  <td>
                    {row.tokens_in.toLocaleString()} / {row.tokens_out.toLocaleString()}
                  </td>
                  <td>{formatCost(row.cost_usd)}</td>
                  <td>{formatElapsed(row.elapsed_ms)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
};
