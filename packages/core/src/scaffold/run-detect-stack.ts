/**
 * `runDetectStack` — synchronous wrapper around `scripts/detect-stack.sh`.
 *
 * Plan 23-01-01 T02 (milestone 23, Phase 01). Called by `initProject()`
 * for brownfield projects only (AC 16): the synchronous scaffold runs
 * `bash {pluginRoot}/scripts/detect-stack.sh {cwd}`, parses the stdout JSON
 * (verified shape: `{detected_stack, installed, recommended_skills,
 * suggestions, find_skills_available, global_skills_dir}`), writes the full
 * JSON to `.swt-planning/stack.json`, and returns the `detected_stack`
 * array.
 *
 * Failure modes:
 *   - Exit code ≠ 0 (jq missing, stack-mappings.json missing) → throw
 *     descriptive error including stderr. Do NOT swallow — Phase 04
 *     integration tests need the failure to surface.
 *   - Unparseable JSON → throw a descriptive error.
 *
 * `execFileSync` with an array argv form is preferred over `execSync` with
 * a concatenated string to avoid shell-injection on user-supplied paths.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { extractStderr } from './errors.js';

const PLANNING_DIR = '.swt-planning';

interface DetectStackJson {
  readonly detected_stack?: readonly string[];
  readonly installed?: unknown;
  readonly recommended_skills?: unknown;
  readonly suggestions?: unknown;
  readonly find_skills_available?: unknown;
  readonly global_skills_dir?: unknown;
}

/**
 * Run `bash {pluginRoot}/scripts/detect-stack.sh {cwd}`, persist the full
 * JSON to `.swt-planning/stack.json`, return the `detected_stack` array
 * (empty `[]` when the script omits the key). Throws on script failure.
 */
export function runDetectStack(cwd: string, pluginRoot: string): readonly string[] {
  const scriptPath = path.join(pluginRoot, 'scripts', 'detect-stack.sh');
  let raw: string;
  try {
    raw = execFileSync('bash', [scriptPath, cwd], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (err: unknown) {
    // execFileSync attaches `stderr` to the error on non-zero exit.
    const stderr = extractStderr(err);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `runDetectStack: detect-stack.sh failed at ${scriptPath} (${message})${
        stderr.length > 0 ? `\nstderr: ${stderr}` : ''
      }`,
    );
  }

  let parsed: DetectStackJson;
  try {
    parsed = JSON.parse(raw) as DetectStackJson;
  } catch (err) {
    throw new Error(
      `runDetectStack: failed to parse detect-stack.sh output as JSON (${
        err instanceof Error ? err.message : String(err)
      }). First 200 chars: ${raw.slice(0, 200)}`,
    );
  }

  // Persist the full JSON to .swt-planning/stack.json (AC 16). `.swt-planning/`
  // is guaranteed to exist by `initProject()` step 1; defensive mkdir is
  // belt-and-suspenders for callers that wire this helper directly.
  const planningDir = path.join(cwd, PLANNING_DIR);
  mkdirSync(planningDir, { recursive: true });
  const stackJsonPath = path.join(planningDir, 'stack.json');
  writeFileSync(stackJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

  const stack = Array.isArray(parsed.detected_stack)
    ? (parsed.detected_stack.filter((v): v is string => typeof v === 'string') as readonly string[])
    : ([] as readonly string[]);
  return stack;
}
