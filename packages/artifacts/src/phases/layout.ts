import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CreatePhaseDirOptions {
  readonly planningDir: string;
  readonly position: string; // "01"..."13"
  readonly slug: string;
  readonly name: string;
  readonly goal: string;
}

export interface PhaseDirResult {
  readonly dir: string;
  readonly contextPath: string;
  readonly created: boolean;
}

/**
 * Create `<planningDir>/phases/<position>-<slug>/` (idempotent) and seed a
 * minimal CONTEXT.md that downstream agents can edit.
 */
export async function createPhaseDir(opts: CreatePhaseDirOptions): Promise<PhaseDirResult> {
  const dir = join(opts.planningDir, 'phases', `${opts.position}-${opts.slug}`);
  await mkdir(dir, { recursive: true });

  const contextPath = join(dir, `${opts.position}-CONTEXT.md`);
  let created = false;
  try {
    await writeFile(
      contextPath,
      `# Phase ${opts.position}: ${opts.name}\n\n` +
        `**Goal:** ${opts.goal}\n\n` +
        `## Notes\n\n_(no discussion notes yet)_\n`,
      { flag: 'wx' },
    );
    created = true;
  } catch (err) {
    if (typeof err !== 'object' || err === null || (err as { code?: string }).code !== 'EEXIST') {
      throw err;
    }
  }

  return { dir, contextPath, created };
}
