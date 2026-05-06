import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { writeAtomically } from '../atomic-write.js';

const SeveritySchema = z.enum(['critical', 'major', 'minor', 'cosmetic']);
const LayoutSchema = z.enum(['round-dir', 'legacy']);
const StageSchema = z.enum(['research', 'plan', 'execute', 'verify', 'none']);

export const RemediationStateSchema = z.object({
  version: z.literal(1),
  round: z.number().int().min(1),
  layout: LayoutSchema,
  severity: SeveritySchema,
  started: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
  last_stage: StageSchema,
});

export type RemediationState = z.infer<typeof RemediationStateSchema>;

const FILE_NAME = '.uat-remediation-stage';

export async function getOrInitRemediationState(
  phaseDir: string,
  severity: RemediationState['severity'],
): Promise<RemediationState> {
  const path = join(phaseDir, FILE_NAME);
  try {
    const raw = await readFile(path, 'utf8');
    return RemediationStateSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'ENOENT'
    ) {
      const fresh: RemediationState = {
        version: 1,
        round: 1,
        layout: 'round-dir',
        severity,
        started: new Date().toISOString(),
        last_stage: 'none',
      };
      await writeAtomically(path, `${JSON.stringify(fresh, null, 2)}\n`);
      return fresh;
    }
    throw err;
  }
}

export async function writeRemediationState(
  phaseDir: string,
  state: RemediationState,
): Promise<string> {
  const path = join(phaseDir, FILE_NAME);
  await writeAtomically(path, `${JSON.stringify(state, null, 2)}\n`);
  return path;
}

export async function advanceRemediationRound(phaseDir: string): Promise<RemediationState> {
  const state = await readRemediationState(phaseDir);
  if (state === undefined) {
    throw new Error(
      `No remediation state at ${join(phaseDir, FILE_NAME)} — call getOrInitRemediationState first.`,
    );
  }
  const next: RemediationState = { ...state, round: state.round + 1, last_stage: 'none' };
  await writeRemediationState(phaseDir, next);
  return next;
}

async function readRemediationState(phaseDir: string): Promise<RemediationState | undefined> {
  const path = join(phaseDir, FILE_NAME);
  try {
    const raw = await readFile(path, 'utf8');
    return RemediationStateSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'ENOENT'
    ) {
      return undefined;
    }
    throw err;
  }
}

export function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function roundUatPath(phaseDir: string, state: RemediationState): string {
  const rr = pad2(state.round);
  if (state.layout === 'round-dir') {
    return join(phaseDir, 'remediation', 'uat', `round-${rr}`, `R${rr}-UAT.md`);
  }
  return join(phaseDir, 'remediation', `round-${rr}`, `R${rr}-UAT.md`);
}
