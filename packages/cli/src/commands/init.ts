/**
 * `swt init` — Plan 03-03 Task T5 (Phase 3): chains the existing scaffold
 * step with a new Lead spawn loading `commands/init.md`.
 *
 * Pre-Plan 03-03 `swt init` did the bootstrap (write PROJECT.md / STATE.md /
 * phases/) and stopped. TDD3 §4 specifies the contract has three steps:
 *   1. Bootstrap `.swt-planning/` (still handled by `initProject`)
 *   2. Detect project stack (CC-era responsibility of commands/init.md)
 *   3. Suggest installable skills (also commands/init.md)
 *
 * Plan 03-03 T5 wires step 2+3 by spawning a Lead session that consumes
 * commands/init.md. The Lead writes its findings to the scaffolded planning
 * directory (e.g., PROJECT.md augmentation, STATE.md notes).
 *
 * The `--skip-lead` flag is the documented escape-hatch for CI smoke tests
 * and snapshot fixtures that have no LLM available. Without it, init's
 * exit-status now depends on the Lead spawn's TaskResult (REQ-13: fresh
 * Pi sessions per task).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AlreadyInitializedError, initProject } from '@swt-labs/core';
import { spawnAgent } from '@swt-labs/orchestration';
import {
  resolveCredentialStore,
  resolveSpawnCredential,
  type AuthConfig,
  type AuthMode,
} from '@swt-labs/runtime';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

import {
  SEED_IDEA_SENTINEL,
  augmentSpawnError,
  loadCookConfig,
  stripFrontmatter,
  substitutePlaceholders,
} from './cook.js';

export interface InitHandlerDeps {
  readonly spawnAgentImpl?: typeof spawnAgent;
  readonly readFileSyncImpl?: typeof readFileSync;
  readonly initProjectImpl?: typeof initProject;
  /**
   * alpha.20 — test seam for the global-credential discovery path. Defaults
   * to live `resolveCredentialStore().list()`. Tests inject `undefined` to
   * exercise the "no global creds, degrade gracefully" branch and the
   * `{ provider, authMode }` shape to drive the inheritance branch without
   * touching the host keychain.
   */
  readonly discoverGlobalCredentialImpl?: () => Promise<
    { provider: string; authMode: AuthMode } | undefined
  >;
  /**
   * alpha.20 — test seam for the keychain-inheritance auth-config persister.
   * Defaults to a synchronous read-modify-write of `.swt-planning/config.json`
   * mirroring `provider-auth-oauth.ts:writeAuthConfig`'s shape (sans the
   * async/mkdir branches: the dashboard route has already scaffolded the
   * dir + initial config.json before this subprocess fires).
   */
  readonly persistAuthConfigImpl?: (
    configPath: string,
    provider: string,
    authMode: AuthMode,
  ) => boolean;
}

/**
 * alpha.20 — preference order when multiple providers have credentials in
 * the keychain. Anthropic first (the project's primary Claude-Code-replacement
 * use case), OpenAI second, Gemini third, then any other provider as fallback.
 * The order matches the upstream-prompt-audit baseline focus (Codex + Claude
 * Agent SDK) so init defaults align with the milestones we audit against.
 */
const PREFERRED_PROVIDER_ORDER = ['anthropic', 'openai', 'gemini'] as const;

async function defaultDiscoverGlobalCredential(): Promise<
  { provider: string; authMode: AuthMode } | undefined
> {
  try {
    const { store } = await resolveCredentialStore();
    const refs = await store.list();
    if (refs.length === 0) return undefined;
    for (const preferred of PREFERRED_PROVIDER_ORDER) {
      const hit = refs.find((r) => r.provider === preferred);
      if (hit !== undefined) return { provider: hit.provider, authMode: hit.authMode };
    }
    const first = refs[0];
    return first !== undefined ? { provider: first.provider, authMode: first.authMode } : undefined;
  } catch {
    // Graceful degrade — keychain probe / list errors must never crash init.
    // The Lead will spawn without a credential, and Pi surfaces a clear auth
    // error that the dashboard now renders (see Bug B fix in routes/init.ts).
    return undefined;
  }
}

