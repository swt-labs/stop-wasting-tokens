import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createHookDispatcher,
  type HookDispatcher,
  type HookEventBus,
  type HookEventBusEntry,
  type HookRegistration,
} from '../../src/hooks/index.js';

/**
 * Plan 01-03 (Phase 1) Task 4 — dispatcher contract + hook-wrapper invariant.
 *
 * The seven assertions per the plan's verify block:
 *   1. Script exits 0 + PreToolUse → dispatchPreTool resolves 'allow'.
 *   2. Script exits 2 + PreToolUse → dispatchPreTool resolves 'block'.
 *   3. Script sleeps past timeoutMs + PreToolUse → resolves 'allow'
 *      (hook-wrapper invariant) AND an error/timeout event is appended
 *      to the mock eventBus.
 *   4. Script has a syntax error + PreToolUse → resolves 'allow' (NOT
 *      'block' — only a clean exit-2 counts as a policy block).
 *   5. Script reads stdin and writes the parsed JSON to a sentinel file →
 *      dispatcher passed {tool_name, tool_input} on stdin correctly.
 *   6. PostToolUse with no matching registration → resolves immediately,
 *      no spawn.
 *   7. SubagentStart → spawns the registered script with SWT_INSTALL_ROOT
 *      + SWT_SESSION_ID in env.
 *
 * Test approach: a per-test temp directory containing real inline bash
 * scripts. Spawning the actual bash binary is the most reliable way to
 * assert the hook-wrapper contract; mocking child_process would prove
 * nothing about real-world script behaviour.
 */

interface RecordingBus extends HookEventBus {
  entries: HookEventBusEntry[];
}

function makeRecordingBus(): RecordingBus {
  const entries: HookEventBusEntry[] = [];
  return {
    entries,
    emit(entry) {
      entries.push(entry);
    },
  };
}

const SESSION_ID = 'test-session-aaaa-bbbb-cccc';

