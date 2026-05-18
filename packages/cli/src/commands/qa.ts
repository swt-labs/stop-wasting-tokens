/**
 * `swt qa` — Plan 03-03 Task T1: secondary verb handler.
 *
 * Spawns a single QA agent via `spawnAgent({role: 'qa', ...})` after loading
 * the `commands/qa.md` body (with YAML frontmatter stripped). Replaces the
 * v3.0.0-alpha.3 stub that returned EXIT.NOT_IMPLEMENTED (REQ-25).
 *
 * The orchestrator-only `swt_ask_user` invariant is preserved by spawnAgent
 * itself — its `role === 'orchestrator'` guard rejects orchestrator spawns,
 * and its `customTools[]` derivation never includes `swt_ask_user` for
 * non-orchestrator roles (see packages/orchestration/src/spawn-agent.ts:312
 * and the CRITICAL comment block in that file).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { detectPhase } from '@swt-labs/methodology';
import { spawnAgent } from '@swt-labs/orchestration';
import { resolveInstallRoot, resolveSessionId } from '@swt-labs/runtime';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

import { SEED_IDEA_SENTINEL, stripFrontmatter, substitutePlaceholders } from './cook.js';

/**
 * Dependency-injection seam for tests.
 */
export interface QaHandlerDeps {
  readonly spawnAgentImpl?: typeof spawnAgent;
  readonly readFileSyncImpl?: typeof readFileSync;
  readonly detectPhaseImpl?: typeof detectPhase;
}

export function makeQaHandler(deps: QaHandlerDeps = {}): CommandHandler {
  const spawnAgentFn = deps.spawnAgentImpl ?? spawnAgent;
  const readFileSyncFn = deps.readFileSyncImpl ?? readFileSync;
  const detectPhaseFn = deps.detectPhaseImpl ?? detectPhase;

  return async (parsed, io: CommandIO): Promise<ExitCode> => {
    let installRoot: string;
    let sessionId: string;
    try {
      installRoot = resolveInstallRoot();
      sessionId = resolveSessionId();
    } catch (err) {
      io.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return EXIT.RUNTIME_ERROR;
    }

    // 1. Resolve phase target: explicit positional first, then detectPhase().
    let phaseTarget = parsed.positionals[0];
    if (phaseTarget === undefined || phaseTarget.trim() === '') {
      try {
        const state = await detectPhaseFn({ cwd: io.cwd });
        phaseTarget = state.next_phase ?? '';
      } catch {
        phaseTarget = '';
      }
    }

    // 2. Load + strip frontmatter from commands/qa.md.
    let body: string;
    try {
      const raw = readFileSyncFn(resolve(installRoot, 'commands', 'qa.md'), 'utf8');
      body = stripFrontmatter(typeof raw === 'string' ? raw : String(raw));
    } catch (err) {
      io.stderr.write(
        `swt qa: failed to load commands/qa.md: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }

    // 3. Substitute placeholders. ${SWT_PHASE_TARGET} carries the resolved
    //    phase id (or empty string if none); the LLM body can branch on it.
    const prompt = substitutePlaceholders(
      body,
      installRoot,
      phaseTarget ?? '',
      SEED_IDEA_SENTINEL,
    ).replace(/\$\{SWT_PHASE_TARGET\}/g, phaseTarget ?? '');

    // 4. Spawn the QA session. spawnAgent guards against role==='orchestrator'.
    try {
      const result = await spawnAgentFn({
        role: 'qa',
        prompt,
        cwd: io.cwd,
        sessionId,
        installRoot,
      });
      if (result.status === 'success' || result.status === 'partial') {
        return EXIT.SUCCESS;
      }
      io.stderr.write(`swt qa: agent returned status="${result.status}".\n`);
      return EXIT.RUNTIME_ERROR;
    } catch (err) {
      io.stderr.write(
        `swt qa: spawn failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }
  };
}

/**
 * Default qaHandler — production-wired. Tests use `makeQaHandler({...})`
 * with injected deps.
 */
export const qaHandler: CommandHandler = makeQaHandler();
