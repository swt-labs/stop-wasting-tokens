import { EXIT, type ExitCode } from './exit-codes.js';
import type { CommandIO, CommandRegistry } from './router.js';

const GLOBAL_FLAGS = `
Global flags:
  --help, -h          Show help and exit
  --version, -v       Print version and exit
  --effort <level>    thorough | balanced | fast | turbo (overrides config)
  --skip-qa           Skip post-build QA
  --skip-audit        Skip non-UAT pre-archive audit checks
  --yolo              Skip all confirmation gates; auto-loop
  --plan <NN>         Execute a single plan instead of an entire wave
`.trim();

export function renderHelp(registry: CommandRegistry): string {
  const lines: string[] = [];
  lines.push('swt — stop-wasting-tokens');
  lines.push('');
  lines.push('Usage: swt <command> [options]');
  lines.push('');
  lines.push('Commands:');
  for (const cmd of registry.list()) {
    const usage = cmd.usage ?? '';
    const lhs = `  ${cmd.name}${usage.length > 0 ? ` ${usage}` : ''}`;
    lines.push(`${lhs.padEnd(28)}${cmd.description}`);
  }
  lines.push('');
  lines.push(GLOBAL_FLAGS);
  lines.push('');
  return lines.join('\n');
}

export function helpHandler(registry: CommandRegistry) {
  return (_parsed: unknown, io: CommandIO): ExitCode => {
    io.stdout.write(renderHelp(registry));
    return EXIT.SUCCESS;
  };
}
