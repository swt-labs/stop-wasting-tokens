/**
 * `swt map` — Plan 03-03 Task T4: 4-way parallel Scout fan-out.
 *
 * Unlike the other secondary verbs, `swt map` spawns 4 Scouts IN PARALLEL
 * via `Promise.all([spawnAgent('scout',...) × 4])` per TDD3 §4 + research
 * §2 ("Map is a special case", REQ-04: DAG-based parallel execution).
 *
 * Each of the 4 Scouts gets a different "slice" of the codebase to map:
 *
 *   - Slice 1 (Tech Stack):    .swt-planning/codebase/STACK.md, DEPENDENCIES.md
 *   - Slice 2 (Architecture):  .swt-planning/codebase/ARCHITECTURE.md, STRUCTURE.md
 *   - Slice 3 (Quality):       .swt-planning/codebase/CONVENTIONS.md, TESTING.md
 *   - Slice 4 (Concerns):      .swt-planning/codebase/CONCERNS.md
 *
 * The slice descriptors mirror commands/map.md "Step 3-quad" (lines 154-157
 * at landing). Each scout writes its domain files directly via its
 * <output_paths>; no shared journal is needed.
 *
 * Failure semantics: if ANY of the 4 Scouts returns TaskResult.status ==='failed'
 * (or rejects), the handler returns EXIT.OPERATION_FAILED. Other 3 Scouts
 * still get to finish — Promise.all rejects on the first rejection, but
 * because we wrap each spawn in a try/catch that maps thrown errors to a
 * "failed" result, all 4 Promises always resolve.
 *
 * REQ-04 (DAG-based parallel execution) — assertion: exactly 4 concurrent
 * spawns. The map test uses a deferred mock that records call-order
 * (start) AND completion separately to prove all 4 are in-flight before
 * the first one resolves.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { spawnAgent } from '@swt-labs/orchestration';
import { resolveInstallRoot, resolveSessionId } from '@swt-labs/runtime';
import type { TaskResult } from '@swt-labs/shared';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

import { SEED_IDEA_SENTINEL, stripFrontmatter, substitutePlaceholders } from './cook.js';

interface MapSlice {
  /** Short numeric id 1..4 used in logs + the prompt. */
  readonly id: 1 | 2 | 3 | 4;
  /** Human-readable slice title. */
  readonly title: string;
  /** Output paths the Scout writes to. */
  readonly outputPaths: ReadonlyArray<string>;
}

export const MAP_SLICES: ReadonlyArray<MapSlice> = [
  {
    id: 1,
    title: 'Tech Stack',
    outputPaths: ['.swt-planning/codebase/STACK.md', '.swt-planning/codebase/DEPENDENCIES.md'],
  },
  {
    id: 2,
    title: 'Architecture',
    outputPaths: ['.swt-planning/codebase/ARCHITECTURE.md', '.swt-planning/codebase/STRUCTURE.md'],
  },
  {
    id: 3,
    title: 'Quality',
    outputPaths: ['.swt-planning/codebase/CONVENTIONS.md', '.swt-planning/codebase/TESTING.md'],
  },
  {
    id: 4,
    title: 'Concerns',
    outputPaths: ['.swt-planning/codebase/CONCERNS.md'],
  },
];

/**
 * Build the per-slice prompt by appending a structured slice-descriptor
 * trailer to the shared commands/map.md body. The Scout's first turn
 * reads the trailer to know which files to write.
 */
export function buildSlicePrompt(body: string, slice: MapSlice): string {
  const trailer: string[] = ['', '---', '', `## Map Slice ${slice.id}: ${slice.title}`, ''];
  trailer.push(`Output paths (write directly to these):`);
  for (const p of slice.outputPaths) trailer.push(`  - ${p}`);
  trailer.push('');
  return `${body}\n${trailer.join('\n')}\n`;
}

export interface MapHandlerDeps {
  readonly spawnAgentImpl?: typeof spawnAgent;
  readonly readFileSyncImpl?: typeof readFileSync;
}

export function makeMapHandler(deps: MapHandlerDeps = {}): CommandHandler {
  const spawnAgentFn = deps.spawnAgentImpl ?? spawnAgent;
  const readFileSyncFn = deps.readFileSyncImpl ?? readFileSync;

  return async (_parsed, io: CommandIO): Promise<ExitCode> => {
    let installRoot: string;
    let baseSessionId: string;
    try {
      installRoot = resolveInstallRoot();
      baseSessionId = resolveSessionId();
    } catch (err) {
      io.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return EXIT.RUNTIME_ERROR;
    }

    // 1. Load + strip frontmatter from commands/map.md (once — shared body).
    let body: string;
    try {
      const raw = readFileSyncFn(resolve(installRoot, 'commands', 'map.md'), 'utf8');
      body = stripFrontmatter(typeof raw === 'string' ? raw : String(raw));
    } catch (err) {
      io.stderr.write(
        `swt map: failed to load commands/map.md: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }
    body = substitutePlaceholders(body, installRoot, '', SEED_IDEA_SENTINEL);

    // 2. Spawn all 4 Scouts in parallel via Promise.all. Wrap each call so
    //    one rejection doesn't short-circuit the rest — we always want to
    //    record the outcome of every scout for diagnostics, then surface
    //    aggregate failure.
    const spawnOne = async (slice: MapSlice): Promise<TaskResult | Error> => {
      const slicePrompt = buildSlicePrompt(body, slice);
      try {
        return await spawnAgentFn({
          role: 'scout',
          prompt: slicePrompt,
          cwd: io.cwd,
          // Use a per-slice session id so transcripts don't collide.
          sessionId: `${baseSessionId}-slice-${slice.id}`,
          installRoot,
        });
      } catch (err) {
        return err instanceof Error ? err : new Error(String(err));
      }
    };

    const results = await Promise.all(MAP_SLICES.map(spawnOne));

    // 3. Aggregate. Any error or non-success status => failure exit.
    let failed = 0;
    results.forEach((result, idx) => {
      const slice = MAP_SLICES[idx]!;
      if (result instanceof Error) {
        io.stderr.write(`swt map: slice ${slice.id} (${slice.title}) threw: ${result.message}\n`);
        failed += 1;
        return;
      }
      if (result.status !== 'success' && result.status !== 'partial') {
        io.stderr.write(
          `swt map: slice ${slice.id} (${slice.title}) returned status="${result.status}".\n`,
        );
        failed += 1;
      }
    });

    if (failed > 0) {
      io.stderr.write(`swt map: ${failed}/${MAP_SLICES.length} scout slice(s) failed.\n`);
      return EXIT.RUNTIME_ERROR;
    }
    io.stdout.write(`✓ swt map: all ${MAP_SLICES.length} scout slices succeeded.\n`);
    return EXIT.SUCCESS;
  };
}

/**
 * Default mapHandler — production-wired. Tests use `makeMapHandler({...})`
 * with injected deps.
 */
export const mapHandler: CommandHandler = makeMapHandler();
