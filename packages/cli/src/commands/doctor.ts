import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { SpawnerEnvironment } from '@swt-labs/core';
import { resolveActiveProvider, resolveCredentialStore } from '@swt-labs/runtime';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

/**
 * Local shape kept compatible with the historical `CodexVersion` so the
 * `DoctorReport.codex` field still satisfies `DoctorReportSchema` in
 * `@swt-labs/shared`. PR-01b removes the `@swt-labs/codex-driver` import
 * that previously sourced this type; the runtime probe (PR-02+) populates the
 * field via `DoctorDeps.spawnerEnv` instead.
 */
export interface CodexVersionLike {
  readonly version: string;
}

/**
 * Pi peer-dep status surfaced from the runtime's `SpawnerEnvironment.probe()`.
 * When `available === true`, `version` carries the Pi peer-dep version (e.g.
 * `0.74.0`). When false, `reason` explains why (e.g. `pi peerDep missing`).
 * M2 PR-15 wired this through the doctor command so `swt doctor` makes the
 * Pi installation status visible at a glance.
 */
export interface PiStatusLike {
  readonly available: boolean;
  readonly name: string;
  readonly version?: string;
  readonly reason?: string;
}

export interface DoctorReport {
  readonly node: string;
  readonly codex: CodexVersionLike | undefined;
  readonly pi: PiStatusLike | undefined;
  readonly planningDirExists: boolean;
}

export interface DoctorDeps {
  readonly node?: () => string;
  readonly codex?: () => Promise<CodexVersionLike | undefined>;
  /** Override Pi probe (test seam). When omitted, derived from `spawnerEnv.probe()`. */
  readonly pi?: () => Promise<PiStatusLike | undefined>;
  readonly spawnerEnv?: SpawnerEnvironment;
  readonly stat?: (path: string) => Promise<unknown>;
}

const REQUIRED_NODE_MAJOR = 20;

