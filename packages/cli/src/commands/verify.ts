/**
 * `swt verify` — Plan 03-03 Task T2: INLINE UAT checkpoint loop.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  R3 DECISION — NO Pi SESSION SPAWN                                   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Unlike the other secondary verbs (qa, research, map, init), `swt verify`
 * runs INLINE in the CLI process. It DOES NOT spawn a Pi subagent.
 *
 * Architect-R3 rationale (TDD3 §12.3, plan 03-RESEARCH §3 / R3):
 *
 *   - UAT requires `askUser()` to the human, which is registered ONLY on
 *     the orchestrator session (TDD3 §20.3 / §24, plan 01-05 invariant).
 *   - The 890-LOC `commands/verify.md` document is the *protocol*
 *     documentation — it describes the loop the operator runs. It is
 *     NOT consumed as an LLM prompt body anywhere.
 *   - The TypeScript handler IS the protocol implementation:
 *       1. extract UAT scenarios from VERIFICATION.md / PLAN.md
 *       2. iterate one `askUser` per scenario for PASS/FAIL/SKIP
 *       3. capture FAIL/SKIP notes via a follow-up freeform askUser
 *       4. persist `{NN}-UAT.md` via the templates/UAT.md skeleton
 *       5. optionally seed re-verification when verify_scope='remediation'
 *
 * If you find yourself reaching for `spawnAgent` or
 * `spawnOrchestratorSession` in this file, STOP — that path violates the
 * orchestrator-only askUser invariant. The whole point of the R3 decision
 * was to keep verify on the orchestrator process rather than promoting
 * `swt_ask_user` to non-orchestrator roles.
 *
 * The mechanical regression guard is in verify.test.ts: spawnAgent is
 * mocked to THROW, and every verify path must complete without ever
 * touching it.
 */