function defaultPersistAuthConfig(
  configPath: string,
  provider: string,
  authMode: AuthMode,
): boolean {
  try {
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf8');
        const parsed: unknown = JSON.parse(typeof raw === 'string' ? raw : String(raw));
        if (typeof parsed === 'object' && parsed !== null) {
          config = { ...(parsed as Record<string, unknown>) };
        }
      } catch {
        // Malformed JSON — overwrite rather than crash. The dashboard route
        // already wrote a valid config.json before this subprocess fired, so
        // a parse miss here is genuinely unexpected; preserving structure
        // matters less than getting auth wired.
      }
    }
    const prevAuth =
      typeof config['auth'] === 'object' && config['auth'] !== null
        ? (config['auth'] as Record<string, unknown>)
        : {};
    config['auth'] = {
      ...prevAuth,
      // Mirrors `provider-auth-oauth.ts:writeAuthConfig` exactly — same
      // `swt:<provider>:<mode>` credentialRef NAME convention. ONLY the
      // name is persisted; the secret stays in the keychain.
      [provider]: { mode: authMode, credentialRef: `swt:${provider}:${authMode}` },
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function makeInitHandler(deps: InitHandlerDeps = {}): CommandHandler {
  const spawnAgentFn = deps.spawnAgentImpl ?? spawnAgent;
  const readFileSyncFn = deps.readFileSyncImpl ?? readFileSync;
  const initProjectFn = deps.initProjectImpl ?? initProject;
  const discoverGlobalCredentialFn =
    deps.discoverGlobalCredentialImpl ?? defaultDiscoverGlobalCredential;
  const persistAuthConfigFn = deps.persistAuthConfigImpl ?? defaultPersistAuthConfig;

  return async (parsed, io: CommandIO): Promise<ExitCode> => {
    // ── Step 1: bootstrap (unchanged from pre-Plan-03-03 behaviour). ──
    const name = parsed.positionals[0];
    if (name === undefined || name.trim().length === 0) {
      io.stderr.write(
        'Usage: swt init <name> [--description "..."] [--skip-lead] [--skip-scaffold]\n',
      );
      return EXIT.USAGE_ERROR;
    }
    const flagDescription = parsed.flags.description;
    const positionalDescription = parsed.positionals[1];
    const description =
      typeof flagDescription === 'string' && flagDescription.length > 0
        ? flagDescription
        : positionalDescription;
    const skipScaffold = parsed.flags['skip-scaffold'] === true;

    // alpha.15 — `--skip-scaffold` is the dashboard's Phase-02 contract: the
    // route already scaffolded `.swt-planning/` synchronously before spawning
    // this subprocess, so re-invoking `initProject()` would crash on
    // `AlreadyInitializedError`. Skip step 1 and go straight to the Lead.
    let scaffoldRoot: string;
    if (skipScaffold) {
      scaffoldRoot = io.cwd;
      io.stdout.write(`[--skip-scaffold] Skipping scaffold; cwd=${io.cwd}.\n`);
    } else {
      try {
        const result = initProjectFn({
          cwd: io.cwd,
          name: name.trim(),
          ...(description !== undefined && description.length > 0 ? { description } : {}),
        });
        scaffoldRoot = result.root;
        io.stdout.write(`✓ Initialized .swt-planning/ at ${result.root}\n`);
        for (const file of result.files) {
          io.stdout.write(`  • ${file}\n`);
        }
      } catch (err: unknown) {
        if (err instanceof AlreadyInitializedError) {
          io.stderr.write(
            `swt init: .swt-planning/ already exists at ${io.cwd}. Run \`swt vibe\` to continue, or remove the dir to re-initialize.\n`,
          );
          return EXIT.USAGE_ERROR;
        }
        const message = err instanceof Error ? err.message : String(err);
        io.stderr.write(`swt init: failed to scaffold .swt-planning/: ${message}\n`);
        return EXIT.RUNTIME_ERROR;
      }
    }

    // ── Step 2: skip-lead escape-hatch for CI / smoke / snapshot tests. ──
    if (parsed.flags['skip-lead'] === true) {
      io.stdout.write(
        `\n[--skip-lead] Skipping commands/init.md Lead spawn (scaffold-only).\n` +
          `Next: run \`swt vibe\` to scope the first milestone.\n`,
      );
      return EXIT.SUCCESS;
    }

    // ── Step 3: Lead spawn loading commands/init.md. ──
    const installRoot = process.env['SWT_INSTALL_ROOT'] ?? process.cwd();
    const sessionId =
      process.env['SWT_SESSION_ID'] ??
      `init-${Math.random().toString(16).slice(2, 10)}-${Date.now().toString(16)}`;

    let body: string;
    try {
      const raw = readFileSyncFn(resolve(installRoot, 'commands', 'init.md'), 'utf8');
      body = stripFrontmatter(typeof raw === 'string' ? raw : String(raw));
    } catch (err) {
      io.stderr.write(
        `swt init: scaffold complete, but failed to load commands/init.md for Lead spawn: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      io.stderr.write(
        `(Use --skip-lead to bypass the Lead step. The scaffold at ${scaffoldRoot} is intact.)\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }

    const prompt = substitutePlaceholders(body, installRoot, '', SEED_IDEA_SENTINEL).replace(
      /\$\{SWT_PROJECT_NAME\}/g,
      name.trim(),
    );

    // alpha.19 — resolve the configured provider's credential from the project's
    // `.swt-planning/config.json` + keychain BEFORE spawning the Lead. Pre-alpha.19
    // init.ts spawned the Lead with no `provider`/`resolvedCredential`, which made
    // session.ts fall through to Pi's own `auth.json`/env-var resolution. That
    // worked when the user had `ANTHROPIC_API_KEY` in env or `~/.pi/agent/auth.json`,
    // but broke for OAuth-only users (credentials live in SWT's keychain). Mirrors
    // the `resolveSpawnCredential` pattern in cook.ts:2915 — first configured
    // provider wins (most projects declare one). Graceful degrade on miss: spawn
    // with no credential, let Pi surface a clear auth error.
    //
    // alpha.20 — when the project has no `auth` block (brand-new scaffold, the
    // user reached this through the dashboard's greenfield Init flow), fall
    // back to the global keychain index to discover credentials saved by a
    // prior project or a global `swt login`. If found, persist the auth block
    // into THIS project's config.json so subsequent cook runs work without
    // re-OAuth (Bug A — credential inheritance). The dashboard route ALREADY
    // scaffolded `.swt-planning/config.json` before spawning this subprocess
    // (Phase 02-01 contract), so the file always exists at this point.
    const cookConfig = loadCookConfig(io.cwd, { readFileSync: readFileSyncFn, existsSync });
    let effectiveAuth: AuthConfig = cookConfig.auth;
    let configuredProvider = Object.keys(effectiveAuth)[0];

    if (configuredProvider === undefined) {
      const discovered = await discoverGlobalCredentialFn();
      if (discovered !== undefined) {
        const configPath = resolve(io.cwd, '.swt-planning', 'config.json');
        const persisted = persistAuthConfigFn(configPath, discovered.provider, discovered.authMode);
        if (persisted) {
          io.stdout.write(
            `→ Inherited ${discovered.provider}:${discovered.authMode} credential from keychain — wrote auth block to .swt-planning/config.json.\n`,
          );
        } else {
          // Persist failed (FS error?). Still use the discovered credential
          // for this Lead spawn — the user can re-run later or set up via
          // the dashboard's Provider menu.
          io.stdout.write(
            `→ Inherited ${discovered.provider}:${discovered.authMode} credential from keychain (config write failed; using for this spawn only).\n`,
          );
        }
        // alpha.22 — Anthropic OAuth billing-pool advisory. Surface a one-
        // line note when the inherited credential is `anthropic:oauth` so
        // the user has a heads-up BEFORE the Lead spawn (which would
        // otherwise fail with the augmented "out of extra usage" error
        // from cook.ts:augmentSpawnError). Symmetric with the dashboard
        // Provider menu's same advisory.
        if (discovered.provider === 'anthropic' && discovered.authMode === 'oauth') {
          io.stdout.write(
            `  Note: Anthropic OAuth currently routes third-party requests to a separate billing pool.\n` +
              `  If you hit "out of extra usage" against your Max plan, switch to an API key via the\n` +
              `  Provider menu (pending Anthropic allowlist approval for SWT's OAuth client_id).\n`,
          );
        }
        // Build an in-memory auth config so `resolveSpawnCredential` sees the
        // inherited entry regardless of whether the persist write succeeded.
        // The shape is byte-identical to what `parseAuthConfig` would emit
        // for the same input — `mode` + the explicit `swt:<p>:<m>` ref.
        effectiveAuth = {
          ...effectiveAuth,
          [discovered.provider]: {
            mode: discovered.authMode,
            credentialRef: `swt:${discovered.provider}:${discovered.authMode}`,
          },
        };
        configuredProvider = discovered.provider;
      }
    }

    let resolvedAuth:
      | { provider: string; resolvedCredential: { authMode: 'api_key' | 'oauth'; secret: string } }
      | undefined;
    if (configuredProvider !== undefined) {
      resolvedAuth = await resolveSpawnCredential(configuredProvider, effectiveAuth);
    }

    io.stdout.write(`\n→ Spawning Lead to detect stack + suggest skills (commands/init.md)...\n`);
    try {
      const result = await spawnAgentFn({
        role: 'lead',
        prompt,
        cwd: io.cwd,
        sessionId,
        installRoot,
        ...(resolvedAuth !== undefined
          ? {
              provider: resolvedAuth.provider,
              resolvedCredential: resolvedAuth.resolvedCredential,
            }
          : {}),
      });
      if (result.status === 'success' || result.status === 'partial') {
        io.stdout.write(
          `\n✓ Lead bootstrap complete.\nNext: run \`swt vibe\` to scope the first milestone.\n`,
        );
        return EXIT.SUCCESS;
      }
      // alpha.19 — surface the underlying error from result.summary. The
      // milestone-10 dispatcher fix populates this with the (500-char-
      // truncated) message from a thrown session.prompt(). Without
      // surfacing it here, the dashboard's Log panel only shows "Lead
      // spawn returned status=failed" with zero context — same anti-
      // pattern as the milestone-08 git stderr leak.
      //
      // alpha.22 — augmentSpawnError prepends actionable SWT-specific
      // context for known upstream-failure patterns (today: Anthropic Max-
      // plan OAuth third-party billing pool). Symmetric with cook.ts's
      // error path so both surfaces render identical failures.
      const augmented = augmentSpawnError(result.summary);
      const detail = augmented.length > 0 ? `\n\n${augmented}` : '';
      io.stderr.write(`swt init: Lead spawn returned status="${result.status}".${detail}\n`);
      return EXIT.RUNTIME_ERROR;
    } catch (err) {
      io.stderr.write(
        `swt init: Lead spawn failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }
  };
}

/**
 * Default initHandler — production-wired. Tests use `makeInitHandler({...})`
 * with injected deps.
 */
export const initHandler: CommandHandler = makeInitHandler();
