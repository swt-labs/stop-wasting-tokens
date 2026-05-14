import type { MilestoneSummary, ProjectSummary } from '@swt-labs/shared';
import { For, Show, type Component } from 'solid-js';

export interface ProjectStatePanelProps {
  project: ProjectSummary | null;
  milestone: MilestoneSummary | null;
}

/** Exported for unit testing — see `project-state-panel-helpers.test.ts`. */
export function percentLabel(milestone: MilestoneSummary): string {
  const pct = milestone.percent_complete;
  if (pct === undefined) return '';
  return `${Math.round(pct * 100)}%`;
}

export const ProjectStatePanel: Component<ProjectStatePanelProps> = (props) => {
  return (
    <section class="panel project-state-panel" aria-label="Project state">
      <h2 class="panel-header">Project</h2>
      <Show
        when={props.project}
        fallback={<div class="project-state-empty">No project initialised.</div>}
      >
        <div class="project-state-name">{props.project!.name}</div>
        <Show when={props.project!.description}>
          <p class="project-state-description">{props.project!.description}</p>
        </Show>
        <Show when={props.project!.codebase_profile}>
          <ul class="project-state-codebase">
            <Show when={props.project!.codebase_profile!.stack}>
              <li>
                <span class="label">Stack</span>
                <span class="value">{props.project!.codebase_profile!.stack}</span>
              </li>
            </Show>
            <Show
              when={
                props.project!.codebase_profile!.languages &&
                props.project!.codebase_profile!.languages.length > 0
              }
            >
              <li>
                <span class="label">Languages</span>
                <span class="value">{props.project!.codebase_profile!.languages!.join(', ')}</span>
              </li>
            </Show>
            <Show when={props.project!.codebase_profile!.loc !== undefined}>
              <li>
                <span class="label">LOC</span>
                <span class="value">{props.project!.codebase_profile!.loc!.toLocaleString()}</span>
              </li>
            </Show>
          </ul>
        </Show>
      </Show>
      <Show when={props.milestone}>
        <div class="project-state-milestone">
          <div class="milestone-name">{props.milestone!.name}</div>
          <div class="milestone-progress">
            <span>
              phase {props.milestone!.phase_index} / {props.milestone!.phase_count}
            </span>
            <Show when={props.milestone!.percent_complete !== undefined}>
              <span class="milestone-percent">{percentLabel(props.milestone!)}</span>
            </Show>
          </div>
        </div>
        <Show when={props.milestone!.todos && props.milestone!.todos.length > 0}>
          <details class="project-state-todos">
            <summary>Todos ({props.milestone!.todos!.length})</summary>
            <ul>
              <For each={props.milestone!.todos}>
                {(todo) => (
                  <li>
                    {todo.text}
                    <Show when={todo.phase}>
                      <span class="todo-phase">[{todo.phase}]</span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </details>
        </Show>
        <Show when={props.milestone!.blockers && props.milestone!.blockers.length > 0}>
          <details class="project-state-blockers" open>
            <summary>Blockers ({props.milestone!.blockers!.length})</summary>
            <ul>
              <For each={props.milestone!.blockers}>
                {(blocker) => (
                  <li>
                    {blocker.text}
                    <Show when={blocker.phase}>
                      <span class="todo-phase">[{blocker.phase}]</span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </details>
        </Show>
      </Show>
    </section>
  );
};
