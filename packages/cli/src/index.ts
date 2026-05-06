export const PACKAGE_NAME = '@swt-labs/cli';
export const VERSION = '0.0.0';

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(
      [
        'swt — stop-wasting-tokens',
        '',
        'Usage:',
        '  swt <command> [options]',
        '',
        'This is an alpha pre-release. Command surface is not yet implemented.',
        'See https://github.com/swt-labs/stop-wasting-tokens/blob/main/.vbw-planning/ROADMAP.md',
        '',
      ].join('\n'),
    );
    return 0;
  }
  process.stderr.write(`swt: command "${argv[0]}" not implemented yet\n`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  process.exit(main());
}
