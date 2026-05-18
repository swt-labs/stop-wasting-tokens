/**
 * `swt research` — Plan 03-03 Task T3: secondary verb handler.
 *
 * Spawns a single Scout agent via `spawnAgent({role: 'scout', ...})` after
 * loading the `commands/research.md` body (frontmatter stripped). Replaces
 * the v3.0.0-alpha.3 stub that returned EXIT.NOT_IMPLEMENTED (REQ-25).
 *
 * The Scout role is read-only by default (sandbox 'read-only' per
 * spawn-agent.ts:150); it produces research notes that the orchestrator
 * later folds into a phase RESEARCH.md.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { spawnAgent } from '@swt-labs/orchestration';
import { resolveInstallRoot, resolveSessionId } from '@swt-labs/runtime';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

import { SEED_IDEA_SENTINEL, stripFrontmatter, substitutePlaceholders } from './cook.js';

export interface ResearchHandlerDeps {
  readonly spawnAgentImpl?: typeof spawnAgent;
  readonly readFileSyncImpl?: typeof readFileSync;
}

export function makeResearchHandler(deps: ResearchHandlerDeps = {}): CommandHandler {
  const spawnAgentFn = deps.spawnAgentImpl ?? spawnAgent;
  const readFileSyncFn = deps.readFileSyncImpl ?? readFileSync;

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

    // 1. Topic must be a non-empty positional joined string.
    const topic = parsed.positionals.join(' ').trim();
    if (topic === '') {
      io.stderr.write('Usage: swt research <topic>\n');
      return EXIT.USAGE_ERROR;
    }

    // 2. Load + strip frontmatter from commands/research.md.
    let body: string;
    try {
      const raw = readFileSyncFn(resolve(installRoot, 'commands', 'research.md'), 'utf8');
      body = stripFrontmatter(typeof raw === 'string' ? raw : String(raw));
    } catch (err) {
      io.stderr.write(
        `swt research: failed to load commands/research.md: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }

    // 3. Substitute placeholders. ${SWT_TOPIC} carries the user's topic.
    const prompt = substitutePlaceholders(body, installRoot, topic, SEED_IDEA_SENTINEL)
      .replace(/\$\{SWT_TOPIC\}/g, topic)
      .replace(/\$ARGUMENTS/g, topic);

    // 4. Spawn the Scout session.
    try {
      const result = await spawnAgentFn({
        role: 'scout',
        prompt,
        cwd: io.cwd,
        sessionId,
        installRoot,
      });
      if (result.status === 'success' || result.status === 'partial') {
        return EXIT.SUCCESS;
      }
      io.stderr.write(`swt research: agent returned status="${result.status}".\n`);
      return EXIT.RUNTIME_ERROR;
    } catch (err) {
      io.stderr.write(
        `swt research: spawn failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }
  };
}

/**
 * Default researchHandler — production-wired. Tests use
 * `makeResearchHandler({...})` with injected deps.
 */
export const researchHandler: CommandHandler = makeResearchHandler();