export async function buildDoctorReport(cwd: string, deps: DoctorDeps = {}): Promise<DoctorReport> {
  const nodeFn = deps.node ?? ((): string => process.versions.node);
  // PR-01b: source-import edge to `@swt-labs/codex-driver` is broken. `deps.codex` stays
  // as the legacy test seam (tests in `cli/test/doctor.test.ts` exercise it); when neither
  // `codex` nor `spawnerEnv` is provided, the default returns `undefined` (i.e., no codex
  // detection from v3). When `spawnerEnv` is provided and its probe reports `name: 'codex'`,
  // its `version` field is surfaced as `codex.version` for dashboard-contract compatibility.
  const codexFn =
    deps.codex ??
    (async (): Promise<CodexVersionLike | undefined> => {
      if (deps.spawnerEnv === undefined) return undefined;
      const probe = await deps.spawnerEnv.probe();
      if (probe.available && probe.name === 'codex' && probe.version !== undefined) {
        return { version: probe.version };
      }
      return undefined;
    });
  // M2 PR-15: surface Pi peer-dep status from `spawnerEnv.probe()`. When the
  // probe reports `name: 'pi-*'`, lift it through to `report.pi`. Tests
  // override via `deps.pi` for deterministic output.
  const piFn =
    deps.pi ??
    (async (): Promise<PiStatusLike | undefined> => {
      if (deps.spawnerEnv === undefined) return undefined;
      const probe = await deps.spawnerEnv.probe();
      if (!probe.name.startsWith('pi-')) return undefined;
      return {
        available: probe.available,
        name: probe.name,
        ...(probe.version !== undefined ? { version: probe.version } : {}),
        ...(probe.reason !== undefined ? { reason: probe.reason } : {}),
      };
    });
  const statFn = deps.stat ?? ((p: string): Promise<unknown> => stat(p));
  const node = nodeFn();
  const codex = await codexFn();
  const pi = await piFn();
  let planningDirExists = false;
  try {
    await statFn(join(cwd, '.swt-planning'));
    planningDirExists = true;
  } catch {
    planningDirExists = false;
  }
  return { node, codex, pi, planningDirExists };
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push('SWT doctor:');
  const nodeMajor = parseInt(report.node.split('.')[0] ?? '0', 10);
  const nodeOk = nodeMajor >= REQUIRED_NODE_MAJOR;
  lines.push(
    `  ${nodeOk ? '✓' : '⚠'} Node ${report.node}${nodeOk ? '' : ` (need ≥ ${REQUIRED_NODE_MAJOR})`}`,
  );
  if (report.codex !== undefined) {
    lines.push(`  ✓ Codex CLI ${report.codex.version}`);
  } else {
    lines.push('  ⚠ Codex CLI not found on PATH');
  }
  if (report.pi !== undefined) {
    if (report.pi.available && report.pi.version !== undefined) {
      lines.push(`  ✓ Pi runtime ${report.pi.version} (${report.pi.name})`);
    } else {
      lines.push(
        `  ⚠ Pi runtime not available${report.pi.reason !== undefined ? ` — ${report.pi.reason}` : ''}`,
      );
    }
  }
  lines.push(
    report.planningDirExists
      ? '  ✓ .swt-planning/ present'
      : '  ⚠ .swt-planning/ missing — run `swt init`',
  );
  // alpha.22 — surface the Pi OAuth client_id. When the user hits the
  // Anthropic "out of extra usage" error on a valid Max-plan OAuth login,
  // this is the client_id Anthropic must add to their Max-plan-routing
  // allowlist. Copy-paste-ready for support thread evidence.
  lines.push('');
  lines.push('  Anthropic OAuth client_id (Pi):');
  lines.push('    9d1c250a-e61b-44d9-88ed-5944d1962f5e');
  lines.push('    (For Anthropic support: this is the OAuth client SWT/Pi authenticates as.');
  lines.push('     Until Anthropic allowlists it for Max-plan billing routing, OAuth requests');
  lines.push(
    '     hit the third-party "extra_usage" pool. API key is the recommended path today.)',
  );
  lines.push('');
  return lines.join('\n');
}

export function doctorHandler(deps: DoctorDeps = {}): CommandHandler {
  return async (parsed, io: CommandIO): Promise<ExitCode> => {
    // alpha.40 — `--auth` flag routes to the credential-triage diagnostic
    // (keychain_improvements.md §2.1). Resolves keychain entries +
    // config.json blocks + resolveActiveProvider output in one pass so
    // future "credentials forgotten" bug reports get triaged in seconds.
    if (parsed.flags['auth'] === true) {
      const text = await renderAuthDoctor(io.cwd);
      io.stdout.write(text);
      return EXIT.SUCCESS;
    }
    // Thread the io-supplied SpawnerEnvironment into deps if the caller hasn't already
    // overridden it (preserves test-injectable behavior; production wiring comes from main.ts).
    const finalDeps: DoctorDeps = {
      ...deps,
      ...(deps.spawnerEnv === undefined && io.spawnerEnv !== undefined
        ? { spawnerEnv: io.spawnerEnv }
        : {}),
    };
    const report = await buildDoctorReport(io.cwd, finalDeps);
    io.stdout.write(renderDoctorReport(report));
    return EXIT.SUCCESS;
  };
}

/**
 * alpha.40 — `swt doctor --auth` diagnostic per keychain_improvements.md §2.1.
 *
 * Surfaces the three layers credential persistence depends on, in one pass:
 *
 *   1. **Keychain** — every credential `swt` has written, with provider +
 *      authMode. The user's secret is NEVER printed, only the
 *      `(provider, authMode)` keys.
 *   2. **Config** — the `auth` and `providers.strategy` blocks from
 *      `.swt-planning/config.json`. These are the pointers from the config
 *      to the keychain entries.
 *   3. **Round-trip** — what `resolveActiveProvider` (the same helper the
 *      chat route + spawn path call) returns given the current config.
 *      Tells the user immediately whether the dashboard will see them as
 *      authed.
 *
 * The keychain is the truth; the config is the namer; the resolver is the
 * consumer. Any persistence bug surfaces as a mismatch between two of these
 * three rows.
 */
