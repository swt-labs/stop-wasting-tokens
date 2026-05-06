import { copyFile, mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface PromptInstallOptions {
  readonly promptsDir: string;
  readonly source: string;
  /** Optional override for the destination filename. */
  readonly name?: string;
}

export async function installPrompt(opts: PromptInstallOptions): Promise<string> {
  const filename = opts.name ?? basename(opts.source);
  const target = join(opts.promptsDir, filename);
  await mkdir(opts.promptsDir, { recursive: true });
  await rm(target, { force: true });
  await copyFile(opts.source, target);
  return target;
}

export async function uninstallPrompt(
  promptsDir: string,
  filename: string,
): Promise<boolean> {
  const target = join(promptsDir, filename);
  try {
    await rm(target, { force: false });
    return true;
  } catch {
    return false;
  }
}