describe('@swt-labs/runtime — HookDispatcher (Plan 01-03 T4)', () => {
  let tmpRoot: string;
  let installRoot: string;
  let cwd: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'swt-hook-dispatcher-test-'));
    installRoot = join(tmpRoot, 'install');
    cwd = join(tmpRoot, 'work');
    writeFileSync(join(tmpRoot, 'install.placeholder'), '');
    // Provide install / cwd dirs the dispatcher will pass to child env.
    // Both already exist because mkdtempSync created tmpRoot; we just
    // need them as directories.
    mkdirSync(installRoot, { recursive: true });
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeScript(name: string, body: string): string {
    const scriptPath = join(installRoot, name);
    writeFileSync(scriptPath, body, { mode: 0o755 });
    chmodSync(scriptPath, 0o755);
    return scriptPath;
  }

  function makeDispatcher(
    registrations: ReadonlyArray<HookRegistration>,
    bus: RecordingBus = makeRecordingBus(),
  ): { dispatcher: HookDispatcher; bus: RecordingBus } {
    const dispatcher = createHookDispatcher({
      registrations,
      installRoot,
      sessionId: SESSION_ID,
      cwd,
      eventBus: bus,
    });
    return { dispatcher, bus };
  }

  it('1) Script exits 0 + PreToolUse → dispatchPreTool resolves "allow"', async () => {
    const scriptPath = writeScript('pretool-allow.sh', '#!/bin/bash\nexit 0\n');
    const { dispatcher } = makeDispatcher([
      {
        event: 'PreToolUse',
        matcher: { tool: 'Bash' },
        scriptPath,
        timeoutMs: 3000,
      },
    ]);
    const decision = await dispatcher.dispatchPreTool('Bash', { command: 'ls' });
    expect(decision).toBe('allow');
  });

  it('2) Script exits 2 + PreToolUse → dispatchPreTool resolves "block"', async () => {
    const scriptPath = writeScript(
      'pretool-block.sh',
      '#!/bin/bash\necho "policy deny" >&2\nexit 2\n',
    );
    const { dispatcher, bus } = makeDispatcher([
      {
        event: 'PreToolUse',
        matcher: { tool: 'Bash' },
        scriptPath,
        timeoutMs: 3000,
      },
    ]);
    const decision = await dispatcher.dispatchPreTool('Bash', { command: 'rm -rf /' });
    expect(decision).toBe('block');
    // The bus should have recorded a 'block' phase entry.
    expect(bus.entries.some((e) => e.phase === 'block' && e.exitCode === 2)).toBe(true);
  });

  it('3) Script sleeps past timeoutMs + PreToolUse → "allow" + timeout logged', async () => {
    const scriptPath = writeScript('pretool-sleep.sh', '#!/bin/bash\nsleep 5\nexit 0\n');
    const { dispatcher, bus } = makeDispatcher([
      {
        event: 'PreToolUse',
        matcher: { tool: 'Bash' },
        scriptPath,
        timeoutMs: 200, // hard ceiling well below the script's sleep
      },
    ]);
    const decision = await dispatcher.dispatchPreTool('Bash', { command: 'ls' });
    // hook-wrapper invariant: a timed-out handler does NOT block — it
    // degrades to 'allow' and a timeout entry is logged through the bus.
    expect(decision).toBe('allow');
    expect(
      bus.entries.some((e) => e.phase === 'timeout' && (e.note ?? '').includes('timeout')),
    ).toBe(true);
  });

  it('4) Script has a syntax error + PreToolUse → "allow" (not "block")', async () => {
    // A bash file with an unclosed `if` is a syntax error; bash exits
    // 2 ONLY when the SCRIPT explicitly does `exit 2`. A parse-time
    // failure may exit with code 2 on some bash versions — the
    // hook-wrapper invariant says we should not honour it, because it's
    // not a *valid policy* exit-2 from a script that ran to completion.
    //
    // To make this assertion robust across bash versions, we use a
    // command-not-found pattern: bash exits 127 for unknown commands,
    // which is unambiguously a degraded result (not policy exit-2).
    const scriptPath = writeScript(
      'pretool-syntax-err.sh',
      '#!/bin/bash\n__definitely_not_a_real_command_xyz_swt_test__\n',
    );
    const { dispatcher, bus } = makeDispatcher([
      {
        event: 'PreToolUse',
        matcher: { tool: 'Bash' },
        scriptPath,
        timeoutMs: 3000,
      },
    ]);
    const decision = await dispatcher.dispatchPreTool('Bash', { command: 'ls' });
    expect(decision).toBe('allow');
    // The bus should have a 'success' entry with the non-zero exit code
    // (127 for command-not-found) — but importantly, NOT a 'block'.
    expect(bus.entries.some((e) => e.phase === 'block')).toBe(false);
    expect(bus.entries.some((e) => e.phase === 'success' && e.exitCode !== 2)).toBe(true);
  });

  it('5) Dispatcher passes {tool_name, tool_input} on stdin (sentinel-file echo)', async () => {
    const sentinel = join(cwd, 'sentinel.json');
    const scriptPath = writeScript(
      'pretool-echo-stdin.sh',
      `#!/bin/bash\ncat > ${JSON.stringify(sentinel)}\nexit 0\n`,
    );
    const { dispatcher } = makeDispatcher([
      {
        event: 'PreToolUse',
        matcher: { tool: 'Bash' },
        scriptPath,
        timeoutMs: 3000,
      },
    ]);
    await dispatcher.dispatchPreTool('Bash', { command: 'echo hi' });
    const written = readFileSync(sentinel, 'utf8');
    const parsed = JSON.parse(written) as { tool_name: string; tool_input: { command: string } };
    expect(parsed.tool_name).toBe('Bash');
    expect(parsed.tool_input).toEqual({ command: 'echo hi' });
  });

  it('6) PostToolUse with no matching registration → resolves, no spawn', async () => {
    // Register a hook for SubagentStart only — PostToolUse has zero
    // matching registrations.
    const scriptPath = writeScript('subagent-start-only.sh', '#!/bin/bash\nexit 0\n');
    const { dispatcher, bus } = makeDispatcher([
      {
        event: 'SubagentStart',
        matcher: null,
        scriptPath,
        timeoutMs: 3000,
      },
    ]);
    await dispatcher.dispatchPostTool('Bash', { ok: true });
    // No spawn entries.
    expect(bus.entries.some((e) => e.phase === 'spawn')).toBe(false);
    // Bus should record a 'noop' marker so callers can audit empty
    // dispatches (helpful for "are my hooks wired?" debugging).
    expect(bus.entries.some((e) => e.phase === 'noop' && e.event === 'PostToolUse')).toBe(true);
  });

  it('7) SubagentStart → spawns registered script with SWT_INSTALL_ROOT + SWT_SESSION_ID in env', async () => {
    const sentinel = join(cwd, 'env-sentinel.json');
    // The script writes a small JSON object capturing the env vars the
    // dispatcher is supposed to inject. We then read + assert.
    const scriptPath = writeScript(
      'subagent-start-env.sh',
      `#!/bin/bash\nprintf '{"install_root":"%s","session_id":"%s","tool_name":"%s"}' \
"$SWT_INSTALL_ROOT" "$SWT_SESSION_ID" "$SWT_TOOL_NAME" > ${JSON.stringify(sentinel)}\nexit 0\n`,
    );
    const { dispatcher } = makeDispatcher([
      {
        event: 'SubagentStart',
        matcher: null,
        scriptPath,
        timeoutMs: 3000,
      },
    ]);
    await dispatcher.dispatchSessionEvent('SubagentStart', { role: 'dev' });
    const written = readFileSync(sentinel, 'utf8');
    const parsed = JSON.parse(written) as {
      install_root: string;
      session_id: string;
      tool_name: string;
    };
    expect(parsed.install_root).toBe(installRoot);
    expect(parsed.session_id).toBe(SESSION_ID);
    // SubagentStart does not bind a tool_name; the env var should be empty.
    expect(parsed.tool_name).toBe('');
  });

  it('register() adds a new registration that subsequent dispatches honour', async () => {
    const blockScriptPath = writeScript('late-register-block.sh', '#!/bin/bash\nexit 2\n');
    const { dispatcher } = makeDispatcher([]);
    // No registrations → allow.
    expect(await dispatcher.dispatchPreTool('Bash', { command: 'ls' })).toBe('allow');
    dispatcher.register({
      event: 'PreToolUse',
      matcher: { tool: 'Bash' },
      scriptPath: blockScriptPath,
      timeoutMs: 3000,
    });
    // After register → block.
    expect(await dispatcher.dispatchPreTool('Bash', { command: 'ls' })).toBe('block');
  });

  it('regex matcher (compiled from toolPattern) gates on /Write|Edit/', async () => {
    const blockScriptPath = writeScript('regex-block.sh', '#!/bin/bash\nexit 2\n');
    const { dispatcher } = makeDispatcher([
      {
        event: 'PreToolUse',
        matcher: { tool: /^(Write|Edit|MultiEdit)$/ },
        scriptPath: blockScriptPath,
        timeoutMs: 3000,
      },
    ]);
    // Matching tool → block.
    expect(await dispatcher.dispatchPreTool('Write', { file_path: '/etc/passwd' })).toBe('block');
    expect(await dispatcher.dispatchPreTool('Edit', { file_path: 'foo' })).toBe('block');
    // Non-matching tool → allow (no registrations selected).
    expect(await dispatcher.dispatchPreTool('Bash', { command: 'ls' })).toBe('allow');
  });

  it('multiple PreToolUse handlers: any clean exit-2 yields "block"', async () => {
    const allowScriptPath = writeScript('multi-allow.sh', '#!/bin/bash\nexit 0\n');
    const blockScriptPath = writeScript('multi-block.sh', '#!/bin/bash\nexit 2\n');
    const { dispatcher } = makeDispatcher([
      {
        event: 'PreToolUse',
        matcher: { tool: 'Bash' },
        scriptPath: allowScriptPath,
        timeoutMs: 3000,
      },
      {
        event: 'PreToolUse',
        matcher: { tool: 'Bash' },
        scriptPath: blockScriptPath,
        timeoutMs: 3000,
      },
    ]);
    expect(await dispatcher.dispatchPreTool('Bash', { command: 'rm -rf /' })).toBe('block');
  });

  it('hook-wrapper invariant: missing script path → "allow" + error logged (no throw)', async () => {
    const { dispatcher, bus } = makeDispatcher([
      {
        event: 'PreToolUse',
        matcher: { tool: 'Bash' },
        scriptPath: join(installRoot, 'does-not-exist.sh'),
        timeoutMs: 3000,
      },
    ]);
    // bash with a missing script exits 127 (file not found). That's
    // NOT a policy exit-2, so the dispatcher degrades to 'allow'.
    const decision = await dispatcher.dispatchPreTool('Bash', { command: 'ls' });
    expect(decision).toBe('allow');
    // We should NOT have crashed; the bus has a success entry with a
    // non-zero exit code recording the failure mode.
    expect(bus.entries.some((e) => e.phase === 'block')).toBe(false);
  });
});
