import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { writeAtomically } from '../atomic-write.js';

export const InferredRequirementSchema = z.object({
  text: z.string().min(1),
  priority: z.enum(['must-have', 'nice-to-have', 'out-of-scope']).default('must-have'),
});

export type InferredRequirement = z.infer<typeof InferredRequirementSchema>;

export const DiscoverySchema = z.object({
  answered: z.array(z.string().min(1)).default([]),
  inferred: z.array(InferredRequirementSchema).default([]),
  deferred: z.array(z.string().min(1)).default([]),
});

export type Discovery = z.infer<typeof DiscoverySchema>;

export const EMPTY_DISCOVERY: Discovery = DiscoverySchema.parse({});

export async function readDiscovery(planningDir: string): Promise<Discovery> {
  const path = join(planningDir, 'discovery.json');
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return DiscoverySchema.parse(parsed);
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT') {
      return EMPTY_DISCOVERY;
    }
    throw err;
  }
}

export async function writeDiscovery(
  planningDir: string,
  data: Discovery = EMPTY_DISCOVERY,
): Promise<void> {
  const path = join(planningDir, 'discovery.json');
  const validated = DiscoverySchema.parse(data);
  await writeAtomically(path, `${JSON.stringify(validated, null, 2)}\n`);
}
