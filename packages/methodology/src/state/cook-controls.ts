/**
 * Plan 04-01 (Phase 4) T4 — Cook control-signal-file protocol.
 *
 * R2 decision (Pi 0.74 has no mid-turn pause): SHIP "next-boundary pause +
 * SIGTERM cancel". The cook orchestrator polls a per-session signal file
 * at every inter-agent / mode-dispatch boundary (one stat() per check;
 * negligible against Pi turn latency of 30 s+). The dashboard / REST API
 * writes the signal file via `writePendingSignal`; cook consumes it
 * atomically via `readPendingSignal` (read-then-unlink so each signal is
 * delivered exactly once).
 *
 * Mid-turn pause is intentionally NOT supported — it depends on Phase 6
 * REQ-11 crash-recovery checkpoint primitives. The README pass in plan
 * 04-05 documents the "pause defers to next agent boundary" limitation.
 *
 * Cancel translates `CookCancelledError` into the new
 * `EXIT.USER_CANCELLED` code at the top-level cookHandler catch. If a
 * Pi child is mid-turn when cancel fires, cook's existing process tree
 * cleanup (research §4.1 gracefulShutdown pattern) handles SIGTERM
 * propagation; no new child-tracking is introduced here.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type CookControlAction = 'pause' | 'resume' | 'cancel';

export class CookCancelledError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Cook session ${sessionId} cancelled by user`);
    this.name = 'CookCancelledError';
    this.sessionId = sessionId;
  }
}

const SIGNAL_DIR_REL = path.join('.swt-planning', '.cook-controls');

function signalPath(sessionId: string, planningRoot?: string): string {
  const root = planningRoot ?? process.cwd();
  return path.join(root, SIGNAL_DIR_REL, `${sessionId}.pending`);
}

/**
 * Read + unlink the pending signal for `sessionId`. Returns null when no
 * signal is queued; returns 'pause' / 'resume' / 'cancel' otherwise.
 * The unlink is part of the contract — the orchestrator only consumes
 * each signal once.
 */
export function readPendingSignal(
  sessionId: string,
  planningRoot?: string,
): CookControlAction | null {
  const file = signalPath(sessionId, planningRoot);
  if (!fs.existsSync(file)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8').trim();
  } catch {
    return null;
  }
  try {
    fs.unlinkSync(file);
  } catch {
    // Tolerable — another reader consumed it first.
  }
  if (raw === 'pause' || raw === 'resume' || raw === 'cancel') return raw;
  return null;
}

/**
 * Write a pending signal for `sessionId`. Called by the dashboard's
 * POST /api/cook/:sessionId/control route in plan 04-02. The directory
 * is created on demand so the dashboard does not need to pre-seed it.
 */
export function writePendingSignal(
  sessionId: string,
  action: CookControlAction,
  planningRoot?: string,
): void {
  const file = signalPath(sessionId, planningRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, action);
}

export interface WaitForResumeOrCancelOptions {
  readonly pollIntervalMs?: number;
  readonly planningRoot?: string;
  /** Test seam — abort the loop after this many polls (default Infinity). */
  readonly maxPolls?: number;
}

/**
 * Block until a `resume` or `cancel` signal lands for `sessionId`. Pure
 * polling (no chokidar dependency in the methodology package). Returns
 * the action that broke the loop.
 *
 * If the loop hits `maxPolls` without a terminal signal, it returns
 * 'cancel' — the test seam ensures hung tests fail loud instead of
 * hanging forever.
 */
export async function waitForResumeOrCancel(
  sessionId: string,
  opts: WaitForResumeOrCancelOptions = {},
): Promise<CookControlAction> {
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const maxPolls = opts.maxPolls ?? Number.POSITIVE_INFINITY;
  let polls = 0;
  while (polls < maxPolls) {
    const sig = readPendingSignal(sessionId, opts.planningRoot);
    if (sig === 'resume' || sig === 'cancel') return sig;
    polls += 1;
    if (polls >= maxPolls) break;
    await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
  }
  return 'cancel';
}
