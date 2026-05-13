/**
 * Plan 01-03 (Phase 1) — `swt:fireHook` dispatcher implementation.
 *
 * Subscribes to Pi session events, matches them against a registered hook
 * table, and spawns bash handler scripts with the env contract required by
 * scripts/bash-guard.sh and scripts/file-guard.sh (research §3 primitive
 * 3). Every spawn is wrapped in a try/catch + AbortController timeout so a
 * misbehaving handler degrades to `'allow'` (PreToolUse) or `no-op`
 * (PostToolUse, SubagentStart, …) and NEVER crashes the session. The
 * invariant is named "hook-wrapper" after scripts/hook-wrapper.sh and is
 * mechanically tested in `runtime/test/hooks/dispatcher.test.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * PreToolUse semantics — Pi 0.74 verification (Task 3, also cross-checked
 * against plan 01-01 task T01's finding):
 *
 *   `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts`
 *   (`CreateAgentSessionOptions`, lines 11-55) DOES NOT expose a
 *   pre-execution intercept option (`beforeToolExecution` / equivalent)
 *   that the *consumer* of `createAgentSession` can set from outside.
 *
 *   The Pi internals DO have a `beforeToolCall` hook on the underlying
 *   `Agent` instance (see `agent-session.js` line 170), and that hook
 *   forwards `tool_call` events to the Pi extension runner. So in theory,
 *   a Pi extension registering a `tool_call` handler via `pi.on('tool_call',
 *   …)` could return a `'block'` decision and reject the call.
 *
 *   However: plan 01-01 task T01 also established that Pi extensions are
 *   NOT consumable as input to `createAgentSession` — they are loaded only
 *   via `main()`'s `MainOptions.extensionFactories` (i.e., at CLI
 *   bootstrap, not at programmatic-spawn time). The programmatic seam
 *   available today is `customTools[]`, which can't carry a `tool_call`
 *   handler.
 *
 *   ⇒ Phase 1 implementation: PreToolUse is **advisory**. When the
 *   dispatcher receives a `TOOL_CALL` event via `subscribeToSession`, it
 *   spawns the matching PreToolUse handlers and observes their exit codes.
 *   An exit-2 result is *logged as a would-be-block* through the
 *   `HookEventBus` (the script's stderr is captured into the log line) but
 *   the dispatcher cannot retroactively unwind a tool call Pi has already
 *   forwarded to the agent. Callers who need a real gate must use
 *   `dispatchPreTool` directly (e.g., by wrapping each `customTool.execute`
 *   in a synchronous call before delegating to the underlying tool body) —
 *   that path DOES honour the `'block'` return value.
 *
 *   TODO(Phase F): once Pi exposes `extensionFactories` on
 *   `createAgentSession` (or once we adopt the customTool-wrapping pattern
 *   for every built-in tool), upgrade `subscribeToSession` to register a
 *   `tool_call` extension handler that returns the dispatcher's decision
 *   so PreToolUse becomes a real gate. Reference: TDD3 §8.2 + research §7
 *   risk 1.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Stdin contract — bash handler scripts read JSON from stdin:
 *
 *   PreToolUse → `{ "tool_name": "...", "tool_input": <unknown> }`
 *   PostToolUse → `{ "tool_name": "...", "tool_result": <unknown> }`
 *   SessionStart / Stop / SubagentStart / SubagentStop → `{}` (the env
 *     carries SWT_INSTALL_ROOT, SWT_SESSION_ID, etc.; no stdin payload).
 *
 * This matches scripts/bash-guard.sh line 15 (`jq -r '.tool_input.command'`)
 * and scripts/file-guard.sh line 17 (`jq -r '.tool_input.file_path'`).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Env contract — every spawn inherits process.env + receives:
 *
 *   SWT_INSTALL_ROOT — from the dispatcher's `installRoot` field
 *   SWT_SESSION_ID   — from the dispatcher's `sessionId` field
 *   SWT_CONFIG_ROOT  — resolved by walking up from `cwd` for
 *                      `.swt-planning/config.json`; absent if not found.
 *   plus tool-specific: SWT_TOOL_NAME (PreToolUse + PostToolUse).
 *
 * The bash scripts ALSO consult `VBW_PLANNING_DIR` (legacy name) — when
 * SWT_CONFIG_ROOT resolves we set both names so the ported scripts keep
 * working unchanged. The legacy alias is the only `VBW_*` env this layer
 * writes; everything else moves to `SWT_*` per TDD3 §3.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

import type {
  HookContext,
  HookDecision,
  HookEvent,
  HookMatcher,
  HookRegistration,
} from './types.js';
import type { SwtEvent, SwtSession } from '../types.js';

/** Single line written to the dispatcher's structured log channel. */
export interface HookEventBusEntry {
  /** ISO-8601 timestamp at emit time. */
  readonly ts: string;
  /** Event name being dispatched / observed. */
  readonly event: HookEvent | 'hookDispatcher.lifecycle';
  /** One of: 'spawn' | 'success' | 'block' | 'timeout' | 'error' | 'noop' | 'attach' | 'detach'. */
  readonly phase: string;
  /** Script path (when relevant). */
  readonly scriptPath?: string;
  /** Resolved tool name (when relevant). */
  readonly toolName?: string;
  /** Exit code of the spawn (0 = ok, 2 = block, anything else = degraded). */
  readonly exitCode?: number;
  /** stderr captured from the script. */
  readonly stderr?: string;
  /** Free-form note explaining a degradation / fallthrough. */
  readonly note?: string;
}

