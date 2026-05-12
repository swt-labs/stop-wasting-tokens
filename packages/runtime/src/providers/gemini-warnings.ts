/**
 * Gemini Terms-of-Service warning emitter per Plan 05-01 PR-40.
 *
 * Google's free Gemini API tier reserves the right to use prompts +
 * completions for model training unless the operator explicitly opts
 * out at the Google Cloud Console. The paid Vertex AI tier has
 * different terms but the same opt-out surface. SWT users who select
 * a Gemini model from `default-tiers.json` deserve to know what
 * they're consenting to before their PROJECT.md + REQUIREMENTS.md
 * artefacts go out the wire.
 *
 * This module exposes a single structured warning that the
 * methodology layer / CLI / dashboard surface to the operator before
 * the first Gemini dispatch. It's intentionally provider-only — the
 * companion Anthropic / OpenAI providers don't carry the same
 * training-default-on liability.
 *
 * Non-Gemini models return `null`. Gemini model detection is
 * conservative: any model ID starting with `gemini-` triggers the
 * warning. The TDD2 §13.5 `default-tiers.json` entries (`gemini-2.5-pro`,
 * `gemini-2.5-flash`) match this prefix.
 */

export interface GeminiTosWarning {
  /** Severity is always `'info'` — operators decide whether to proceed. */
  readonly severity: 'info';
  /** Operator-facing one-line summary. */
  readonly message: string;
  /** Google AI Studio Terms of Service URL. */
  readonly tos_url: string;
  /** Note about data retention behaviour on the free + paid tiers. */
  readonly data_retention_note: string;
  /** URL where operators can disable training-on-prompts in their account. */
  readonly training_opt_out_url: string;
}

const GEMINI_PREFIX = 'gemini-';

/**
 * Returns the structured Gemini ToS warning when the supplied model
 * ID is a Gemini-family model. Returns `null` for any other provider
 * / model — callers can compose `getGeminiTosWarning(model) ??
 * (other-provider warning) ?? null` without special-casing.
 */
export function getGeminiTosWarning(model: string): GeminiTosWarning | null {
  const normalized = model.toLowerCase().trim();
  if (!normalized.startsWith(GEMINI_PREFIX)) return null;
  return {
    severity: 'info',
    message:
      'Google Gemini API: free + paid tiers may use prompts for model training by default. Review the ToS and opt out before sending sensitive artefacts.',
    tos_url: 'https://ai.google.dev/terms',
    data_retention_note:
      'Free-tier prompts + completions are retained for model improvement by default. Vertex AI (paid) follows separate enterprise terms — see your contract.',
    training_opt_out_url: 'https://console.cloud.google.com/ai/generative-language/safety',
  };
}

/**
 * Convenience: check whether a model triggers any operator-facing
 * provider warning. Today only Gemini does; future providers with
 * similar default-on-training surfaces will register here.
 */
export function getProviderWarning(model: string): GeminiTosWarning | null {
  return getGeminiTosWarning(model);
}
