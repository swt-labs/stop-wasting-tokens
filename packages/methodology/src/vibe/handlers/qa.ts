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
import {
  runVerificationLadder,
  type LlmVerificationEscalator,
  type StaticCheck,
  type StaticCheckResult,
} from '@swt-labs/verification';

import { RoutingError } from '../errors.js';
import type { VibeRoute } from '../route.js';

import type { HandlerResult, ModeHandler, ModeIO } from './index.js';

const execFileP = promisify(execFile);

/**
 * QA handler — TDD2 §11.2 ladder-then-handoff.
 *
 * The QA role runs in two tiers:
 *
 *   1. **Static-check ladder** (cheap, deterministic) — typecheck → lint →
 *      format → tests, via `runVerificationLadder` from
 *      `@swt-labs/verification`. Short-circuits on first failure. Tests
 *      inject a synthetic `checks: ReadonlyArray<StaticCheck>` to avoid
 *      spawning real pnpm processes.
 *
 *   2. **LLM must-haves verification** (the rich tier) — when the ladder
 *      passes AND a spawner+qaSpec are injected, the handler dispatches
 *      the must-haves check to the QA agent (v2 spawner path). The
 *      agent's parsed `QaHandoff` envelope drives the
 *      `verification: must_have_id, verdict, evidence` array that lands
 *      in VERIFICATION.md.
 *
 * Routing decisions:
 *   - Ladder pass + agent injected → exit code from agent verdict.
 *   - Ladder pass + no agent → write a static-checks-only VERIFICATION.md
 *     with `result: 'pass'` (the M2 default when no LLM is wired).
 *   - Ladder fail → write a `result: 'fail'` VERIFICATION.md with the
 *     failing-check info; skip the must-haves dispatch (no point spending
 *     tokens when the static surface is broken).
 *   - Optional `escalator: LlmVerificationEscalator` can replace the
 *     spawner path entirely for M3+ when the dispatcher's `'entries'`
 *     strategy drives QA dispatches; not yet wired in M2.
 */

export interface QaHandlerOptions {
  readonly resolveTarget?: (
    route: VibeRoute,
    io: ModeIO,
  ) => { phase: string; slug: string } | undefined;
  readonly planningDirName?: string;
  /** Optional QA agent for must-haves verification (legacy spawner path). */
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
  /**
   * Override the static-check ladder. Tests inject synthetic `StaticCheck`
   * values that don't shell out to pnpm. When omitted, the default ladder
   * runs `pnpm typecheck/lint/format:check/test` per TDD2 §11.2.
   */
  readonly checks?: ReadonlyArray<StaticCheck>;
  /**
   * Optional LLM escalator. M3+ dispatches via `@swt-labs/orchestration`;
   * M2 leaves this undefined and uses the legacy `spawner` path when one
   * is injected.
   */
  readonly escalator?: LlmVerificationEscalator;
}

export function qaHandler(opts: QaHandlerOptions = {}): ModeHandler {
  return {
    kind: 'qa-remediation',
    async run(route: VibeRoute, io: ModeIO): Promise<HandlerResult> {
      const target = (opts.resolveTarget ?? defaultResolveTarget)(route, io);
      if (target === undefined) {
        throw new RoutingError('qa handler requires a phase target', { route });
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
      const plansVerified = summaries
        .map((s) => /-(\d{2})-SUMMARY\.md$/.exec(s)?.[1])
        .filter((p): p is string => p !== undefined);

      const today = (opts.today ?? defaultToday)();
      const tier = opts.tier ?? 'standard';
      const verifiedAtCommit = await resolveHead(opts, io.cwd);

      // Tier 1: static-check ladder. Fails fast — surfaces the cheapest
      // category of bug before paying for an LLM call.
      const ladderResult = await runVerificationLadder({
        cwd: io.cwd,
        ...(opts.checks !== undefined ? { checks: opts.checks } : {}),
        ...(opts.escalator !== undefined ? { escalator: opts.escalator } : {}),
        context: { phase: target.phase },
      });

      if (ladderResult.status === 'failed' || ladderResult.status === 'escalated') {
        const failingCheck = ladderResult.failedCheck;
        const summary = failingCheck?.name ?? 'unknown';
        const path = await writeVerification({
          phaseDir,
          doc: {
            phase: target.phase,
            tier,
            result: 'fail',
            passed: 0,
            failed: 1,
            total: 1,
            date: today,
            plans_verified: plansVerified,
            verified_at_commit: verifiedAtCommit,
            checks: [
              {
                id: 'STATIC-CHECK',
                must_have: `static-check-ladder: ${summary}`,
                status: 'fail',
                evidence: renderLadderFailureEvidence(ladderResult.checks, failingCheck),
              },
            ],
            pre_existing_issues: [],
            body: '',
          },
        });
        io.stdout.write(
          `⚠ QA handler — phase ${target.phase}: static-check ladder failed at ${summary} (wrote ${path.split('/').pop()})\n`,
        );
        return { route, exit: 1, ranTo: 'completion' };
      }

      // Tier 2: must-haves verification (legacy spawner path). Optional at
      // M2 — when no spawner is injected, the static-check pass alone is
      // accepted as a "deterministic" verification result.
      if (opts.spawner === undefined || opts.qaSpec === undefined) {
        const path = await writeVerification({
          phaseDir,
          doc: {
            phase: target.phase,
            tier,
            result: 'pass',
            passed: ladderResult.checks.length,
            failed: 0,
            total: ladderResult.checks.length,
            date: today,
            plans_verified: plansVerified,
            verified_at_commit: verifiedAtCommit,
            checks: ladderResult.checks.map((c) => ({
              id: `STATIC-${c.name.toUpperCase()}`,
              must_have: `${c.name} passes`,
              status: 'pass' as const,
              evidence: c.outputTail.slice(0, 200),
            })),
            pre_existing_issues: [],
            body: '',
          },
        });
        io.stdout.write(
          `✓ QA handler — phase ${target.phase}: static-check ladder passed (${ladderResult.checks.length}/${ladderResult.checks.length}); wrote ${path.split('/').pop()}\n`,
        );
        return { route, exit: 0, ranTo: 'completion' };
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

function renderLadderFailureEvidence(
  checks: ReadonlyArray<StaticCheckResult>,
  failed: StaticCheckResult | undefined,
): string {
  if (failed === undefined) return 'unknown';
  const parts: string[] = [];
  parts.push(`${failed.name} failed (exit=${failed.exitCode}, ${failed.durationMs}ms)`);
  if (failed.outputTail.length > 0) {
    parts.push('---');
    parts.push(failed.outputTail);
  }
  const earlier = checks
    .filter((c) => c.name !== failed.name && c.status === 'passed')
    .map((c) => c.name);
  if (earlier.length > 0) {
    parts.push(`(earlier checks passed: ${earlier.join(', ')})`);
  }
  return parts.join('\n');
}

function composePrompt(phase: string, phaseDir: string, summaries: string[]): string {
  return [
    `# QA verification — Phase ${phase}`,
    '',
    `Phase dir: ${phaseDir}`,
    `Summaries to verify: ${summaries.join(', ')}`,
    '',
    'Static checks (typecheck → lint → format → tests) ALREADY PASSED.',
    'Verify each P0 must-have against the verification kind declared in the plan.',
    'Emit a qa-verification handoff via `swt_report_result`.',
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