export async function renderAuthDoctor(cwd: string): Promise<string> {
  const lines: string[] = [];
  lines.push('SWT doctor — credential triage:');
  lines.push('');

  // 1. Keychain entries.
  lines.push('  Keychain entries (service=swt):');
  try {
    const { store, probe, backend } = await resolveCredentialStore();
    if (!probe.available) {
      lines.push(
        `    ⚠ Keychain unavailable — ${probe.reason ?? 'no reason reported'} (backend: ${backend})`,
      );
    } else {
      const refs = await store.list();
      if (refs.length === 0) {
        lines.push('    (none — no `swt` credentials have been written to this OS keychain)');
      } else {
        for (const ref of refs) {
          lines.push(`    ✓ ${ref.provider}:${ref.authMode}`);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lines.push(`    ⚠ Keychain probe failed: ${message}`);
  }
  lines.push('');

  // 2. Config blocks.
  lines.push(`  Project config (${join(cwd, '.swt-planning', 'config.json')}):`);
  const selection = resolveActiveProvider(cwd);
  const authProviders = Object.keys(selection.authConfig);
  if (authProviders.length === 0) {
    lines.push('    auth                  : (empty — no provider entries)');
  } else {
    for (const p of authProviders) {
      const entry = selection.authConfig[p];
      if (entry !== undefined) {
        lines.push(
          `    auth.${p.padEnd(15)} : { mode: "${entry.mode}", credentialRef: "${entry.credentialRef ?? `swt:${p}:${entry.mode}`}" }`,
        );
      }
    }
  }
  // Strategy: derived from the resolveActiveProvider source field.
  if (selection.source === 'pinned') {
    lines.push(`    providers.strategy    : { kind: "pinned", provider: "${selection.provider}" }`);
  } else if (selection.source === 'first-authed') {
    lines.push('    providers.strategy    : (not pinned — resolver falling back to first-authed)');
  } else {
    lines.push('    providers.strategy    : (not pinned, no auth entries)');
  }
  if (selection.model !== null) {
    lines.push(`    model                 : "${selection.model}"`);
  } else {
    lines.push('    model                 : (null — Pi default model for the provider)');
  }
  lines.push('');

  // 3. Round-trip — what the chat route + spawn path would see.
  lines.push('  Round-trip (what resolveActiveProvider returns):');
  if (selection.provider === null) {
    lines.push('    ✗ provider            : null — no credential will resolve');
  } else {
    lines.push(`    ✓ provider            : "${selection.provider}" (source: ${selection.source})`);
  }
  lines.push('');

  // 4. Status banner.
  const keychainPresent = await (async (): Promise<number> => {
    try {
      const { store } = await resolveCredentialStore();
      const refs = await store.list();
      return refs.length;
    } catch {
      return -1;
    }
  })();
  const configPresent = authProviders.length;
  if (keychainPresent > 0 && configPresent === 0) {
    lines.push(
      '  Status: ⚠ MISMATCH — keychain has credentials but config.json has no auth block.',
    );
    lines.push(
      '          Open the dashboard Provider menu and re-pin a provider to re-populate the config.',
    );
  } else if (keychainPresent === 0 && configPresent > 0) {
    lines.push(
      '  Status: ⚠ MISMATCH — config.json names credentials that are not in the keychain.',
    );
    lines.push('          Re-authenticate via the dashboard Provider menu.');
  } else if (keychainPresent > 0 && configPresent > 0 && selection.provider !== null) {
    lines.push('  Status: ✓ HEALTHY');
  } else {
    lines.push('  Status: — no credentials configured yet. Run the dashboard Provider menu.');
  }
  lines.push('');

  return lines.join('\n');
}
