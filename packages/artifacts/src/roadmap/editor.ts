import type { PhaseEntry } from '../schemas/roadmap.js';

export interface PhaseRename {
  /** Existing slug-prefixed dir name (`01-some-slug`). */
  readonly from: string;
  /** New slug-prefixed dir name with the new position. */
  readonly to: string;
}

export interface RoadmapMutation {
  readonly phases: readonly PhaseEntry[];
  readonly renames: readonly PhaseRename[];
}

function reposition(entries: readonly PhaseEntry[]): PhaseEntry[] {
  return entries.map((entry, idx) => {
    const newPos = String(idx + 1).padStart(2, '0');
    if (entry.position === newPos) return entry;
    return { ...entry, position: newPos };
  });
}

export function addPhase(
  phases: readonly PhaseEntry[],
  newPhase: Omit<PhaseEntry, 'position' | 'status'> & { status?: PhaseEntry['status'] },
): RoadmapMutation {
  const next: PhaseEntry[] = [
    ...phases,
    {
      ...newPhase,
      position: String(phases.length + 1).padStart(2, '0'),
      status: newPhase.status ?? 'pending',
    },
  ];
  return { phases: next, renames: [] };
}

export function insertPhase(
  phases: readonly PhaseEntry[],
  position: number,
  newPhase: Omit<PhaseEntry, 'position' | 'status'> & { status?: PhaseEntry['status'] },
): RoadmapMutation {
  if (position < 1 || position > phases.length + 1) {
    throw new RangeError(`Insert position ${position} out of range (1..${phases.length + 1})`);
  }
  const stub: PhaseEntry = {
    ...newPhase,
    position: String(position).padStart(2, '0'),
    status: newPhase.status ?? 'pending',
  };
  const before = phases.slice(0, position - 1);
  const after = phases.slice(position - 1);
  const repositioned = reposition([...before, stub, ...after]);
  const renames: PhaseRename[] = [];
  for (let i = position - 1; i < after.length; i += 1) {
    const original = after[i];
    if (original === undefined) continue;
    const newEntry = repositioned[position + i];
    if (newEntry === undefined) continue;
    if (original.position !== newEntry.position) {
      renames.push({
        from: `${original.position}-${original.slug}`,
        to: `${newEntry.position}-${newEntry.slug}`,
      });
    }
  }
  return { phases: repositioned, renames };
}

export function removePhase(phases: readonly PhaseEntry[], position: number): RoadmapMutation {
  if (position < 1 || position > phases.length) {
    throw new RangeError(`Remove position ${position} out of range (1..${phases.length})`);
  }
  const before = phases.slice(0, position - 1);
  const after = phases.slice(position);
  const repositioned = reposition([...before, ...after]);
  const renames: PhaseRename[] = [];
  for (let i = position - 1; i < repositioned.length; i += 1) {
    const original = phases[i + 1];
    const newEntry = repositioned[i];
    if (original === undefined || newEntry === undefined) continue;
    if (original.position !== newEntry.position) {
      renames.push({
        from: `${original.position}-${original.slug}`,
        to: `${newEntry.position}-${newEntry.slug}`,
      });
    }
  }
  return { phases: repositioned, renames };
}
