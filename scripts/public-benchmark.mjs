#!/usr/bin/env node
/**
 * SWT v3 public benchmark aggregator per TDD2 §3.2 + §14.9 + Plan 06-01 PR-48.
 *
 * Walks `.swt-planning/.tpac/*.json` reports (committed after running
 * `swt bench --provider <p> --output <file>` for each provider) and emits
 * a markdown table for the project homepage.
 *
 * Per ADR-011, every number is reproducible from committed cassettes —
 * the script is just a presentation layer.
 *
 * Usage:
 *   pnpm public-benchmark            # default — reads .swt-planning/.tpac/
 *   pnpm public-benchmark --dir <p>  # override report directory
 *   pnpm public-benchmark --baseline m2-baseline.json  # custom baseline file
 *
 * Exit codes:
 *   0 — table emitted successfully (or empty-state notice if no reports)
 *   1 — invalid argument
 *   2 — baseline file present but unparseable
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';

const DEFAULT_DIR = '.swt-planning/.tpac';
const DEFAULT_BASELINE = 'm2-baseline.json';

function parseArgs(argv) {
  const args = { dir: DEFAULT_DIR, baseline: DEFAULT_BASELINE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' && argv[i + 1] !== undefined) {
      args.dir = argv[++i];
    } else if (a === '--baseline' && argv[i + 1] !== undefined) {
      args.baseline = argv[++i];
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function readReports(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return { reports: [], dirExists: false };
  }
  const reports = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    try {
      if (!statSync(path).isFile()) continue;
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw);
      reports.push({ name, ...parsed });
    } catch {
      // Skip unparseable files; the dashboard's TPAC route already
      // validates against the Zod schema. This aggregator is best-effort.
    }
  }
  return { reports, dirExists: true };
}

function fmtUsd(usd) {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return '—';
  if (Math.abs(usd) < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function fmtTokens(n) {
  if (typeof n !== 'number') return '—';
  return n.toLocaleString();
}

function fmtPercent(pct) {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function findBaseline(reports, baselineName) {
  // Strategy 1: a report named exactly the baseline file.
  const byName = reports.find((r) => r.name === baselineName);
  if (byName !== undefined) return byName;
  // Strategy 2: the M2 milestone report (oldest baseline).
  const m2 = reports.find((r) => r.milestone === 'M2');
  return m2;
}

function buildTable(reports, baseline) {
  if (reports.length === 0) {
    return [
      '## SWT v3 TPAC public benchmark',
      '',
      '_No reports yet. Run `swt bench --provider <p> --output .swt-planning/.tpac/<provider>.json` for each provider, then re-run this script._',
      '',
    ].join('\n');
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `## SWT v3 TPAC public benchmark — ${today}`,
    '',
    '| Provider | Milestone | TPAC (tokens/criterion) | Cost / criterion | Recorded |',
    '| -------- | --------- | ----------------------: | ---------------: | -------- |',
  ];

  // Sort: baseline first (when present), then by milestone ascending,
  // then by provider alphabetical.
  const sorted = [...reports].sort((a, b) => {
    if (baseline !== undefined) {
      if (a === baseline) return -1;
      if (b === baseline) return 1;
    }
    if (a.milestone !== b.milestone) return String(a.milestone).localeCompare(String(b.milestone));
    return String(a.provider).localeCompare(String(b.provider));
  });

  for (const r of sorted) {
    const providerLabel = r.model ? `${r.provider} (${r.model})` : r.provider;
    const costPerCriterion =
      typeof r.cost_usd === 'number' &&
      typeof r.criteria_satisfied === 'number' &&
      r.criteria_satisfied > 0
        ? r.cost_usd / r.criteria_satisfied
        : undefined;
    const tpac = fmtTokens(r.tokens_per_criterion);
    const recordedAt = typeof r.recorded_at === 'string' ? r.recorded_at.slice(0, 10) : '—';
    const delta =
      baseline !== undefined &&
      r !== baseline &&
      typeof baseline.tokens_per_criterion === 'number' &&
      baseline.tokens_per_criterion > 0 &&
      typeof r.tokens_per_criterion === 'number'
        ? ` (${fmtPercent(((r.tokens_per_criterion - baseline.tokens_per_criterion) / baseline.tokens_per_criterion) * 100)})`
        : r === baseline
          ? ' _(baseline)_'
          : '';

    lines.push(
      `| ${providerLabel} | ${r.milestone ?? '—'} | ${tpac}${delta} | ${fmtUsd(costPerCriterion)} | ${recordedAt} |`,
    );
  }

  lines.push('');
  if (baseline !== undefined) {
    lines.push(
      `Baseline: ${baseline.milestone ?? '—'} (${baseline.provider}${baseline.model ? `, ${baseline.model}` : ''}) — ${fmtTokens(baseline.tokens_per_criterion)} tokens/criterion.`,
    );
  } else {
    lines.push('No M2 baseline detected; deltas omitted.');
  }
  lines.push('');
  lines.push(
    `Per ADR-011, all numbers above are reproducible from committed cassettes under \`packages/test-utils/cassettes/\`. CI never hits real APIs.`,
  );

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: pnpm public-benchmark [--dir <path>] [--baseline <filename>]');
    process.exit(0);
  }
  const absDir = resolve(args.dir);
  const { reports, dirExists } = readReports(absDir);
  if (!dirExists) {
    console.log(
      `## SWT v3 TPAC public benchmark\n\n_Report directory not found: ${args.dir}_\n\nRun \`swt bench --provider <p> --output ${args.dir}/<provider>.json\` for each provider, then re-run this script.`,
    );
    process.exit(0);
  }
  const baseline = findBaseline(reports, args.baseline);
  const table = buildTable(reports, baseline);
  console.log(table);
}

main();
