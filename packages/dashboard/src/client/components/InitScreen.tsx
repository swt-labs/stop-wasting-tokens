import { PROVIDER_VOCABULARY } from '@swt-labs/shared';
import { For, Show, createSignal, type Component, type JSX } from 'solid-js';

import type { InitBody, ProviderAuthUpdateBody } from '../services/api.js';

import { isOAuthProvider, type PanelAuthMode } from './ProviderAuthPanel.js';

export interface InitScreenProps {
  submitting: boolean;
  /**
   * True when the daemon detected source files in cwd but no
   * `.swt-planning/` — the user is dropping SWT into an existing project.
   * Drives the headline + step copy + CTA wording.
   */
  brownfield: boolean;
  onInit: (body: InitBody) => Promise<void>;
  /**
   * Persist an API-key provider selection AFTER init has scaffolded
   * `.swt-planning/`. Wraps the dashboard-store's `applyProviderAuthUpdate`
   * — the same save path the "Provider ▾" dropdown's panel uses (key →
   * keychain + `auth` block → config). Optional: when omitted the
   * InitScreen's provider section is hidden entirely (it has nothing to
   * persist into).
   */
  onProviderApiKeySave?: (
    body: ProviderAuthUpdateBody,
  ) => Promise<{ ok: true } | { error: string }>;
  /**
   * Kick off an OAuth login for the chosen provider AFTER init. Wraps the
   * dashboard-store's `startOAuthFlow`. Optional alongside
   * `onProviderApiKeySave` — both are passed together or not at all.
   */
  onProviderOAuthStart?: (provider: string) => Promise<{ ok: true } | { error: string }>;
}

interface Step {
  title: string;
  body: string;
}

const GREENFIELD_STEPS: ReadonlyArray<Step> = [
  {
    title: 'Name your project',
    body: 'Pick a slug — anything kebab-case works. SWT scaffolds .swt-planning/ next to where you ran the dashboard.',
  },
  {
    title: 'Describe what you want',
    body: 'Once initialized, type your idea in the command bar above. The agent will ask follow-up questions if anything is unclear.',
  },
  {
    title: 'Review and ship',
    body: 'Watch agents work in the timeline on the right. Files appear in your project. Commit when it looks good.',
  },
];

const BROWNFIELD_STEPS: ReadonlyArray<Step> = [
  {
    title: 'Name the existing project',
    body: 'We see you have a codebase here already. Pick a slug for SWT to use — your existing files stay untouched.',
  },
  {
    title: 'Describe what you want changed',
    body: 'Once initialized, type your goal in the command bar above. The agent maps your codebase first, then plans the change.',
  },
  {
    title: 'Review and ship',
    body: 'Watch agents work in the timeline on the right. Diffs land in your project. Commit when it looks good.',
  },
];

/* ── Provider-section pure helpers (node-env testable) ──────────────────
 * The dashboard workspace has no Solid testing-library; vitest runs
 * `environment: 'node'`. The provider section's load-bearing logic — the
 * optional/skip gate and the init→persist sequencing decision — is factored
 * into these DOM-free pure helpers, unit-tested directly. Mirrors the
 * `options-menu.test.ts` / `provider-auth-panel.test.ts` constraint.
 */

/** The shape of the InitScreen's provider-section form state. */
export interface ProviderSelection {
  /** The selected provider id (always one of `PROVIDER_VOCABULARY`). */
  provider: string;
  /** The chosen auth mode. */
  mode: PanelAuthMode;
  /** The raw (untrimmed) API-key input — only meaningful when `mode==='api_key'`. */
  apiKey: string;
}

/**
 * Whether the user has engaged the provider section enough to warrant a
 * persist after init. The section is OPTIONAL + SKIPPABLE: leaving it
 * untouched (or clearing the key) means init runs name-and-description-only,
 * exactly as it did before this section existed.
 *
 * - `api_key` mode: needs a non-empty (trimmed) key — an empty key is a skip.
 * - `oauth` mode: needs a provider that actually has a pi-ai OAuth
 *   subsystem; selecting `oauth` for a provider with none is treated as a
 *   skip (the radio would be disabled anyway, but the guard is belt-and-
 *   suspenders for the headless persist path).
 */
export function hasProviderSelection(sel: ProviderSelection): boolean {
  if (sel.mode === 'api_key') return sel.apiKey.trim().length > 0;
  return isOAuthProvider(sel.provider);
}

