import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { UatCheckpointBodySchema, type UatCheckpointResponse } from '@swt-labs/shared';
import type { Hono } from 'hono';

const PHASES_DIR = path.join('.swt-planning', 'phases');

interface ResolvedPhase {
  absDir: string;
  position: string;
  slug: string;
}

function resolvePhaseDir(projectRoot: string, phaseQuery: string): ResolvedPhase | null {
  const absPhasesDir = path.join(projectRoot, PHASES_DIR);
  if (!existsSync(absPhasesDir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(absPhasesDir);
  } catch {
    return null;
  }
  const trimmed = phaseQuery.trim();
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const match = /^(\d{2})-(.+)$/.exec(name);
    if (!match) continue;
    const [, position, slug] = match;
    if (
      name === trimmed ||
      position === trimmed ||
      slug === trimmed ||
      `${position}` === trimmed.padStart(2, '0')
    ) {
      const abs = path.join(absPhasesDir, name);
      try {
        if (statSync(abs).isDirectory()) {
          return { absDir: abs, position: position ?? '00', slug: slug ?? name };
        }
      } catch {
        // fall through
      }
    }
  }
  return null;
}

function findUatFile(absDir: string, position: string): string | null {
  const candidates = [`${position}-UAT.md`, 'UAT.md'];
  for (const name of candidates) {
    const abs = path.join(absDir, name);
    if (existsSync(abs)) return abs;
  }
  return null;
}

function nextTestId(uatText: string, position: string): string {
  // Count existing P{NN}-T{NN} blocks to derive the next sequential T number.
  const re = new RegExp(`^### P${position}-T(\\d+):`, 'gm');
  let count = 0;
  while (re.exec(uatText)) count += 1;
  return `P${position}-T${String(count + 1).padStart(2, '0')}`;
}

function appendCheckpointBlock(
  uatText: string,
  testId: string,
  scenario: string,
  result: 'pass' | 'fail',
  note: string | undefined,
): string {
  // B-16: dropped the placeholder lines for **Plan:** and **Expected:**.
  // The dashboard modal doesn't capture either field, so writing literal
  // "(recorded by dashboard UAT modal)" / "(recorded by dashboard)" placeholder
  // text was misleading noise. The verify-flow's PLAN.md scan picks up the
  // real plan/expected from the matching plan file when the round resumes.
  const block = [
    '',
    `### ${testId}: ${scenario}`,
    '',
    `- **Scenario:** ${scenario}`,
    `- **Result:** ${result}`,
    ...(note ? [`- **Notes:** ${note.replace(/\n/g, ' ')}`] : []),
    '',
  ].join('\n');
  return uatText.replace(/\n*$/, '') + '\n' + block;
}

export function registerUatCheckpointRoute(
  app: Hono,
  getProjectRoot: () => string | null,
): void {
  app.post('/api/uat/:phase/checkpoint', async (c) => {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      return c.json({ error: 'dashboard not yet initialized — run `swt init` then retry' }, 503);
    }
    const phaseQuery = c.req.param('phase');
    const phase = resolvePhaseDir(projectRoot, phaseQuery);
    if (!phase) {
      return c.json({ error: 'phase not found' }, 404);
    }

    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = UatCheckpointBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }

    const uatPath = findUatFile(phase.absDir, phase.position);
    if (!uatPath) {
      return c.json(
        {
          error: 'uat_artifact_missing',
          detail: `Phase ${phase.position} has no *-UAT.md to append to. Run /vbw:vibe verify first.`,
        },
        409,
      );
    }

    let existing: string;
    try {
      existing = readFileSync(uatPath, 'utf8');
    } catch {
      return c.json({ error: 'uat_read_failed' }, 500);
    }

    const testId = nextTestId(existing, phase.position);
    const updated = appendCheckpointBlock(
      existing,
      testId,
      parsed.data.scenario,
      parsed.data.result,
      parsed.data.note,
    );

    try {
      writeFileSync(uatPath, updated, 'utf8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'uat_write_failed', detail: message }, 500);
    }

    const relPath = path.relative(projectRoot, uatPath);
    const response: UatCheckpointResponse = { saved: true, path: relPath };
    return c.json(response);
  });
}
