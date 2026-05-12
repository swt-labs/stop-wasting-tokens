import type { DetectPhaseReport } from '@swt-labs/shared';
import { Show, type Component } from 'solid-js';

export interface DetectPhasePanelProps {
  data: DetectPhaseReport | null;
  loading: boolean;
  error: string | null;
  lastFetched: string | null;
  onRefresh: () => void;
}

/**
 * The handful of fields we actually surface in the panel. Mirrors the
 * fields the CLI's `swt detect-phase --json` shows in the terminal —
 * not every field on the full PhaseDetectResult, just the routing-
 * relevant ones the human needs to see at a glance.
 */
interface DisplayResult {
  phase_count?: number;
  next_phase?: string;
  next_phase_slug?: string;
  next_phase_state?: string;
  qa_status?: string;
  qa_attention_status?: string;
  uat_issues_count?: number;
  next_phase_plans?: number;
  next_phase_summaries?: number;
}

function asDisplay(result: unknown): DisplayResult {
  if (typeof result !== 'object' || result === null) return {};
  return result;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export const DetectPhasePanel: Component<DetectPhasePanelProps> = (props) => {
  const display = (): DisplayResult => asDisplay(props.data?.result);

  return (
    <section class="panel tools-panel detect-phase-panel" aria-label="Phase detection">
      <header class="tools-panel-header">
        <h2 class="panel-header">Phase</h2>
        <button
          type="button"
          class="tools-refresh-btn"
          aria-label="Refresh phase detection"
          disabled={props.loading}
          onClick={props.onRefresh}
        >
          ↻
        </button>
      </header>
      <p class="tools-panel-meta">{formatRelative(props.lastFetched)}</p>
      <Show when={props.error}>
        <p class="tools-panel-error">⚠ {props.error}</p>
      </Show>
      <Show
        when={props.data?.is_initialized}
        fallback={
          <Show when={props.data} fallback={<p class="tools-panel-empty">Loading…</p>}>
            <p class="tools-panel-empty">Run init first.</p>
          </Show>
        }
      >
        <div class="detect-phase-body">
          <div class="detect-phase-headline">
            <span class="detect-phase-pos">Phase {display().next_phase ?? '—'}</span>
            <span class="detect-phase-state">{display().next_phase_state ?? 'unknown'}</span>
          </div>
          <Show when={display().next_phase_slug}>
            <p class="detect-phase-slug">{display().next_phase_slug}</p>
          </Show>
          <ul class="detect-phase-stats">
            <li>
              <span class="detect-phase-stat-label">phases</span>
              <span class="detect-phase-stat-value">{display().phase_count ?? 0}</span>
            </li>
            <li>
              <span class="detect-phase-stat-label">plans</span>
              <span class="detect-phase-stat-value">{display().next_phase_plans ?? 0}</span>
            </li>
            <li>
              <span class="detect-phase-stat-label">summaries</span>
              <span class="detect-phase-stat-value">{display().next_phase_summaries ?? 0}</span>
            </li>
          </ul>
          <div class="detect-phase-chips">
            <Show when={display().qa_status && display().qa_status !== 'none'}>
              <span
                class={`detect-phase-chip detect-phase-chip-qa-${display().qa_status ?? 'none'}`}
              >
                QA: {display().qa_status}
              </span>
            </Show>
            <Show when={display().qa_attention_status && display().qa_attention_status !== 'none'}>
              <span class="detect-phase-chip detect-phase-chip-attention">
                QA attention: {display().qa_attention_status}
              </span>
            </Show>
            <Show when={(display().uat_issues_count ?? 0) > 0}>
              <span class="detect-phase-chip detect-phase-chip-uat">
                UAT issues: {display().uat_issues_count}
              </span>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
};
