import { z } from 'zod';

/** A branch as shown in pickers and lists. */
export const branchSummarySchema = z.object({
  id: z.number().int(),
  code: z.string(),
  name: z.string(),
});
export type BranchSummary = z.infer<typeof branchSummarySchema>;
