import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { ArtifactKind } from '@swt-labs/shared';

const PLANNING_DIR_NAME = '.swt-planning';
const PHASES_DIR_NAME = 'phases';

const ARTIFACT_KIND_PATTERNS: Array<{ pattern: RegExp; kind: ArtifactKind }> = [
  { pattern: /-?RESEARCH\.md$/i, kind: 'research' },
  { pattern: /-?PLAN\.md$/i, kind: 'plan' },
  { pattern: /-?SUMMARY\.md$/i, kind: 'summary' },
  { pattern: /-?VERIFICATION\.md$/i, kind: 'verification' },
  { pattern: /-?UAT\.md$/i, kind: 'uat' },
  { pattern: /-?CONTEXT\.md$/i, kind: 'context' },
];

export interface RawArtifact {
  name: string;
  abs_path: string;
  size_bytes: number;
  mtime: Date;
  kind: ArtifactKind | null;
}

export interface RawPhase {
  position: string;
  slug: string;
  abs_path: string;
  artifacts: RawArtifact[];
}

export interface RawScan {
  project_root: string;
  state_md: string | null;
  roadmap_md: string | null;
  project_md: string | null;
  phases: RawPhase[];
}

function tryReadText(absPath: string): string | null {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function classify(name: string): ArtifactKind | null {
  for (const { pattern, kind } of ARTIFACT_KIND_PATTERNS) {
    if (pattern.test(name)) return kind;
  }
  return null;
}

function listMarkdownAndJson(dir: string): RawArtifact[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: RawArtifact[] = [];
  for (const name of entries) {
    if (!/\.(md|json)$/i.test(name)) continue;
    if (name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    out.push({
      name,
      abs_path: abs,
      size_bytes: stats.size,
      mtime: stats.mtime,
      kind: classify(name),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

const phaseDirNamePattern = /^(\d{2})-(.+)$/;

function listPhaseDirs(phasesRoot: string): RawPhase[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(phasesRoot);
  } catch {
    return [];
  }
  const out: RawPhase[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const match = phaseDirNamePattern.exec(name);
    if (!match) continue;
    const abs = path.join(phasesRoot, name);
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    out.push({
      position: match[1] ?? '00',
      slug: name,
      abs_path: abs,
      artifacts: listMarkdownAndJson(abs),
    });
  }
  out.sort((a, b) => a.position.localeCompare(b.position));
  return out;
}

export function scan(projectRoot: string): RawScan {
  const planningDir = path.join(projectRoot, PLANNING_DIR_NAME);
  const phasesDir = path.join(planningDir, PHASES_DIR_NAME);

  return {
    project_root: projectRoot,
    state_md: tryReadText(path.join(planningDir, 'STATE.md')),
    roadmap_md: tryReadText(path.join(planningDir, 'ROADMAP.md')),
    project_md: tryReadText(path.join(planningDir, 'PROJECT.md')),
    phases: listPhaseDirs(phasesDir),
  };
}
