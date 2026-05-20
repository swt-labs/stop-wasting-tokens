import { parseArgs } from 'node:util';

export interface ParsedArgv {
  /** First positional argument — the verb (e.g. "config"). */
  readonly verb: string | undefined;
  /** Remaining positional arguments after the verb. */
  readonly positionals: readonly string[];
  /**
   * Parsed flag values keyed by flag name (without the leading --).
   *
   * The `string[]` branch is for Node's `parseArgs` native repeatable
   * shape (declared via `multiple: true`). Plan 03-01 T4 adds the first
   * such flag (`--filter`), but the type accepts arrays uniformly so
   * downstream consumers don't need a special case at the call site.
   * Boolean flags + single-occurrence string flags continue to land on
   * the `string | boolean | undefined` branches as before.
   */
  readonly flags: Readonly<Record<string, string | string[] | boolean | undefined>>;
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
      // swt update: --check skips the auto-apply (just print, like the
      // pre-2.0.2 behavior). Default behavior is now to actually run
      // the upgrade via the user's package manager.
      check: { type: 'boolean', default: false },
      'no-marketplace': { type: 'boolean', default: false },
      port: { type: 'string' },
      host: { type: 'string' },
      'unsafe-public': { type: 'boolean', default: false },
      'no-open': { type: 'boolean', default: false },
      debug: { type: 'boolean', default: false },
      // detect-phase --bash-format: emit key=value lines instead of JSON.
      // Without this entry parseArgs (strict) rejects the flag before the
      // handler can see it.
      'bash-format': { type: 'boolean', default: false },
      // swt init [<name>] [--description "..."]: scaffold .swt-planning/.
      description: { type: 'string' },
      // swt init --skip-lead: scaffold-only, bypass the Lead spawn step that
      // commands/init.md drives. Used by CI smoke tests and snapshot fixtures
      // that don't have an LLM available. Plan 03-03 T5 (REQ-13).
      'skip-lead': { type: 'boolean', default: false },
      // swt init --skip-scaffold: bypass the scaffold step (initProject) and
      // run the Lead step only. Used by the dashboard's /api/init route
      // (Phase 02 of milestone 08) which has already scaffolded the
      // .swt-planning/ dir synchronously before spawning the subprocess —
      // without this flag the subprocess would re-invoke initProject() and
      // crash on AlreadyInitializedError. The two flags are mutually
      // exclusive: --skip-lead + --skip-scaffold together would be a no-op.
      'skip-scaffold': { type: 'boolean', default: false },
      // swt bench [--fixture <name>] [--provider <name>] [--cassettes <path>]
      // [--output <file>] [--milestone <id>]: TPAC reference benchmark.
      // Per M2 PR-21 / TDD2 §3.2 + §14.9.
      fixture: { type: 'string' },
      provider: { type: 'string' },
      cassettes: { type: 'string' },
      output: { type: 'string' },
      milestone: { type: 'string' },
      // swt cook mode flags — Plan 03-02 T3. The cook handler detects these
      // and routes to the matching `commands/cook.md` mode section. They
      // are mutually exclusive in practice — the handler picks the first
      // match in the order Plan 03-02 documents (`--plan` wins, then
      // `--execute`, etc.). `--plan` is a string (carries an optional NN
      // phase target) to keep parity with `--plan=NN`; the cook handler
      // also accepts a bare `--plan` (no value) as flag-only mode.
      execute: { type: 'boolean', default: false },
      discuss: { type: 'boolean', default: false },
      assumptions: { type: 'boolean', default: false },
      scope: { type: 'boolean', default: false },
      add: { type: 'string' },
      insert: { type: 'string' },
      remove: { type: 'string' },
      verify: { type: 'boolean', default: false },
      archive: { type: 'boolean', default: false },
      // swt migrate --to=v3 --input <v2-dir> --output <v3-dir>: v2→v3
      // planning-tree migration. Plan 06-04 T1 (REQ-19).
      to: { type: 'string' },
      input: { type: 'string' },
      // Plan 15-02-01 T3 — `swt todo` optional flags. `--detail` is the
      // longer context written to the sidecar `.swt-planning/todo-details.json`;
      // `--phase` adds a `(phase:NN)` STATE.md annotation; `--files` is a
      // comma-separated path list persisted in the sidecar; `--priority`
      // adds a `(priority:X)` annotation (enum: high|medium|low validated
      // in the handler); `--assignee` adds an `(assignee:USER)` annotation.
      // `description` was already declared for `swt init --description`
      // and is reused by callers who prefer it — `swt todo` uses its
      // FIRST positional for the description so the init reuse is safe.
      detail: { type: 'string' },
      phase: { type: 'string' },
      files: { type: 'string' },
      priority: { type: 'string' },
      assignee: { type: 'string' },
      // Plan 03-01 T4 — `swt list-todos --filter key=value` repeatable
      // string. Node's `parseArgs` native `multiple: true` shape:
      // `parsed.flags.filter` lands as `string[] | undefined`. Multiple
      // occurrences combine with AND in the handler.
      filter: { type: 'string', multiple: true },
      // Plan 15-04-01 — `swt cook --todo N` escape hatch (snapshot pickup
      // bypassing freshness + filter guards). The handler does numeric
      // validation; the argv layer stays type-uniform.
      todo: { type: 'string' },
      // alpha.40 — `swt doctor --auth` credential-triage diagnostic (per
      // keychain_improvements.md §2.1). When present, the doctor command
      // prints keychain entries + config.json auth/providers blocks +
      // resolveActiveProvider output instead of the regular Node/Pi check.
      auth: { type: 'boolean', default: false },
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
