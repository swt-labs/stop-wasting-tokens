import { parseArgs } from 'node:util';

export interface ParsedArgv {
  /** First positional argument — the verb (e.g. "config"). */
  readonly verb: string | undefined;
  /** Remaining positional arguments after the verb. */
  readonly positionals: readonly string[];
  /** Parsed flag values keyed by flag name (without the leading --). */
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
}

/**
 * Parse argv with SWT's global flag set. Unknown flags throw — callers can
 * catch and route to usage errors.
 */
export function parseSwtArgv(argv: readonly string[]): ParsedArgv {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      effort: { type: 'string' },
      'skip-qa': { type: 'boolean', default: false },
      'skip-audit': { type: 'boolean', default: false },
      yolo: { type: 'boolean', default: false },
      plan: { type: 'string' },
      json: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      registry: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const verb = positionals.length > 0 ? positionals[0] : undefined;
  const rest = positionals.slice(1);

  return {
    verb,
    positionals: rest,
    flags: values,
  };
}
