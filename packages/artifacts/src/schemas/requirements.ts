import { z } from 'zod';

export const RequirementSchema = z.object({
  id: z.string().regex(/^REQ-/),
  text: z.string().min(1),
  priority: z.enum(['must-have', 'nice-to-have', 'out-of-scope']).default('must-have'),
});

export type Requirement = z.infer<typeof RequirementSchema>;

export const RequirementsFrontmatterSchema = z
  .object({
    defined: z.string().optional(),
    requirements: z.array(RequirementSchema).optional(),
  })
  .passthrough();

export type RequirementsFrontmatter = z.infer<typeof RequirementsFrontmatterSchema>;
