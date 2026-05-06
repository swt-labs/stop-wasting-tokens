import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface SkillInstallOptions {
  /** Destination root, e.g. `~/.codex/skills`. */
  readonly skillsDir: string;
  /** Source dir holding `SKILL.md` and any sibling files. */
  readonly source: string;
  /** Skill name (used as the destination subdirectory). */
  readonly name: string;
}

export async function installSkill(opts: SkillInstallOptions): Promise<string> {
  const target = join(opts.skillsDir, opts.name);
  const sourceStat = await stat(opts.source);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Skill source must be a directory: ${opts.source}`);
  }
  await mkdir(opts.skillsDir, { recursive: true });
  // Idempotent — clear any prior install before copying.
  await rm(target, { recursive: true, force: true });
  await cp(opts.source, target, { recursive: true });
  return target;
}

export async function uninstallSkill(skillsDir: string, name: string): Promise<boolean> {
  const target = join(skillsDir, name);
  try {
    await rm(target, { recursive: true, force: false });
    return true;
  } catch {
    return false;
  }
}
