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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AlreadyInitializedError, initProject } from '@swt-labs/core';
import { spawnAgent } from '@swt-labs/orchestration';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

import { SEED_IDEA_SENTINEL, stripFrontmatter, substitutePlaceholders } from './cook.js';

export interface InitHandlerDeps {
  readonly spawnAgentImpl?: typeof spawnAgent;
  readonly readFileSyncImpl?: typeof readFileSync;
  readonly initProjectImpl?: typeof initProject;
}

export function makeInitHandler(deps: InitHandlerDeps = {}): CommandHandler {
  const spawnAgentFn = deps.spawnAgentImpl ?? spawnAgent;
  const readFileSyncFn = deps.readFileSyncImpl ?? readFileSync;
  const initProjectFn = deps.initProjectImpl ?? initProject;

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

    io.stdout.write(`\n→ Spawning Lead to detect stack + suggest skills (commands/init.md)...\n`);
    try {
      const result = await spawnAgentFn({
        role: 'lead',
        prompt,
        cwd: io.cwd,
        sessionId,
        installRoot,
      });
      if (result.status === 'success' || result.status === 'partial') {
        io.stdout.write(
          `\n✓ Lead bootstrap complete.\nNext: run \`swt vibe\` to scope the first milestone.\n`,
        );
        return EXIT.SUCCESS;
      }
      io.stderr.write(`swt init: Lead spawn returned status="${result.status}".\n`);
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
