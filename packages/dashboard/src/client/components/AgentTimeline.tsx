import { For, Show, createMemo, type Component } from 'solid-js';

import type { SnapshotEvent } from '@swt-labs/shared';

const AGENT_COLOR: Record<string, string> = {
  scout: 'var(--neon-cyan)',
  architect: 'var(--neon-cyan)',
  lead: 'var(--terminal-green)',
  dev: 'var(--terminal-green)',
  qa: 'var(--terminal-green)',
  debugger: 'var(--warm-amber)',
};

interface AgentRow {
  id: string;
  agent: string;
  phase: string;
  plan: string | null;
  status: 'running' | 'complete';
  ts: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  duration_ms?: number;
  artifact?: string | null;
}

function eventsToRows(events: readonly unknown[]): AgentRow[] {
  // recent_events is z.unknown() in the schema (see Snapshot); we narrow to the
  // SnapshotEvent shape opportunistically and skip anything else.
  const rows: AgentRow[] = [];
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const evt = raw as Partial<SnapshotEvent>;
    if (evt.type === 'agent.spawn') {
      rows.push({
        id: `${evt.ts}-${evt.agent}-${evt.phase}-spawn`,
        agent: evt.agent ?? 'unknown',
        phase: evt.phase ?? '??',
        plan: evt.plan ?? null,
        status: 'running',
        ts: evt.ts ?? '',
      });
    } else if (evt.type === 'agent.complete') {
      rows.push({
        id: `${evt.ts}-${evt.agent}-${evt.phase}-complete`,
        agent: evt.agent ?? 'unknown',
        phase: evt.phase ?? '??',
        plan: evt.plan ?? null,
        status: 'complete',
        ts: evt.ts ?? '',
        tokens_in: evt.tokens_in,
        tokens_out: evt.tokens_out,
        cost_usd: evt.cost_usd,
        duration_ms: evt.duration_ms,
        artifact: evt.artifact ?? null,
      });
    }
  }
  // Newest first
  return rows.reverse();
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined) return '—';
  return `$${cost.toFixed(4)}`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export interface AgentTimelineProps {
  events: readonly unknown[];
}

export const AgentTimeline: Component<AgentTimelineProps> = (props) => {
  const rows = createMemo(() => eventsToRows(props.events));
  return (
    <section class="panel agent-timeline" aria-label="Agent Timeline">
      <h2 class="panel-header">Agents</h2>
      <Show
        when={rows().length > 0}
        fallback={
          <div class="preview-panel-empty">
            No agent activity yet. The agents will appear here once you start a vibe session from
            the command bar.
          </div>
        }
      >
        <ul class="agent-timeline-list" aria-live="polite">
          <For each={rows()}>
            {(row) => (
              <li class="agent-timeline-item" data-status={row.status}>
                <div class="agent-timeline-head">
                  <span
                    class="agent-timeline-role"
                    style={{ color: AGENT_COLOR[row.agent] ?? 'var(--ghost-white)' }}
                  >
                    {row.agent}
                  </span>
                  <span class="agent-timeline-status-pill" data-status={row.status}>
                    {row.status === 'running' ? '◯ running' : '✓ complete'}
                  </span>
                </div>
                <div class="agent-timeline-meta">
                  <span>phase {row.phase}</span>
                  <Show when={row.plan}>
                    <span class="topbar-sep">·</span>
                    <span>{row.plan}</span>
                  </Show>
                </div>
                <Show when={row.status === 'complete'}>
                  <div class="agent-timeline-stats">
                    <span>tokens: {(row.tokens_in ?? 0) + (row.tokens_out ?? 0)}</span>
                    <span>cost: {formatCost(row.cost_usd)}</span>
                    <span>took: {formatDuration(row.duration_ms)}</span>
                  </div>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
};
