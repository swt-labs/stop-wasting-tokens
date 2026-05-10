import { Show, type Component } from 'solid-js';

export interface OnboardingOverlayProps {
  visible: boolean;
  onDismiss: () => void;
}

const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Describe what you want',
    body: 'Type your idea in the command bar at the top — anything from "build me a snake game" to "fix the failing test in payments.ts."',
  },
  {
    title: 'Answer the agent’s questions',
    body: 'When the agent needs more info, it’ll ask in the log panel. Pick from options or type a free-form reply. Permission decisions (running shell commands, writing outside the project) get amber prompts you can approve or deny.',
  },
  {
    title: 'Review and ship',
    body: 'Watch agents do the work in the timeline on the right. Files appear in your project. When everything looks good, commit and ship.',
  },
];

export const OnboardingOverlay: Component<OnboardingOverlayProps> = (props) => {
  return (
    <Show when={props.visible}>
      <div class="onboarding-overlay" role="dialog" aria-labelledby="onboarding-title">
        <div class="onboarding-card">
          <h2 id="onboarding-title" class="onboarding-title">
            Welcome to SWT
          </h2>
          <p class="onboarding-intro">
            SWT runs the methodology loop in the background while you describe what you want in
            plain English. Three steps:
          </p>
          <ol class="onboarding-steps">
            {STEPS.map((step, idx) => (
              <li class="onboarding-step">
                <div class="onboarding-step-number">{idx + 1}</div>
                <div class="onboarding-step-content">
                  <div class="onboarding-step-title">{step.title}</div>
                  <div class="onboarding-step-body">{step.body}</div>
                </div>
              </li>
            ))}
          </ol>
          <div class="onboarding-actions">
            <button type="button" class="onboarding-dismiss-btn" onClick={() => props.onDismiss()}>
              Got it — let&rsquo;s build
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
