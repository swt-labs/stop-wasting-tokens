/**
 * Milestone 21 Phase 01 — SWT ↔ pi-ai OAuth provider-id mapping.
 *
 * Pi-ai's OAuth registry (`@earendil-works/pi-ai/oauth`) keys providers by
 * the id pi-ai's per-provider implementation declares — for the OpenAI
 * Codex CLI flow that id diverges from SWT's user-facing canonical
 * `"openai"` id (the table below is the single source of truth for the
 * exact pi-ai id).
 *
 * SWT's user-facing canonical provider id is
 * `"openai"` everywhere else: ProviderMenu dropdown, `provider_overlays/`
 * paths, `quirks.json` keys, the `extractors/openai.ts` usage extractor,
 * the `swt:openai:*` keychain namespace, and the `auth.openai` block in
 * `.swt-planning/config.json`.
 *
 * Without a mapping the dashboard route's up-front
 * `getOAuthProvider(provider)` undefined-check (provider-auth-oauth.ts:208)
 * 400s on every `{provider: 'openai'}` OAuth start attempt — Phase 02's UI
 * work is dead-on-arrival. This helper is the single point of integration
 * at the route boundary; the SWT-side `"openai"` canonical id flows
 * unchanged through every other layer (events, keychain, config, UI).
 *
 * Today the table has ONE entry. Identity-fallback handles every other
 * provider (Anthropic, github-copilot, unknown providers) — pi-ai's
 * `getOAuthProvider(mappedId) === undefined` check at the route remains
 * the SOLE rejection path for truly-unsupported providers.
 *
 * Future maintainers: extend `SWT_TO_PI_OAUTH_PROVIDER_ID` if another
 * provider's pi-ai id diverges from SWT's canonical id. Do NOT
 * special-case via control flow in `mapToOAuthProviderId` — the table is
 * the source of truth.
 */

/**
 * Map from SWT user-facing provider id → pi-ai OAuth registry id.
 *
 * Only entries where the two ids diverge are listed; identity is the
 * default.
 */
export const SWT_TO_PI_OAUTH_PROVIDER_ID: Readonly<Record<string, string>> = Object.freeze({
  openai: 'openai-codex',
});

/**
 * Map a SWT user-facing provider id to the id pi-ai's OAuth registry
 * uses. Returns the input verbatim for any provider that does not need
 * mapping (Anthropic, github-copilot, unknown). Never throws.
 */
export function mapToOAuthProviderId(swtProviderId: string): string {
  return SWT_TO_PI_OAUTH_PROVIDER_ID[swtProviderId] ?? swtProviderId;
}