import { execSync as nodeExecSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { detectPhase } from '@swt-labs/methodology';
import {
  askUser as defaultAskUser,
  resolveInstallRoot,
  type AskUserResponse,
} from '@swt-labs/runtime';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

// ────────────────────────────────────────────────────────────────────────
// Scenario types
// ────────────────────────────────────────────────────────────────────────

export interface UatScenario {
  /** Stable checkpoint id, e.g. P01-T01 or D01. */
  readonly id: string;
  /** Source plan id (e.g. "03-03") or "discovered" when origin is the VERIFICATION protocol. */
  readonly planId: string;
  /** One-line scenario description shown in the askUser question. */
  readonly description: string;
  /** Multi-line "Scenario / Expected" details shown via askUser.preview. */
  readonly steps: string;
}

export type UatVerdict = 'pass' | 'fail' | 'skip';

export interface UatRow {
  readonly scenario: UatScenario;
  readonly verdict: UatVerdict;
  readonly note: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// Phase resolution helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Resolve `{NN}` and `{NN-slug}` for a phase target. The handler accepts:
 *   - a bare integer ("3" → "03")
 *   - a padded id ("03")
 *   - a slug ("03-orchestrator-wiring-swt-cook")
 *   - empty/undefined → fall back to detectPhase().next_phase
 */
export function resolvePhaseId(
  raw: string | undefined,
  detected: string | undefined,
): { padded: string; slug: string | undefined } {
  const candidate = (raw ?? '').trim() || (detected ?? '').trim();
  if (candidate === '') return { padded: '', slug: undefined };
  const dashIdx = candidate.indexOf('-');
  if (dashIdx >= 0) {
    return { padded: candidate.slice(0, dashIdx), slug: candidate };
  }
  // bare integer or padded id
  const n = Number.parseInt(candidate, 10);
  if (Number.isFinite(n) && n > 0) {
    return { padded: String(n).padStart(2, '0'), slug: undefined };
  }
  return { padded: candidate, slug: undefined };
}

/**
 * Locate the phase directory under `.swt-planning/phases/` matching the
 * `padded` id. Returns the full slug (e.g. "03-orchestrator-wiring-swt-cook")
 * or undefined when the directory does not exist.
 */
export function findPhaseSlug(
  cwd: string,
  padded: string,
  fsImpl: { existsSync: typeof existsSync; readdirSync: typeof readdirSync } = {
    existsSync,
    readdirSync,
  },
): string | undefined {
  const phasesDir = resolve(cwd, '.swt-planning', 'phases');
  if (!fsImpl.existsSync(phasesDir)) return undefined;
  try {
    const entries = fsImpl.readdirSync(phasesDir);
    return entries.find((name) => name.startsWith(`${padded}-`));
  } catch {
    return undefined;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Scenario extraction
// ────────────────────────────────────────────────────────────────────────

/**
 * Extract UAT scenarios from a `{NN}-VERIFICATION.md` body. Looks for a
 * top-level `## UAT Scenarios` section and consumes its bullet items as
 * one scenario per line. Each scenario id is auto-assigned `P{NN}-T{II}`
 * where `NN` is the phase id and `II` is the 1-based index.
 *
 * Returns an empty list when the heading is absent so callers can fall
 * back to PLAN.md scraping.
 */
export function extractFromVerification(body: string, phasePadded: string): UatScenario[] {
  const headingIdx = body.search(/^##\s+UAT Scenarios\s*$/m);
  if (headingIdx < 0) return [];
  const after = body.slice(headingIdx);
  const nextHeading = after.slice(1).search(/^##\s+\S/m);
  const section = nextHeading >= 0 ? after.slice(0, nextHeading + 1) : after;

  const scenarios: UatScenario[] = [];
  const bulletRegex = /^[\-\*]\s+(.*)$/gm;
  let match: RegExpExecArray | null;
  let idx = 1;
  while ((match = bulletRegex.exec(section)) !== null) {
    const line = match[1]?.trim() ?? '';
    if (line === '') continue;
    scenarios.push({
      id: `P${phasePadded}-T${String(idx).padStart(2, '0')}`,
      planId: phasePadded,
      description: line,
      steps: line,
    });
    idx += 1;
  }
  return scenarios;
}

/**
 * Extract UAT scenarios from a PLAN.md `<success_criteria>` block. Each
 * bullet inside the block becomes one scenario.
 */
export function extractFromPlanSuccessCriteria(body: string, planId: string): UatScenario[] {
  const openIdx = body.indexOf('<success_criteria>');
  if (openIdx < 0) return [];
  const closeIdx = body.indexOf('</success_criteria>', openIdx);
  const block = body.slice(openIdx, closeIdx >= 0 ? closeIdx : undefined);

  const scenarios: UatScenario[] = [];
  const bulletRegex = /^[\-\*]\s+(.*)$/gm;
  let match: RegExpExecArray | null;
  let idx = 1;
  while ((match = bulletRegex.exec(block)) !== null) {
    const line = match[1]?.trim() ?? '';
    if (line === '') continue;
    scenarios.push({
      id: `P${planId}-T${String(idx).padStart(2, '0')}`,
      planId,
      description: line,
      steps: line,
    });
    idx += 1;
  }
  return scenarios;
}

/**
 * Collect all PLAN.md files in a phase directory and concatenate their
 * extracted scenarios.
 */
export function collectScenariosFromPlans(
  phaseDir: string,
  phasePadded: string,
  fsImpl: {
    existsSync: typeof existsSync;
    readdirSync: typeof readdirSync;
    readFileSync: typeof readFileSync;
  } = {
    existsSync,
    readdirSync,
    readFileSync,
  },
): UatScenario[] {
  if (!fsImpl.existsSync(phaseDir)) return [];
  const out: UatScenario[] = [];
  const entries = fsImpl.readdirSync(phaseDir);
  for (const entry of entries) {
    if (!entry.endsWith('-PLAN.md')) continue;
    const planId = entry.replace(/-PLAN\.md$/i, '');
    const planScenarios = extractFromPlanSuccessCriteria(
      String(fsImpl.readFileSync(resolve(phaseDir, entry), 'utf8')),
      planId,
    );
    // Re-prefix to use the phase padded id so checkpoint ids stay consistent
    out.push(
      ...planScenarios.map((s, i) => ({
        ...s,
        id: `P${phasePadded}-T${String(out.length + i + 1).padStart(2, '0')}`,
      })),
    );
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// UAT artifact persistence
// ────────────────────────────────────────────────────────────────────────

/**
 * Build the `{NN}-UAT.md` body from collected rows, mirroring the structure
 * of `templates/UAT.md` (frontmatter + Tests section + Summary block).
 */
export function renderUatArtifact(
  phasePadded: string,
  rows: ReadonlyArray<UatRow>,
  startedIso: string,
): string {
  const passed = rows.filter((r) => r.verdict === 'pass').length;
  const skipped = rows.filter((r) => r.verdict === 'skip').length;
  const issues = rows.filter((r) => r.verdict === 'fail').length;
  const total = rows.length;
  const status = issues > 0 ? 'issues_found' : 'complete';
  const today = new Date().toISOString().slice(0, 10);

  const lines: string[] = [];
  lines.push('---');
  lines.push(`phase: ${Number.parseInt(phasePadded, 10) || 0}`);
  lines.push(`plan_count: ${new Set(rows.map((r) => r.scenario.planId)).size}`);
  lines.push(`status: ${status}`);
  lines.push(`started: ${startedIso.slice(0, 10)}`);
  lines.push(`completed: ${today}`);
  lines.push(`total_tests: ${total}`);
  lines.push(`passed: ${passed}`);
  lines.push(`skipped: ${skipped}`);
  lines.push(`issues: ${issues}`);
  lines.push('---');
  lines.push('');
  lines.push(
    `UAT completed for phase ${phasePadded}: ${passed} passed, ${skipped} skipped, ${issues} issue(s).`,
  );
  lines.push('');
  lines.push('## Tests');
  lines.push('');
  for (const row of rows) {
    lines.push(`### ${row.scenario.id}: ${row.scenario.description}`);
    lines.push('');
    lines.push(`- **Plan:** ${row.scenario.planId}`);
    lines.push(`- **Scenario:** ${row.scenario.description}`);
    lines.push(`- **Expected:** ${row.scenario.steps}`);
    lines.push(`- **Result:** ${row.verdict}`);
    if (row.verdict !== 'pass' && row.note !== null && row.note.length > 0) {
      lines.push(`- **Issue:**`);
      lines.push(`  - Description: ${row.note}`);
      lines.push(`  - Severity: ${row.verdict === 'fail' ? 'major' : 'minor'}`);
    }
    lines.push('');
  }
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Passed: ${passed}`);
  lines.push(`- Skipped: ${skipped}`);
  lines.push(`- Issues: ${issues}`);
  lines.push(`- Total: ${total}`);
  lines.push('');
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────
// Config loader (subset of .swt-planning/config.json verify needs)
// ────────────────────────────────────────────────────────────────────────

export interface VerifyConfig {
  /** 'milestone' (default) | 'remediation'. Controls re-verify seeding. */
  readonly verify_scope: 'milestone' | 'remediation';
  /** Cap on remediation rounds before the loop refuses to re-seed. */
  readonly max_uat_remediation_rounds: number;
}

export function loadVerifyConfig(
  cwd: string,
  fsImpl: { existsSync: typeof existsSync; readFileSync: typeof readFileSync } = {
    existsSync,
    readFileSync,
  },
): VerifyConfig {
  const configPath = resolve(cwd, '.swt-planning', 'config.json');
  if (!fsImpl.existsSync(configPath)) {
    return { verify_scope: 'milestone', max_uat_remediation_rounds: 3 };
  }
  try {
    const raw = String(fsImpl.readFileSync(configPath, 'utf8'));
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const verifyScope = parsed['verify_scope'] === 'remediation' ? 'remediation' : 'milestone';
    const maxRounds =
      typeof parsed['max_uat_remediation_rounds'] === 'number' &&
      Number.isFinite(parsed['max_uat_remediation_rounds'])
        ? parsed['max_uat_remediation_rounds']
        : 3;
    return { verify_scope: verifyScope, max_uat_remediation_rounds: maxRounds };
  } catch {
    return { verify_scope: 'milestone', max_uat_remediation_rounds: 3 };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Top-level handler
// ────────────────────────────────────────────────────────────────────────

export interface VerifyHandlerDeps {
  readonly askUserImpl?: typeof defaultAskUser;
  readonly detectPhaseImpl?: typeof detectPhase;
  readonly readFileSyncImpl?: typeof readFileSync;
  readonly writeFileSyncImpl?: typeof writeFileSync;
  readonly existsSyncImpl?: typeof existsSync;
  readonly readdirSyncImpl?: typeof readdirSync;
  readonly mkdirSyncImpl?: typeof mkdirSync;
  readonly execSyncImpl?: typeof nodeExecSync;
}

export function makeVerifyHandler(deps: VerifyHandlerDeps = {}): CommandHandler {
  const askUserFn = deps.askUserImpl ?? defaultAskUser;
  const detectPhaseFn = deps.detectPhaseImpl ?? detectPhase;
  const readFileSyncFn = deps.readFileSyncImpl ?? readFileSync;
  const writeFileSyncFn = deps.writeFileSyncImpl ?? writeFileSync;
  const existsSyncFn = deps.existsSyncImpl ?? existsSync;
  const readdirSyncFn = deps.readdirSyncImpl ?? readdirSync;
  const mkdirSyncFn = deps.mkdirSyncImpl ?? mkdirSync;
  const execSyncFn = deps.execSyncImpl ?? nodeExecSync;

  return async (parsed, io: CommandIO): Promise<ExitCode> => {
    // 1. Phase resolution.
    let detectedNext: string | undefined;
    let detectedSlug: string | undefined;
    try {
      const state = await detectPhaseFn({ cwd: io.cwd });
      detectedNext = state.next_phase;
      detectedSlug = state.next_phase_slug;
    } catch {
      // Non-fatal — fall back to the positional.
    }
    const { padded } = resolvePhaseId(parsed.positionals[0], detectedNext);
    if (padded === '') {
      io.stderr.write(
        'swt verify: could not resolve a phase target. Pass a phase number (e.g. swt verify 03).\n',
      );
      return EXIT.USAGE_ERROR;
    }
    const slug =
      findPhaseSlug(io.cwd, padded, { existsSync: existsSyncFn, readdirSync: readdirSyncFn }) ??
      (detectedSlug !== undefined && detectedSlug.startsWith(`${padded}-`)
        ? detectedSlug
        : undefined) ??
      padded;
    const phaseDir = resolve(io.cwd, '.swt-planning', 'phases', slug);

    // 2. Scenario discovery: VERIFICATION.md → PLAN.md fallback.
    let scenarios: UatScenario[] = [];
    const verificationPath = resolve(phaseDir, `${padded}-VERIFICATION.md`);
    if (existsSyncFn(verificationPath)) {
      try {
        const verBody = String(readFileSyncFn(verificationPath, 'utf8'));
        scenarios = extractFromVerification(verBody, padded);
      } catch {
        scenarios = [];
      }
    }
    if (scenarios.length === 0) {
      scenarios = collectScenariosFromPlans(phaseDir, padded, {
        existsSync: existsSyncFn,
        readdirSync: readdirSyncFn,
        readFileSync: readFileSyncFn,
      });
    }
    if (scenarios.length === 0) {
      io.stderr.write(
        `swt verify: no UAT scenarios found for phase ${padded} (looked in ${verificationPath} and PLAN.md success_criteria).\n`,
      );
      return EXIT.USAGE_ERROR;
    }

    // 3. CHECKPOINT loop — one askUser per scenario, plus optional follow-up
    //    for fail/skip notes.
    const startedIso = new Date().toISOString();
    const rows: UatRow[] = [];
    for (let i = 0; i < scenarios.length; i += 1) {
      const scenario = scenarios[i]!;
      const verdictResp: AskUserResponse = await askUserFn({
        question: scenario.description,
        options: [{ label: 'Pass', isRecommended: true }, { label: 'Fail' }, { label: 'Skip' }],
        ...(scenario.steps !== scenario.description ? { preview: scenario.steps } : {}),
        header: `Checkpoint ${i + 1}/${scenarios.length} — ${scenario.id}`,
      });
      const verdict = mapVerdict(verdictResp);

      let note: string | null = null;
      if (verdict !== 'pass') {
        const noteResp = await askUserFn({
          question:
            verdict === 'fail'
              ? `Notes on the failure for ${scenario.id}?`
              : `Reason for skipping ${scenario.id}?`,
          options: [{ label: 'Continue', isRecommended: true }],
        });
        note = noteResp.freeform ?? noteResp.selectedOption ?? null;
      }

      rows.push({ scenario, verdict, note });
    }

    // 4. Persist {NN}-UAT.md.
    const uatPath = resolve(phaseDir, `${padded}-UAT.md`);
    try {
      if (!existsSyncFn(phaseDir)) mkdirSyncFn(phaseDir, { recursive: true });
      const body = renderUatArtifact(padded, rows, startedIso);
      writeFileSyncFn(uatPath, body, 'utf8');
      io.stdout.write(`✓ Wrote ${uatPath}\n`);
    } catch (err) {
      io.stderr.write(
        `swt verify: failed to write UAT artifact: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return EXIT.RUNTIME_ERROR;
    }

    // 5. Remediation handoff — only when scope is 'remediation' AND there
    //    were failures. Bounded by max_uat_remediation_rounds.
    const config = loadVerifyConfig(io.cwd, {
      existsSync: existsSyncFn,
      readFileSync: readFileSyncFn,
    });
    const hasFailures = rows.some((r) => r.verdict === 'fail');
    if (hasFailures && config.verify_scope === 'remediation') {
      try {
        const installRoot = resolveInstallRoot();
        const scriptPath = resolve(installRoot, 'scripts', 'prepare-reverification.sh');
        execSyncFn(
          `bash ${JSON.stringify(scriptPath)} ${JSON.stringify(`.swt-planning/phases/${slug}`)}`,
          { cwd: io.cwd, encoding: 'utf8' },
        );
        io.stdout.write(
          `✓ Seeded re-verification round (max ${config.max_uat_remediation_rounds}).\n`,
        );
      } catch (err) {
        io.stderr.write(
          `swt verify: prepare-reverification.sh failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return EXIT.RUNTIME_ERROR;
      }
    }

    return EXIT.SUCCESS;
  };
}

function mapVerdict(resp: AskUserResponse): UatVerdict {
  const picked = (resp.selectedOption ?? resp.freeform ?? '').toLowerCase();
  if (picked.startsWith('pass')) return 'pass';
  if (picked.startsWith('fail')) return 'fail';
  return 'skip';
}

/**
 * Default verifyHandler — production-wired. Tests use `makeVerifyHandler({...})`
 * with injected deps.
 */
export const verifyHandler: CommandHandler = makeVerifyHandler();
