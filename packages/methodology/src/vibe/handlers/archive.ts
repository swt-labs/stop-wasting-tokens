import { join } from 'node:path';

import { archiveMilestone, deriveMilestoneSlug } from '@swt-labs/artifacts';

import { runArchiveAudit, type AuditResult } from '../../audit/audit.js';
import { runStateConsistencyCheck } from '../../audit/state-consistency.js';
import { runArchiveUatGuard } from '../../audit/uat-guard.js';
import { RoutingError } from '../errors.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

export interface ArchiveHandlerOptions {
  readonly planningDirName?: string;
  readonly skipAudit?: boolean;
  readonly force?: boolean;
  readonly today?: () => string;
  /** Override slug derivation for tests. */
  readonly resolveSlug?: (planningDir: string) => Promise<string>;
}

export interface ArchiveHandlerResult extends HandlerResult {
  readonly milestoneDir?: string;
  readonly slug?: string;
  readonly audit?: AuditResult;
}

export function archiveHandler(opts: ArchiveHandlerOptions = {}): ModeHandler {
  return {
    kind: 'archive',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      const planningDir = join(io.cwd, opts.planningDirName ?? '.swt-planning');

      const uatGate = await runArchiveUatGuard({ planningDir });
      if (uatGate.status === 'fail') {
        for (const f of uatGate.failures) io.stderr.write(`✗ UAT gate: ${f}\n`);
        io.stderr.write('Archive blocked: unresolved UAT issues.\n');
        return { route, exit: 2, ranTo: 'completion', message: 'uat_gate_failed' };
      }

      const stateGate = await runStateConsistencyCheck({ planningDir });
      if (!stateGate.ok) {
        for (const f of stateGate.failures) io.stderr.write(`✗ State consistency: ${f}\n`);
        io.stderr.write('Archive blocked: state consistency drift.\n');
        return { route, exit: 2, ranTo: 'completion', message: 'state_consistency_failed' };
      }

      const audit = await runArchiveAudit({
        planningDir,
        skipNonUatChecks: opts.skipAudit === true,
      });
      if (audit.status === 'fail' && opts.force !== true) {
        for (const c of audit.checks) {
          if (c.status === 'fail') {
            io.stderr.write(`✗ ${c.id}: ${c.title}\n`);
            for (const d of c.details) io.stderr.write(`    ${d}\n`);
          }
        }
        io.stderr.write('Archive blocked: audit failed.\n');
        return { route, exit: 1, ranTo: 'completion', message: 'audit_failed' };
      }
      for (const c of audit.checks) {
        const glyph = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
        io.stdout.write(`${glyph} ${c.id}: ${c.title}\n`);
        for (const d of c.details) io.stdout.write(`    ${d}\n`);
      }

      if (route.kind !== 'archive') {
        throw new RoutingError('archiveHandler invoked with non-archive route', { route });
      }

      const slug = await (opts.resolveSlug ?? defaultResolveSlug(opts.today))(planningDir);
      const today = (opts.today ?? defaultToday)();
      const archived = await archiveMilestone({
        planningDir,
        slug,
        archived_at: `${today}T00:00:00.000Z`,
      });

      io.stdout.write(`✓ Archive — ${slug} → ${archived.milestoneDir}\n`);
      io.stdout.write(`✓ Wrote ${archived.shippedFile.split('/').pop()}\n`);

      const result: ArchiveHandlerResult = {
        route,
        exit: 0,
        ranTo: 'completion',
        milestoneDir: archived.milestoneDir,
        slug,
        audit,
      };
      return result;
    },
  };
}

function defaultResolveSlug(
  today?: () => string,
): (planningDir: string) => Promise<string> {
  return async (planningDir) => {
    const opts = today !== undefined ? { planningDir, today } : { planningDir };
    return deriveMilestoneSlug(opts);
  };
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
}