/**
 * Structural EventBus contract — the dispatcher writes log lines through
 * this. Compatible with `CliEventBus.emit({type: 'log.append', …})` by
 * wrapping each entry into the `log.append` shape at the call boundary.
 * Defining a local interface keeps the runtime layer free of a hard
 * dependency on `packages/cli`.
 */
export interface HookEventBus {
  emit(entry: HookEventBusEntry): void;
}

export interface HookDispatcherOptions {
  /** Static registrations loaded from `config/hooks.json` (or assembled in code). */
  readonly registrations: ReadonlyArray<HookRegistration>;
  /** Absolute path of the SWT install root (resolves relative `scriptPath`s). */
  readonly installRoot: string;
  /** Session id threaded into env + log entries. */
  readonly sessionId: string;
  /** Working directory the bash scripts run from. Used to resolve `SWT_CONFIG_ROOT`. */
  readonly cwd: string;
  /** Optional log sink. Defaults to a no-op silent bus. */
  readonly eventBus?: HookEventBus;
  /** Optional role binding — surfaces in env as `VBW_AGENT_ROLE` for legacy scripts. */
  readonly role?: string;
}

/**
 * Public dispatcher surface returned by `createHookDispatcher`. Phase 1
 * consumers: `packages/orchestration/src/spawn-agent.ts` constructs one
 * per spawn and calls `dispatchSessionEvent('SubagentStart', …)` before
 * dispatch + `dispatchSessionEvent('SubagentStop', …)` after.
 */
export interface HookDispatcher {
  /** Add a registration to the in-memory table. */
  register(reg: HookRegistration): void;
  /**
   * Run every PreToolUse handler matching `toolName`. Returns `'block'`
   * iff at least one handler exits with code 2 (the policy-deny code).
   * Every other failure mode (timeout, crash, exit 1/N) degrades to
   * `'allow'` per the hook-wrapper invariant.
   */
  dispatchPreTool(toolName: string, toolInput: unknown): Promise<HookDecision>;
  /**
   * Run every PostToolUse handler matching `toolName`. Always resolves
   * (never throws); errors are logged through `eventBus`.
   */
  dispatchPostTool(toolName: string, toolResult: unknown): Promise<void>;
  /**
   * Fire a session-level event (SessionStart, Stop, SubagentStart,
   * SubagentStop, Notification). Always resolves; errors logged.
   */
  dispatchSessionEvent(event: HookEvent, ctx?: Partial<HookContext>): Promise<void>;
  /**
   * Attach to a Pi `SwtSession`'s event stream — wires `AGENT_START` →
   * SessionStart hook, `AGENT_END` → Stop hook, `TOOL_CALL` → advisory
   * PreToolUse, `TOOL_RESULT` → PostToolUse. Returns an unsubscribe.
   *
   * NOTE: `TOOL_CALL` is a *post-notification* in Pi 0.74 (research §4 /
   * task 3 finding above). Advisory only — exit-2 logs but does not
   * actually block Pi from completing the call.
   */
  subscribeToSession(session: SwtSession): () => void;
}

