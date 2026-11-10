import { z } from 'zod';
import { phoneSchema } from './auth.js';
import { branchCodeSchema, categoryCodeSchema } from './codes.js';

// ─── Library (FR-BRN-03, FR-BRN-04) ────────────────────────────────────────

export const libraryInfoSchema = z.object({
  name: z.string(),
  logoImageId: z.number().int().nullable(),
});
export type LibraryInfo = z.infer<typeof libraryInfoSchema>;

export const renameLibraryRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

// ─── Branches (FR-BRN-01 – FR-BRN-04) ──────────────────────────────────────

/** A branch as shown in pickers and lists. */
export const branchSummarySchema = z.object({
  id: z.number().int(),
  code: z.string(),
  name: z.string(),
  logoImageId: z.number().int().nullable(),
});
export type BranchSummary = z.infer<typeof branchSummarySchema>;

/** Branch settings (§17 branch_setting). Ranges match the database checks. */
const branchSettingsBase = z.object({
  loanDays: z.number().int().min(1).max(90),
  maxBooks: z.number().int().min(1).max(10),
  maxBooksWhileSettling: z.number().int().min(0).max(10),
  settlementWindowDays: z.number().int().min(1).max(365),
  staffDueWarningDays: z.number().int().min(0).max(30),
  memberDueWarningDays: z.number().int().min(0).max(30),
  declineGraceDays: z.number().int().min(0).max(14),
  holdDays: z.number().int().min(1).max(30),
  /** FR-REQ-12: a copy on the road longer than this is flagged. */
  transitAlertDays: z.number().int().min(1).max(60),
  applicationStaleDays: z.number().int().min(1).max(365),
  applicationAnonymiseDays: z.number().int().min(1).max(365),
  renewalGraceDays: z.number().int().min(0).max(365),
  frequentLateCount: z.number().int().min(1).max(20),
  frequentLateMonths: z.number().int().min(1).max(60),
  /** FR-MEM-06: whole cents of LKR. */
  annualFeeCents: z.number().int().min(0).max(100_000_000),
  logRetentionMonths: z.number().int().min(24).max(240),
});

export const branchSettingsSchema = branchSettingsBase.refine(
  (s) => s.maxBooksWhileSettling <= s.maxBooks,
  { message: 'Cannot exceed the normal limit', path: ['maxBooksWhileSettling'] },
);
export type BranchSettings = z.infer<typeof branchSettingsSchema>;

/** Any subset of the settings; the merged result must still be valid. */
export const updateBranchSettingsRequestSchema = branchSettingsBase
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type UpdateBranchSettingsRequest = Partial<BranchSettings>;

export const branchDetailSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  name: z.string(),
  address: z.string(),
  phone: z.string(),
  logoImageId: z.number().int().nullable(),
  /** FR-BRN-02: true once a copy carries the code; it can no longer change. */
  codeLocked: z.boolean(),
  settings: branchSettingsSchema,
});
export type BranchDetail = z.infer<typeof branchDetailSchema>;

export const createBranchRequestSchema = z.object({
  branchName: z.string().trim().min(1).max(120),
  branchCode: z.string().trim().toUpperCase().pipe(branchCodeSchema),
  address: z.string().trim().min(1).max(300),
  phone: phoneSchema,
});
export type CreateBranchRequest = z.infer<typeof createBranchRequestSchema>;

export const updateBranchRequestSchema = createBranchRequestSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type UpdateBranchRequest = z.infer<typeof updateBranchRequestSchema>;

// ─── Categories (FR-BRN-05 – FR-BRN-07) ────────────────────────────────────

export const categorySchema = z.object({
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  /** FR-BRN-05: true once a title uses the code; it can no longer change. */
  inUse: z.boolean(),
});
export type Category = z.infer<typeof categorySchema>;

export const createCategoryRequestSchema = z.object({
  code: z.string().trim().toUpperCase().pipe(categoryCodeSchema),
  name: z.string().trim().min(1).max(120),
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = createCategoryRequestSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

// ─── Images (NFR-16) ───────────────────────────────────────────────────────

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const uploadedImageSchema = z.object({ imageId: z.number().int() });
