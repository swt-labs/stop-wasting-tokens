import { z } from 'zod';

export const ProjectFrontmatterSchema = z
  .object({
    name: z.string().min(1).optional(),
    core_value: z.string().min(1).optional(),
  })
  .passthrough();

export type ProjectFrontmatter = z.infer<typeof ProjectFrontmatterSchema>;