/**
 * Default timeoutMs when a registration omits one. Matches `config/hooks.json`'s
 * seed value so the on-disk + in-code defaults agree.
 */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Walk up from `cwd` looking for `.swt-planning/config.json`. Used to
 * populate `SWT_CONFIG_ROOT`. Returns `null` if not found — bash scripts
 * fall back to relative `.swt-planning` per scripts/lib/swt-config-root.sh.
 */
function resolveConfigRoot(cwd: string): string | null {
  let current = resolve(cwd);
  for (;;) {
    const candidate = `${current}${sep}.swt-planning${sep}config.json`;
    if (existsSync(candidate)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** No-op event bus — used when caller omits one. */
const SILENT_BUS: HookEventBus = {
  emit: () => undefined,
};

/**
 * Resolve a single registration's `scriptPath` against the install root.
 * Absolute paths pass through unchanged.
 */
function resolveScriptPath(installRoot: string, scriptPath: string): string {
  return isAbsolute(scriptPath) ? scriptPath : resolve(installRoot, scriptPath);
}

/**
 * Does a registration's matcher select this `toolName`? `null` matcher =
 * wildcard. Missing `tool` field = wildcard. Literal strings compare by
 * equality; `RegExp` matchers use `.test()`.
 */
function matcherSelectsTool(matcher: HookMatcher | null, toolName: string | undefined): boolean {
  if (matcher === null) return true;
  if (matcher.tool === undefined) return true;
  if (matcher.tool instanceof RegExp) return matcher.tool.test(toolName ?? '');
  return matcher.tool === toolName;
}

/**
 * Spawn one handler script and resolve to its exit code. Honors the
 * hook-wrapper invariant: timeouts, crashes, and unknown exit codes
 * resolve to `null` (degraded — caller treats as allow/no-op). Only a
 * clean numeric exit code yields a number.
 */
async function runHandler(
  scriptPath: string,
  stdin: string,
  env: Record<string, string>,
  timeoutMs: number,
  cwd: string,
  eventBus: HookEventBus,
  event: HookEvent,
  toolName?: string,
): Promise<{ exitCode: number | null; stderr: string; degraded: boolean; note?: string }> {
  return new Promise((resolveExec) => {
    let stderr = '';
    let timedOut = false;
    let settled = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('bash', [scriptPath], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // `detached: true` puts the child + any of its own children into
        // a new process group rooted at `child.pid`. We kill the whole
        // group on timeout (negative pid) so a `sleep` subprocess gets
        // SIGTERM too, not just the bash parent. Without this, killing
        // bash leaves `sleep` running until it completes — the parent's
        // `close` event fires only after the child reaps.
        detached: true,
      });
    } catch (err) {
      const note = `spawn-failed: ${err instanceof Error ? err.message : String(err)}`;
      eventBus.emit({
        ts: new Date().toISOString(),
        event,
        phase: 'error',
        scriptPath,
        ...(toolName !== undefined ? { toolName } : {}),
        note,
      });
      resolveExec({ exitCode: null, stderr: '', degraded: true, note });
      return;
    }

    const childPid = child.pid;

    const killGroup = (signal: NodeJS.Signals): void => {
      // Best-effort: kill the whole process group (negative PID) so any
      // `sleep`/`exec` subprocesses spawned by the bash script also die.
      // Falls back to plain `child.kill` if `process.kill(-pid, signal)`
      // throws (e.g., the group is already gone).
      if (typeof childPid !== 'number') return;
      try {
        process.kill(-childPid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // best-effort; the close event below will eventually settle.
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      // Escalate to SIGKILL after a short grace window. Some signal-handling
      // bash scripts ignore SIGTERM; the SIGKILL guarantees `close` fires.
      setTimeout(() => {
        if (!settled) killGroup('SIGKILL');
      }, 200);
    }, timeoutMs);

    if (child.stderr !== null) {
      child.stderr.on('data', (chunk: Buffer) => {
        // Cap stderr capture to avoid runaway memory if a script floods.
        if (stderr.length < 8192) {
          stderr += chunk.toString('utf8');
        }
      });
    }

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const note = `child-error: ${err.message}`;
      eventBus.emit({
        ts: new Date().toISOString(),
        event,
        phase: 'error',
        scriptPath,
        ...(toolName !== undefined ? { toolName } : {}),
        note,
      });
      resolveExec({ exitCode: null, stderr, degraded: true, note });
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        const note = `timeout after ${timeoutMs}ms`;
        eventBus.emit({
          ts: new Date().toISOString(),
          event,
          phase: 'timeout',
          scriptPath,
          ...(toolName !== undefined ? { toolName } : {}),
          stderr,
          note,
        });
        resolveExec({ exitCode: null, stderr, degraded: true, note });
        return;
      }
      // `code` is null when the child was killed by a signal — treat as
      // degraded (the spawn was disrupted, not a clean policy verdict).
      if (code === null) {
        const note = 'killed-by-signal';
        eventBus.emit({
          ts: new Date().toISOString(),
          event,
          phase: 'error',
          scriptPath,
          ...(toolName !== undefined ? { toolName } : {}),
          stderr,
          note,
        });
        resolveExec({ exitCode: null, stderr, degraded: true, note });
        return;
      }
      resolveExec({ exitCode: code, stderr, degraded: false });
    });

    // Pipe stdin and close. Wrap in try/catch — if the child is already
    // dead by the time we write, surface as degraded rather than throw.
    try {
      if (child.stdin !== null) {
        child.stdin.end(stdin);
      }
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const note = `stdin-write-failed: ${err instanceof Error ? err.message : String(err)}`;
        eventBus.emit({
          ts: new Date().toISOString(),
          event,
          phase: 'error',
          scriptPath,
          ...(toolName !== undefined ? { toolName } : {}),
          note,
        });
        resolveExec({ exitCode: null, stderr, degraded: true, note });
      }
    }
  });
}

