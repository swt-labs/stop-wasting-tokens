import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  advanceRemediationRound,
  getOrInitRemediationState,
  pad2,
  roundUatPath,
} from '@swt-labs/artifacts';

import { RoutingError } from '../errors.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export interface ReVerifyHandlerOptions {
  readonly resolveTarget?: (route: VibeRoute, io: ModeIO) =>
    | { phase: string; slug: string }
    | undefined;
  readonly planningDirName?: string;
  /** Severity used when initialising remediation state for the first time. */
  readonly severity?: 'critical' | 'major' | 'minor' | 'cosmetic';
}

export function reVerifyHandler(opts: ReVerifyHandlerOptions = {}): ModeHandler {
  return {
    kind: 're-verify',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      const target = (opts.resolveTarget ?? defaultResolveTarget)(route, io);
      if (target === undefined) {
        throw new RoutingError('re-verify handler requires a phase target', { route });
      }

      const planningDir = join(io.cwd, opts.planningDirName ?? '.swt-planning');
      const phaseDir = join(planningDir, 'phases', `${target.phase}-${target.slug}`);

      const uatPath = join(phaseDir, `${target.phase}-UAT.md`);
      const hadUat = await fileExists(uatPath);

      const initialState = await getOrInitRemediationState(phaseDir, opts.severity ?? 'major');

      if (hadUat) {
        const archiveTarget = roundUatPath(phaseDir, initialState);
        await mkdir(dirname(archiveTarget), { recursive: true });
        await rename(uatPath, archiveTarget);
        io.stdout.write(
          `✓ Re-verify — archived ${target.phase}-UAT.md → round-${pad2(initialState.round)}/${archiveTarget.split('/').pop()}\n`,
        );
        const next = await advanceRemediationRound(phaseDir);
        io.stdout.write(`◆ Re-verify — bumped remediation round to ${pad2(next.round)}\n`);
      } else {
        io.stdout.write(
          `◇ Re-verify — phase ${target.phase}: no prior UAT to archive (round still ${pad2(initialState.round)})\n`,
        );
      }

      return { route, exit: 0, ranTo: 'completion' };
    },
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

function defaultResolveTarget(
  route: VibeRoute,
  _io: ModeIO,
): { phase: string; slug: string } | undefined {
  if (route.phase === undefined || route.phase_slug === undefined) return undefined;
  const m = /^(\d{2})-(.+)$/.exec(route.phase_slug);
  if (m === null) return { phase: route.phase, slug: '' };
  return { phase: m[1] ?? route.phase, slug: m[2] ?? '' };
}
