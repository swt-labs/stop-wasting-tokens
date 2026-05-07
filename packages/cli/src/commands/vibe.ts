import { join } from 'node:path';

import { ClaudeCodeAgentSpawner } from '@swt-labs/claude-code-driver';
import { CodexAgentSpawner } from '@swt-labs/codex-driver';
import type { AgentRole, AgentSpawner } from '@swt-labs/core';
import {
  allDoneHandler,
  archiveHandler,
  bootstrapHandler,
  buildVibeRegistry,
  DEFAULT_BOOTSTRAP_RESOLVER,
  DEFAULT_SCOPE_RESOLVER,
  detectPhase,
  executeHandler,
  getBundledAgentTemplatesDir,
  LazyInstallSpawner,
  loadSwtConfig,
  milestoneUatRecoveryHandler,
  NotImplementedError,
  planAndExecuteHandler,
  qaHandler,
  resolveAgentSpec,
  reVerifyHandler,
  RoutingError,
  routeFromState,
  scopeHandler,
  verifyHandler,
  type RouteArgs,
  type VibeRoute,
} from '@swt-labs/methodology';
import { OllamaAgentSpawner } from '@swt-labs/ollama-driver';

import { EXIT, type ExitCode } from '../exit-codes.js';
import { ReadlinePrompter } from '../prompters/readline.js';
import type { CommandHandler, CommandIO } from '../router.js';

export const vibeHandler: CommandHandler = async (parsed, io: CommandIO): Promise<ExitCode> => {
  const args = mapFlagsToRouteArgs(parsed.flags, parsed.positionals);

  let state;
  try {
    state = await detectPhase({ cwd: io.cwd });
  } catch (err) {
    io.stderr.write(`swt vibe: detectPhase failed: ${formatError(err)}\n`);
    return EXIT.USAGE_ERROR;
  }

  let route: VibeRoute;
  try {
    route = routeFromState(state, args);
  } catch (err) {
    if (err instanceof RoutingError) {
      io.stderr.write(`swt vibe: ${err.message}\n`);
      io.stderr.write(`${JSON.stringify(err.context, null, 2)}\n`);
      return EXIT.USAGE_ERROR;
    }
    throw err;
  }

  io.stdout.write(formatRouteBanner(route));

  if (route.kind === 'init-redirect') {
    io.stderr.write(
      'No SWT project here. Run `swt init` to bootstrap (.swt-planning/ is missing).\n',
    );
    return EXIT.USAGE_ERROR;
  }

  const isInteractive = Boolean((process.stdin as unknown as { isTTY?: boolean }).isTTY);
  const prompter = isInteractive && args.yolo !== true ? new ReadlinePrompter() : undefined;

  const verifyOpts = prompter !== undefined ? { prompter } : {};
  const milestoneOpts =
    prompter !== undefined
      ? { prompter }
      : args.yolo === true
        ? { forceDecision: 'create-remediation' as const }
        : {};

  const archiveOpts: { skipAudit?: boolean; force?: boolean } = {};
  if (args.skipAudit === true) archiveOpts.skipAudit = true;

  const bootstrapOpts =
    prompter !== undefined ? { resolve: DEFAULT_BOOTSTRAP_RESOLVER, prompter } : undefined;
  const scopeOpts =
    prompter !== undefined ? { resolve: DEFAULT_SCOPE_RESOLVER, prompter } : undefined;

  const planningDir = join(io.cwd, '.swt-planning');
  const config = await loadSwtConfig(planningDir);
  const templatesDir = getBundledAgentTemplatesDir();
  const backend = resolveBackend(parsed.flags.backend, config.backend);
  let baseSpawner: AgentSpawner;
  switch (backend) {
    case 'codex':
      baseSpawner = new CodexAgentSpawner();
      break;
    case 'claude-code':
      baseSpawner = new ClaudeCodeAgentSpawner();
      break;
    case 'ollama':
      baseSpawner = new OllamaAgentSpawner();
      break;
  }
  io.stdout.write(`◆ Backend: ${backend}\n\n`);
  const spawner = new LazyInstallSpawner(baseSpawner, (role: AgentRole) =>
    resolveAgentSpec({ role, config, templates_dir: templatesDir }),
  );
  const devSpec = await resolveAgentSpec({
    role: 'dev',
    config,
    templates_dir: templatesDir,
  });

  const registry = buildVibeRegistry([
    bootstrapOpts !== undefined ? bootstrapHandler(bootstrapOpts) : bootstrapHandler(),
    scopeOpts !== undefined ? scopeHandler(scopeOpts) : scopeHandler(),
    planAndExecuteHandler(),
    executeHandler({ spawner, devSpec }),
    qaHandler(),
    verifyHandler(verifyOpts),
    reVerifyHandler(),
    milestoneUatRecoveryHandler(milestoneOpts),
    archiveHandler(archiveOpts),
    allDoneHandler(),
  ]);
  try {
    const result = await registry.dispatch(route, {
      cwd: io.cwd,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    return result.exit;
  } catch (err) {
    if (err instanceof NotImplementedError) {
      io.stderr.write(
        `Route resolved → ${err.mode}\n` +
          `Not yet implemented in this build (${err.roadmap_pointer}).\n` +
          `Run \`swt detect-phase\` to inspect the underlying state.\n`,
      );
      return EXIT.NOT_IMPLEMENTED;
    }
    throw err;
  } finally {
    await spawner.cleanup();
  }
};

function mapFlagsToRouteArgs(
  flags: Readonly<Record<string, string | boolean | undefined>>,
  positionals: readonly string[],
): RouteArgs {
  const out: { -readonly [K in keyof RouteArgs]: RouteArgs[K] } = {};
  if (typeof flags.effort === 'string') {
    if (
      flags.effort === 'thorough' ||
      flags.effort === 'balanced' ||
      flags.effort === 'fast' ||
      flags.effort === 'turbo'
    ) {
      out.effort = flags.effort;
    }
  }
  if (flags.yolo === true) out.yolo = true;
  if (flags['skip-qa'] === true) out.skipQa = true;
  if (flags['skip-audit'] === true) out.skipAudit = true;
  if (typeof flags.plan === 'string') out.phase = flags.plan;
  // Positional integer is interpreted as a phase number.
  for (const positional of positionals) {
    if (/^\d{1,2}$/.test(positional) && out.phase === undefined) {
      out.phase = positional.padStart(2, '0');
    }
  }
  return out;
}

function formatRouteBanner(route: VibeRoute): string {
  const lines: string[] = [];
  lines.push(`◆ Route: ${route.kind}`);
  if (route.phase !== undefined) lines.push(`  Phase: ${route.phase}`);
  if (route.phase_slug !== undefined) lines.push(`  Slug: ${route.phase_slug}`);
  if (route.kind === 'verify') {
    lines.push(`  QA pending: ${route.qa_pending ? 'yes' : 'no'}`);
    if (route.qa_pending_reason !== undefined) {
      lines.push(`  QA reason: ${route.qa_pending_reason}`);
    }
  }
  if (route.reason !== undefined) lines.push(`  Reason: ${route.reason}`);
  lines.push('');
  return lines.join('\n');
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Backend = 'codex' | 'claude-code' | 'ollama';

function resolveBackend(flag: string | boolean | undefined, configBackend: Backend): Backend {
  if (
    typeof flag === 'string' &&
    (flag === 'codex' || flag === 'claude-code' || flag === 'ollama')
  ) {
    return flag;
  }
  return configBackend;
}
