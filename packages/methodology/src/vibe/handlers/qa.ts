import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  writeVerification,
  readKnownIssues,
  writeKnownIssues,
  type KnownIssue,
} from '@swt-labs/artifacts';
import {
  parseQaHandoff,
  type AgentSpec,
  type AgentSpawner,
  type Effort,
  type QaVerificationPayload,
} from '@swt-labs/core';

import { NotImplementedError, RoutingError } from '../errors.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

const execFileP = promisify(execFile);

export interface QaHandlerOptions {
  readonly resolveTarget?: (
    route: VibeRoute,
    io: ModeIO,
  ) => { phase: string; slug: string } | undefined;
  readonly planningDirName?: string;
  readonly spawner?: AgentSpawner;
  readonly qaSpec?: AgentSpec;
  readonly effort?: Effort;
  readonly sessionId?: string;
  /** Override HEAD lookup (default: git rev-parse HEAD). */
  readonly resolveHeadCommit?: (cwd: string) => Promise<string>;
  /** Override 'today' for deterministic tests. */
  readonly today?: () => string;
  /** Override the verification tier (default 'standard'). */
  readonly tier?: 'minimal' | 'standard' | 'strict';
}

export function qaHandler(opts: QaHandlerOptions = {}): ModeHandler {
  return {
    kind: 'qa-remediation',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      const target = (opts.resolveTarget ?? defaultResolveTarget)(route, io);
      if (target === undefined) {
        throw new RoutingError('qa handler requires a phase target', { route });
      }
      if (opts.spawner === undefined || opts.qaSpec === undefined) {
        throw new NotImplementedError(
          'qa-remediation',
          'Phase 9 / Plan 05+ — wire a real Codex AgentSpawner. For now inject a Mock via qaHandler({spawner, qaSpec}).',
        );
      }

      const planningDir = join(io.cwd, opts.planningDirName ?? '.swt-planning');
      const phaseDir = join(planningDir, 'phases', `${target.phase}-${target.slug}`);

      const summaries = await listSummaries(phaseDir, target.phase);
      if (summaries.length === 0) {
        throw new RoutingError(
          `Phase ${target.phase} has no SUMMARY.md files — execute the phase before QA`,
          { phase: target.phase, slug: target.slug },
        );
      }

      const sessionId = opts.sessionId ?? `swt-qa-${Date.now().toString(36)}`;
      const result = await opts.spawner.spawn({
        spec: opts.qaSpec,
        prompt: composePrompt(target.phase, phaseDir, summaries),
        cwd: io.cwd,
        session_id: sessionId,
      });

      if (!result.success || result.handoff === undefined) {
        throw new RoutingError(
          `QA agent failed for phase ${target.phase}${result.error !== undefined ? `: ${result.error}` : ''}`,
          { phase: target.phase },
        );
      }

      const handoff = parseQaHandoff(result.handoff);
      const payload: QaVerificationPayload = handoff.payload;

      const verifiedAtCommit = await resolveHead(opts, io.cwd);
      const today = (opts.today ?? defaultToday)();
      const tier = opts.tier ?? 'standard';

      const passed = payload.checks.filter((c) => c.status === 'pass').length;
      const failed = payload.checks.filter((c) => c.status === 'fail').length;
      const total = payload.checks.length;

      const path = await writeVerification({
        phaseDir,
        doc: {
          phase: payload.phase,
          tier,
          result: payload.result,
          passed,
          failed,
          total,
          date: today,
          plans_verified: payload.plans_verified,
          verified_at_commit: verifiedAtCommit,
          checks: payload.checks,
          pre_existing_issues: payload.pre_existing_issues,
          body: '',
        },
      });

      // Sync known-issues with anything QA flagged as fail.
      const known = await readKnownIssues(phaseDir);
      const next: KnownIssue[] = [...known];
      for (const c of payload.checks) {
        if (c.status !== 'fail') continue;
        const id = `KI-${target.phase}-${c.id}`;
        if (!next.some((k) => k.id === id)) {
          next.push({
            id,
            severity: 'major',
            summary: c.must_have,
            opened_at: today,
            status: 'open',
            details: c.evidence,
          });
        }
      }
      if (next.length !== known.length) {
        await writeKnownIssues(phaseDir, next);
      }

      io.stdout.write(
        `✓ QA handler — phase ${target.phase}: wrote ${path.split('/').pop()} (${passed}/${total} pass, ${failed} fail)\n`,
      );

      return { route, exit: payload.result === 'fail' ? 1 : 0, ranTo: 'completion' };
    },
  };
}

function composePrompt(phase: string, phaseDir: string, summaries: string[]): string {
  return [
    `# QA verification — Phase ${phase}`,
    '',
    `Phase dir: ${phaseDir}`,
    `Summaries to verify: ${summaries.join(', ')}`,
    '',
    'Read each SUMMARY.md, validate ac_results, and emit a qa-verification handoff.',
  ].join('\n');
}

async function listSummaries(phaseDir: string, phase: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(phaseDir);
  } catch {
    return [];
  }
  const re = new RegExp(`^${phase}-(\\d{2})-SUMMARY\\.md$`);
  return entries.filter((e) => re.test(e)).sort();
}

async function resolveHead(opts: QaHandlerOptions, cwd: string): Promise<string> {
  if (opts.resolveHeadCommit !== undefined) {
    return opts.resolveHeadCommit(cwd);
  }
  try {
    const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd });
    return stdout.trim().slice(0, 40);
  } catch {
    return 'unknown';
  }
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
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
