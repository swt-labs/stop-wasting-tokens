import type { ExitCode } from './exit-codes.js';
import { EXIT } from './exit-codes.js';
import type { ParsedArgv } from './argv.js';

export interface CommandIO {
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  readonly cwd: string;
}

export type CommandHandler = (
  parsed: ParsedArgv,
  io: CommandIO,
) => Promise<ExitCode> | ExitCode;

export interface CommandSpec {
  readonly name: string;
  readonly description: string;
  readonly handler: CommandHandler;
  /** Optional usage line shown by `swt help`. */
  readonly usage?: string;
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandSpec>();

  register(spec: CommandSpec): this {
    if (this.commands.has(spec.name)) {
      throw new Error(`Duplicate command registration: ${spec.name}`);
    }
    this.commands.set(spec.name, spec);
    return this;
  }

  get(name: string): CommandSpec | undefined {
    return this.commands.get(name);
  }

  list(): readonly CommandSpec[] {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

export async function dispatch(
  registry: CommandRegistry,
  parsed: ParsedArgv,
  io: CommandIO,
): Promise<ExitCode> {
  if (parsed.verb === undefined) {
    return EXIT.USAGE_ERROR;
  }
  const spec = registry.get(parsed.verb);
  if (spec === undefined) {
    io.stderr.write(`swt: unknown command "${parsed.verb}"\n`);
    io.stderr.write(`Run \`swt help\` for the list of commands.\n`);
    return EXIT.USAGE_ERROR;
  }
  return Promise.resolve(spec.handler(parsed, io));
}
