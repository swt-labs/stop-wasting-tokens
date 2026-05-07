import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  advanceRemediationRound,
  getOrInitRemediationState,
  pad2,
  roundUatPath,
} from '@swt-labs/artifacts';

import {
  resolveUatRemediationRoundLimit,
  type MaxUatRemediationRoundsConfig,
} from '../../qa/round-cap.js';
import { RoutingError } from '../errors.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export interface ReVerifyHandlerOptions {
  readonly resolveTarget?: (
    route: VibeRoute,
    io: ModeIO,
  ) => { phase: string; slug: string } | undefined;
  readonly planningDirName?: string;
  readonly severity?: 'critical' | 'major' | 'minor' | 'cosmetic';
  /** Override max_uat_remediation_rounds resolution (default: read from config.json). */
  readonly resolveMaxRounds?: (cwd: string) => Promise<MaxUatRemediationRoundsConfig>;
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

      const initialState = await getOrInitRemediationState(phaseDir, opts.severity ?? 'major');

      const maxRounds = await (opts.resolveMaxRounds ?? defaultResolveMaxRounds)(planningDir);
      const decision = resolveUatRemediationRoundLimit({
        maxRounds,
        currentRound: initialState.round,
      });

      if (decision.capReached) {
        io.stdout.write(
          [
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            `  Reached maximum UAT remediation rounds (${decision.maxRounds}).`,
            '  Review issues manually or adjust max_uat_remediation_rounds',
            '  in config.json.',
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            '',
          ].join('\n'),
        );
        return { route, exit: 0, ranTo: 'completion' };
      }

      const uatPath = join(phaseDir, `${target.phase}-UAT.md`);
      const hadUat = await fileExists(uatPath);

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

async function defaultResolveMaxRounds(
  planningDir: string,
): Promise<MaxUatRemediationRoundsConfig> {
  try {
    const raw = await readFile(join(planningDir, 'config.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      max_uat_remediation_rounds?: MaxUatRemediationRoundsConfig;
    };
    return parsed.max_uat_remediation_rounds;
  } catch {
    return false;
  }
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
