import { execa } from 'execa';

export interface CodexVersion {
  readonly version: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const VERSION_RE = /\b(\d+)\.(\d+)\.(\d+)\b/;

export function parseCodexVersion(stdout: string): CodexVersion | undefined {
  const match = VERSION_RE.exec(stdout);
  if (match === null) return undefined;
  const [, majorStr, minorStr, patchStr] = match;
  if (majorStr === undefined || minorStr === undefined || patchStr === undefined) {
    return undefined;
  }
  return {
    version: `${majorStr}.${minorStr}.${patchStr}`,
    major: Number.parseInt(majorStr, 10),
    minor: Number.parseInt(minorStr, 10),
    patch: Number.parseInt(patchStr, 10),
  };
}

export async function detectCodexVersion(bin: string = 'codex'): Promise<CodexVersion | undefined> {
  try {
    const result = await execa(bin, ['--version'], { reject: false });
    if (result.exitCode !== 0) return undefined;
    return parseCodexVersion(result.stdout);
  } catch {
    return undefined;
  }
}

export function meetsMinimumVersion(
  detected: CodexVersion | undefined,
  required: { major: number; minor: number; patch?: number },
): boolean {
  if (detected === undefined) return false;
  if (detected.major !== required.major) return detected.major > required.major;
  if (detected.minor !== required.minor) return detected.minor > required.minor;
  return detected.patch >= (required.patch ?? 0);
}
