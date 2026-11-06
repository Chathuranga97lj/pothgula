import { z } from 'zod';

/** FR-BRN-02: exactly two capital English letters, e.g. `KS`. */
export const branchCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'A branch code is exactly two capital letters, for example KS.');

/** FR-BRN-05: one capital letter followed by one digit, e.g. `A1`. */
export const categoryCodeSchema = z
  .string()
  .regex(/^[A-Z][0-9]$/, 'A category code is one capital letter and one digit, for example A1.');

export type BranchCode = z.infer<typeof branchCodeSchema>;
export type CategoryCode = z.infer<typeof categoryCodeSchema>;