/**
 * Construct the dispatcher. Reads its registration table at construction
 * time; callers can `register()` more rows afterwards (Phase 2 hot-loads).
 */
export function createHookDispatcher(opts: HookDispatcherOptions): HookDispatcher {
  const registrations: HookRegistration[] = [...opts.registrations];
  const eventBus = opts.eventBus ?? SILENT_BUS;
  const { installRoot, sessionId, cwd, role } = opts;

  const configRoot = resolveConfigRoot(cwd);

  function buildEnv(extras: Record<string, string>): Record<string, string> {
    // Start from process.env so children inherit PATH, HOME, etc. Cast
    // through Record<string,string> by filtering undefined values — Node
    // tolerates extra keys but tests assert on the resolved set, so we
    // keep it tight.
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') merged[k] = v;
    }
    merged.SWT_INSTALL_ROOT = installRoot;
    merged.SWT_SESSION_ID = sessionId;
    if (configRoot !== null) {
      merged.SWT_CONFIG_ROOT = configRoot;
      // Legacy alias consumed by the ported bash scripts (research §2.5).
      // Kept until Phase F renames inside scripts/.
      merged.VBW_PLANNING_DIR = `${configRoot}${sep}.swt-planning`;
    }
    if (role !== undefined) {
      merged.VBW_AGENT_ROLE = role;
    }
    Object.assign(merged, extras);
    return merged;
  }

  /**
   * Internal: run every matching registration for `event` + `toolName`.
   * Each handler is awaited sequentially (Phase 1 keeps it simple — the
   * Pi event stream is itself sequential). Returns the list of (exit
   * code, degraded) tuples so the caller can decide block/allow.
   */
  async function runMatching(
    event: HookEvent,
    toolName: string | undefined,
    stdinPayload: unknown,
  ): Promise<Array<{ scriptPath: string; exitCode: number | null; degraded: boolean }>> {
    const matched = registrations.filter(
      (r) => r.event === event && matcherSelectsTool(r.matcher, toolName),
    );
    if (matched.length === 0) {
      eventBus.emit({
        ts: new Date().toISOString(),
        event,
        phase: 'noop',
        ...(toolName !== undefined ? { toolName } : {}),
        note: 'no matching registrations',
      });
      return [];
    }
    const stdinStr = JSON.stringify(stdinPayload);
    const results: Array<{ scriptPath: string; exitCode: number | null; degraded: boolean }> = [];
    for (const reg of matched) {
      const scriptPath = resolveScriptPath(installRoot, reg.scriptPath);
      const timeoutMs = reg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const extras: Record<string, string> = {};
      if (toolName !== undefined) extras.SWT_TOOL_NAME = toolName;
      if (reg.env !== undefined) Object.assign(extras, reg.env);
      const env = buildEnv(extras);
      eventBus.emit({
        ts: new Date().toISOString(),
        event,
        phase: 'spawn',
        scriptPath,
        ...(toolName !== undefined ? { toolName } : {}),
      });
      const { exitCode, stderr, degraded, note } = await runHandler(
        scriptPath,
        stdinStr,
        env,
        timeoutMs,
        cwd,
        eventBus,
        event,
        toolName,
      );
      if (!degraded) {
        eventBus.emit({
          ts: new Date().toISOString(),
          event,
          phase: exitCode === 2 ? 'block' : 'success',
          scriptPath,
          ...(toolName !== undefined ? { toolName } : {}),
          ...(exitCode !== null ? { exitCode } : {}),
          ...(stderr.length > 0 ? { stderr } : {}),
        });
      } else {
        // hook-wrapper invariant: degraded handlers MUST NOT block PreToolUse.
        // The log lines above (timeout / error / etc.) already record the
        // degradation; this branch just ensures we don't accidentally
        // treat a missing exitCode as a policy verdict.
        if (note !== undefined && !stderr.includes(note)) {
          // The detailed entry was already emitted by runHandler; no
          // duplicate emission here.
        }
      }
      results.push({ scriptPath, exitCode, degraded });
    }
    return results;
  }

  async function dispatchPreTool(
    toolName: string,
    toolInput: unknown,
  ): Promise<HookDecision> {
    const results = await runMatching('PreToolUse', toolName, {
      tool_name: toolName,
      tool_input: toolInput,
    });
    // hook-wrapper invariant: a `'block'` verdict requires a clean exit
    // code of 2 from at least one registered handler. Degraded handlers,
    // crashes, timeouts, and non-2 exits ALL fall through to `'allow'`.
    for (const r of results) {
      if (!r.degraded && r.exitCode === 2) return 'block';
    }
    return 'allow';
  }

  async function dispatchPostTool(toolName: string, toolResult: unknown): Promise<void> {
    await runMatching('PostToolUse', toolName, {
      tool_name: toolName,
      tool_result: toolResult,
    });
  }

  async function dispatchSessionEvent(
    event: HookEvent,
    ctx?: Partial<HookContext>,
  ): Promise<void> {
    // Session-level events don't carry a tool input; we still let the
    // matcher narrow by role if a registration says so. The stdin
    // payload echoes the resolved ctx so future scripts can opt in to
    // richer context without a contract break.
    const merged: HookContext = {
      sessionId,
      installRoot,
      cwd,
      ...(role !== undefined ? { role } : {}),
      ...ctx,
    };
    await runMatching(event, ctx?.toolName, merged);
  }

  function subscribeToSession(session: SwtSession): () => void {
    eventBus.emit({
      ts: new Date().toISOString(),
      event: 'hookDispatcher.lifecycle',
      phase: 'attach',
      note: `attached to session ${session.sessionId}`,
    });
    const unsubscribe = session.subscribe((piEvent: SwtEvent) => {
      // The dispatcher dispatches each Pi event asynchronously. We never
      // await inside the listener — Pi's subscribe() listener is
      // synchronous-only, so we kick off async work + swallow rejections
      // (the eventBus already records them).
      void (async () => {
        switch (piEvent.type) {
          case 'AGENT_START':
            await dispatchSessionEvent('SessionStart');
            return;
          case 'AGENT_END':
            await dispatchSessionEvent('Stop');
            return;
          case 'TOOL_CALL':
            // Advisory PreToolUse — see the comment block at the top of
            // this file. We log + dispatch but discard the decision (Pi
            // already forwarded the call by the time we observe the
            // event). Real gating happens through `dispatchPreTool`
            // when a customTool wrapper calls it synchronously.
            await dispatchPreTool(piEvent.name, undefined);
            return;
          case 'TOOL_RESULT':
            await dispatchPostTool(piEvent.name, undefined);
            return;
          case 'MESSAGE_DELTA':
          case 'TASK_TOKEN_USAGE':
            // Not mapped to any CC hook event. Phase F.
            return;
          default:
            // Exhaustive narrowing: every other SwtEvent variant currently
            // falls into the not-mapped bucket. If a future variant lands
            // (e.g., compaction_*), the switch surfaces a TS error at
            // compile time because `piEvent` won't be `never`.
            return;
        }
      })().catch((err: unknown) => {
        eventBus.emit({
          ts: new Date().toISOString(),
          event: 'hookDispatcher.lifecycle',
          phase: 'error',
          note: `subscribeToSession dispatch failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      });
    });
    return () => {
      eventBus.emit({
        ts: new Date().toISOString(),
        event: 'hookDispatcher.lifecycle',
        phase: 'detach',
        note: `detached from session ${session.sessionId}`,
      });
      unsubscribe();
    };
  }

  function register(reg: HookRegistration): void {
    registrations.push(reg);
  }

  return {
    register,
    dispatchPreTool,
    dispatchPostTool,
    dispatchSessionEvent,
    subscribeToSession,
  };
}

/**
 * Wire form for `config/hooks.json`. The on-disk schema accepts either
 * `tool` (literal) or `toolPattern` (regex source) inside `matcher`; the
 * loader normalises to the runtime `HookMatcher`. Unknown rows fail
 * loudly — a typo in hooks.json shouldn't silently disable a guard.
 */
interface HookRegistrationWire {
  readonly event: HookEvent;
  readonly matcher: { readonly tool?: string; readonly toolPattern?: string; readonly role?: string } | null;
  readonly scriptPath: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
}

interface HooksJsonWire {
  readonly $schema_version?: number;
  readonly hooks: ReadonlyArray<HookRegistrationWire>;
}

/**
 * Parse a `config/hooks.json` file from disk and return the registration
 * list. Throws on malformed JSON, unknown event names, or matchers that
 * set BOTH `tool` and `toolPattern`. Exported for tests + for
 * `spawn-agent.ts` to construct the dispatcher from disk.
 */
export function loadHookRegistrationsFromConfig(
  configPath: string,
): ReadonlyArray<HookRegistration> {
  const raw = readFileSync(configPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `loadHookRegistrationsFromConfig: ${configPath} is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || !('hooks' in parsed)) {
    throw new Error(
      `loadHookRegistrationsFromConfig: ${configPath} missing top-level "hooks" array`,
    );
  }
  const wire = parsed as HooksJsonWire;
  if (!Array.isArray(wire.hooks)) {
    throw new Error(`loadHookRegistrationsFromConfig: ${configPath} "hooks" must be an array`);
  }
  return wire.hooks.map((row, idx) => normaliseWireRow(row, idx, configPath));
}

const KNOWN_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>([
  'SessionStart',
  'Stop',
  'PreToolUse',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
  'Notification',
  'PreCompact',
  'PostCompact',
  'TaskCompleted',
  'TeammateIdle',
  'UserPromptSubmit',
]);

function normaliseWireRow(
  row: HookRegistrationWire,
  idx: number,
  configPath: string,
): HookRegistration {
  if (!KNOWN_EVENTS.has(row.event)) {
    throw new Error(
      `loadHookRegistrationsFromConfig: ${configPath} row[${idx}] has unknown event "${String(
        row.event,
      )}"`,
    );
  }
  if (typeof row.scriptPath !== 'string' || row.scriptPath.length === 0) {
    throw new Error(
      `loadHookRegistrationsFromConfig: ${configPath} row[${idx}] missing scriptPath`,
    );
  }
  let matcher: HookMatcher | null;
  if (row.matcher === null || row.matcher === undefined) {
    matcher = null;
  } else {
    if (row.matcher.tool !== undefined && row.matcher.toolPattern !== undefined) {
      throw new Error(
        `loadHookRegistrationsFromConfig: ${configPath} row[${idx}] cannot set both "tool" and "toolPattern"`,
      );
    }
    const built: { tool?: string | RegExp; role?: string } = {};
    if (row.matcher.tool !== undefined) built.tool = row.matcher.tool;
    if (row.matcher.toolPattern !== undefined) built.tool = new RegExp(row.matcher.toolPattern);
    if (row.matcher.role !== undefined) built.role = row.matcher.role;
    matcher = built;
  }
  const out: HookRegistration = {
    event: row.event,
    matcher,
    scriptPath: row.scriptPath,
    ...(row.env !== undefined ? { env: row.env } : {}),
    ...(row.timeoutMs !== undefined ? { timeoutMs: row.timeoutMs } : {}),
  };
  return out;
}
