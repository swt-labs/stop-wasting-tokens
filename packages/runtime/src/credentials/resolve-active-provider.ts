/**
 * `resolveActiveProvider` — alpha.37. The runtime-layer (L2) resolver for
 * "which provider should this session spawn against?". Reads
 * `.swt-planning/config.json` ONCE and returns BOTH the auth-config block
 * (for `resolveSpawnCredential`) AND the active-provider id, considering
 * the pinned `providers.strategy.provider` FIRST and falling back to the
 * first authed entry in the auth block when the strategy is unpinned.
 *
 * Why this exists (alpha.37 chat-route fix):
 *
 *   `readProjectAuthConfig` only exposes the auth-block slice. The chat
 *   route (`packages/dashboard/src/server/routes/chat.ts`) used
 *   `Object.keys(authConfig)[0]` to pick the active provider — which
 *   silently ignored the TopBar Provider dropdown's pin (which writes to
 *   `config.providers.strategy.provider`). End result: a user who OAuth'd
 *   Anthropic THEN added an OpenRouter API key saw the dropdown say
 *   "openrouter" but every chat turn ran against Anthropic (because
 *   `anthropic` was first in JSON insertion order). On a fresh project
 *   where only OpenRouter was configured the inverse happened — chat ran
 *   against OpenRouter as expected, but without `config.model` forwarding
 *   (session.ts alpha.37 fix) Pi sent a malformed request and OpenRouter
 *   returned `401 User not found`. Both halves are addressed by sourcing
 *   the active provider from `providers.strategy` (the same place the
 *   dropdown writes + the statusline reads).
 *
 * Resolution order (matches the dashboard snapshot resolver +
 * `buildSnapshot`'s alpha.36 fallback chain):
 *
 *   1. `config.providers.strategy.kind === 'pinned'` AND `.provider` is
 *      a non-empty string AND that provider appears in `config.auth`
 *      → return that provider (source='pinned').
 *   2. `config.auth` has at least one entry → return the FIRST key
 *      (source='first-authed').
 *   3. Neither → `provider: null` (source='none').
 *
 * Like `readProjectAuthConfig`, this NEVER throws — missing file /
 * unreadable file / malformed JSON all degrade to the empty selection
 * (`{provider: null, authConfig: {}, source: 'none'}`).
 */

import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { DEFAULT_AUTH_CONFIG, parseAuthConfig, type AuthConfig } from './auth-config.js';

export type ActiveProviderSource = 'pinned' | 'first-authed' | 'none';

export interface ActiveProviderSelection {
  /** The provider id to spawn against, or `null` when nothing is configured. */
  provider: string | null;
  /** The parsed `auth` block — pass to `resolveSpawnCredential(provider, authConfig)`. */
  authConfig: AuthConfig;
  /** The model id from `config.model` (top-level), or `null`. */
  model: string | null;
  /** How `provider` was chosen — for breadcrumb/debug surfaces. */
  source: ActiveProviderSource;
}

const EMPTY_SELECTION: ActiveProviderSelection = {
  provider: null,
  authConfig: DEFAULT_AUTH_CONFIG,
  model: null,
  source: 'none',
};

export function resolveActiveProvider(
  projectRoot: string,
  fsImpl: {
    readFileSync: typeof nodeReadFileSync;
    existsSync: typeof nodeExistsSync;
  } = {
    readFileSync: nodeReadFileSync,
    existsSync: nodeExistsSync,
  },
): ActiveProviderSelection {
  const configPath = resolvePath(projectRoot, '.swt-planning', 'config.json');
  if (!fsImpl.existsSync(configPath)) return EMPTY_SELECTION;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fsImpl.readFileSync(configPath, 'utf8'));
  } catch {
    return EMPTY_SELECTION;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_SELECTION;
  const root = parsed as Record<string, unknown>;

  const authConfig = parseAuthConfig(root['auth']);
  const model =
    typeof root['model'] === 'string' && root['model'].length > 0 ? root['model'] : null;

  // 1. Pinned strategy wins when it points at a provider with an auth entry.
  const providers = root['providers'];
  if (typeof providers === 'object' && providers !== null) {
    const strategy = (providers as { strategy?: unknown }).strategy;
    if (typeof strategy === 'object' && strategy !== null) {
      const kind = (strategy as { kind?: unknown }).kind;
      const pinned = (strategy as { provider?: unknown }).provider;
      if (
        kind === 'pinned' &&
        typeof pinned === 'string' &&
        pinned.length > 0 &&
        authConfig[pinned] !== undefined
      ) {
        return { provider: pinned, authConfig, model, source: 'pinned' };
      }
    }
  }

  // 2. First authed entry — falls back to JSON insertion order, matches
  //    pre-alpha.37 chat-route behaviour for the unpinned case.
  const authKeys = Object.keys(authConfig);
  if (authKeys.length > 0) {
    return { provider: authKeys[0]!, authConfig, model, source: 'first-authed' };
  }

  // 3. Nothing configured.
  return { ...EMPTY_SELECTION, authConfig, model };
}