/** The init→persist sequencing decision: what to do once `onInit` resolves. */
export type ProviderPersistPlan =
  | { kind: 'skip' }
  | { kind: 'api_key'; body: ProviderAuthUpdateBody }
  | { kind: 'oauth'; provider: string };

/**
 * Decide what provider-persist step (if any) should run AFTER a SUCCESSFUL
 * init. Pure — the InitScreen calls this only on the init-succeeded path, so
 * this helper assumes init is done; the init-FAILED case is handled by the
 * caller never invoking it (see `submit` below). When the section was left
 * untouched / skipped, returns `{kind:'skip'}` and the caller persists
 * nothing — behaviour is exactly today's name+description init.
 */
export function planProviderPersist(sel: ProviderSelection): ProviderPersistPlan {
  if (!hasProviderSelection(sel)) return { kind: 'skip' };
  if (sel.mode === 'oauth') return { kind: 'oauth', provider: sel.provider };
  return {
    kind: 'api_key',
    body: { provider: sel.provider, authMode: 'api_key', apiKey: sel.apiKey.trim() },
  };
}

export const InitScreen: Component<InitScreenProps> = (props) => {
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  // Provider-section form state. `provider` defaults to the first vocabulary
  // entry; `mode` to api_key; `apiKey` empty (an empty key === skip).
  const [provider, setProvider] = createSignal<string>(PROVIDER_VOCABULARY[0]);
  const [authMode, setAuthMode] = createSignal<PanelAuthMode>('api_key');
  const [apiKey, setApiKey] = createSignal('');

  // True only when App.tsx wired the provider persist callbacks — without
  // them the section has nowhere to persist into, so it is hidden.
  const providerSectionEnabled = (): boolean =>
    props.onProviderApiKeySave !== undefined && props.onProviderOAuthStart !== undefined;

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    // Belt-and-suspenders against double-fire on rapid clicks. The button is
    // also disabled via props.submitting, but the form itself can still
    // submit on Enter when focus is in the textarea, so guard here too.
    if (props.submitting) return;
    const trimmedName = name().trim();
    if (trimmedName.length === 0) {
      setError('Project name is required.');
      return;
    }
    setError(null);
    const trimmedDesc = description().trim();

    // Init MUST land first — the `/api/provider-auth` route + the `auth`
    // config block both need `.swt-planning/` to exist. If init throws, the
    // catch surfaces the error and we NEVER attempt the provider persist.
    try {
      await props.onInit({
        name: trimmedName,
        ...(trimmedDesc.length > 0 ? { description: trimmedDesc } : {}),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return;
    }

    // Init succeeded. Now — and only now — persist the provider choice, if
    // the user filled the (optional) section in. A skip leaves init as
    // name+description-only, exactly as before.
    if (!providerSectionEnabled()) return;
    const plan = planProviderPersist({
      provider: provider(),
      mode: authMode(),
      apiKey: apiKey(),
    });
    if (plan.kind === 'skip') return;
    if (plan.kind === 'api_key') {
      const result = await props.onProviderApiKeySave!(plan.body);
      // A provider-persist failure is non-fatal: the project IS initialized.
      // Surface the error inline so the user can retry from the Provider ▾
      // menu — but do not roll back the init.
      if ('error' in result) {
        setError(`Project created, but saving the API key failed: ${result.error}`);
      }
      return;
    }
    // OAuth: kick the flow off. The auth-URL / code-paste UI lives in the
    // Provider ▾ dropdown's panel — once init flips the app out of the
    // InitScreen, that panel renders the in-progress flow.
    const result = await props.onProviderOAuthStart!(plan.provider);
    if ('error' in result) {
      setError(`Project created, but starting the OAuth login failed: ${result.error}`);
    }
  };

  const headline = (): string =>
    props.brownfield ? 'Set up SWT around your existing project' : 'Welcome to SWT';

  const lede = (): string =>
    props.brownfield
      ? 'No .swt-planning/ here yet — but plenty of code. SWT will scaffold its planning artifacts alongside your existing files. Nothing in your project changes until an agent makes an explicit edit you approve.'
      : 'No .swt-planning/ here yet. Name your project to scaffold one. SWT runs the methodology loop while you describe what you want in plain English.';

  const steps = (): ReadonlyArray<Step> => (props.brownfield ? BROWNFIELD_STEPS : GREENFIELD_STEPS);

  const submitLabel = (): string =>
    props.brownfield
      ? props.submitting
        ? '◆ Initializing…'
        : '✓ Initialize SWT for this codebase'
      : props.submitting
        ? '◆ Initializing…'
        : '✓ Initialize SWT project';

  return (
    <div
      class="init-screen"
      data-variant={props.brownfield ? 'brownfield' : 'greenfield'}
      role="dialog"
      aria-label="Initialize SWT project"
    >
      <div class="init-card init-card-split">
        <aside class="init-explainer">
          <h1 class="init-title">
            <span class="topbar-brand-mark">swt</span>
            <span class="topbar-brand-cursor">_</span>
          </h1>
          <p class="init-headline">{headline()}</p>
          <ol class="init-steps">
            {steps().map((step, idx) => (
              <li class="init-step">
                <div class="init-step-number">{idx + 1}</div>
                <div class="init-step-content">
                  <div class="init-step-title">{step.title}</div>
                  <div class="init-step-body">{step.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </aside>

        <form class="init-form" onSubmit={(e) => void submit(e)}>
          <p class="init-lede">{lede()}</p>

          <label class="init-field">
            <span>Project name</span>
            <input
              type="text"
              class="init-input"
              placeholder={props.brownfield ? 'my-existing-project' : 'my-swt-project'}
              autocomplete="off"
              spellcheck={false}
              disabled={props.submitting}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              autofocus
            />
          </label>

          <label class="init-field">
            <span>Description (optional)</span>
            <textarea
              class="init-textarea"
              placeholder="One or two sentences about what this project does."
              disabled={props.submitting}
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
            />
          </label>

          {/* The OPTIONAL provider/auth section — only shown when App.tsx
              wired the persist callbacks. Leaving it untouched is a skip:
              init runs name+description-only, exactly as before. */}
          <Show when={providerSectionEnabled()}>
            <div class="init-provider-section">
              <div class="init-provider-heading">
                <span>
                  Provider <span class="init-provider-optional">— optional</span>
                </span>
              </div>

              <label class="init-field">
                <span>Provider</span>
                <select
                  class="init-input"
                  value={provider()}
                  disabled={props.submitting}
                  onChange={(e): void => {
                    const next = e.currentTarget.value;
                    setProvider(next);
                    // If the new provider has no pi-ai OAuth subsystem, fall
                    // back to api_key so the section never sits in oauth mode
                    // for a provider that cannot do OAuth.
                    if (authMode() === 'oauth' && !isOAuthProvider(next)) {
                      setAuthMode('api_key');
                    }
                  }}
                >
                  <For each={PROVIDER_VOCABULARY}>
                    {(p): JSX.Element => <option value={p}>{p}</option>}
                  </For>
                </select>
              </label>

              <div class="init-field">
                <span>Auth mode</span>
                <div class="init-provider-radio-group" role="radiogroup" aria-label="Auth mode">
                  <label class="init-provider-radio">
                    <input
                      type="radio"
                      name="init-provider-auth-mode"
                      value="api_key"
                      checked={authMode() === 'api_key'}
                      disabled={props.submitting}
                      onChange={(): void => setAuthMode('api_key')}
                    />
                    API key
                  </label>
                  <label class="init-provider-radio">
                    <input
                      type="radio"
                      name="init-provider-auth-mode"
                      value="oauth"
                      checked={authMode() === 'oauth'}
                      disabled={props.submitting || !isOAuthProvider(provider())}
                      onChange={(): void => setAuthMode('oauth')}
                    />
                    OAuth
                  </label>
                </div>
              </div>

              <Show when={authMode() === 'api_key'}>
                <label class="init-field">
                  <span>API key</span>
                  <input
                    type="password"
                    class="init-input"
                    autocomplete="off"
                    placeholder="sk-... (leave blank to set up later)"
                    disabled={props.submitting}
                    value={apiKey()}
                    onInput={(e) => setApiKey(e.currentTarget.value)}
                  />
                </label>
              </Show>

              <p class="init-provider-skip-hint">
                Skip this — you can set it up any time from the <code>Provider ▾</code> menu in the
                top bar.
              </p>
            </div>
          </Show>

          <Show when={error()}>
            <p class="init-error">{error()}</p>
          </Show>

          <div class="init-actions">
            <button type="submit" class="init-submit" disabled={props.submitting}>
              {submitLabel()}
            </button>
          </div>

          <p class="init-fineprint">
            Creates <code>.swt-planning/PROJECT.md</code>, <code>.swt-planning/STATE.md</code>, and
            an empty <code>phases/</code> dir. The dashboard reconnects automatically.
          </p>
        </form>
      </div>
    </div>
  );
};
