import { z } from 'zod';
import { categoryCodeSchema } from './codes.js';

/**
 * ISBNs are kept as their 10 or 13 characters, without hyphens or spaces
 * (FR-CAT-01). The checksum is not enforced: older local books carry printed
 * ISBNs with errors, and the number is only a search aid here.
 */
export function normalizeIsbn(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(compact) || /^\d{13}$/.test(compact)) return compact;
  return null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const isbnField = z
  .union([z.literal(''), z.null(), z.string()])
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const isbn = normalizeIsbn(v);
    if (!isbn) {
      ctx.addIssue({ code: 'custom', message: 'An ISBN has 10 or 13 digits' });
      return z.NEVER;
    }
    return isbn;
  });

const priceField = z.number().int().min(0).max(100_000_000).nullable().optional();

/** The book as a reader thinks of it (FR-CAT-01, R1). */
export const titleFieldsSchema = z.object({
  title: z.string().trim().min(1).max(500),
  writer: optionalText(300),
  publisher: optionalText(300),
  isbn: isbnField,
  edition: optionalText(100),
  categoryCode: categoryCodeSchema,
});

/** Copies added in one action, each receiving its own accession number. */
export const addCopiesRequestSchema = z.object({
  branchId: z.number().int().positive(),
  count: z.number().int().min(1).max(50),
  source: optionalText(200),
  priceCents: priceField,
});
export type AddCopiesRequest = z.input<typeof addCopiesRequestSchema>;

export const createTitleRequestSchema = titleFieldsSchema.extend({
  copies: addCopiesRequestSchema.optional(),
});
export type CreateTitleRequest = z.input<typeof createTitleRequestSchema>;

export const updateTitleRequestSchema = titleFieldsSchema
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });
export type UpdateTitleRequest = z.input<typeof updateTitleRequestSchema>;

export const COPY_CONDITIONS = ['useable', 'not_useable', 'missing'] as const;

export const updateCopyRequestSchema = z
  .object({
    condition: z.enum(COPY_CONDITIONS),
    source: optionalText(200),
    priceCents: priceField,
    legacyNo: optionalText(60),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });
export type UpdateCopyRequest = z.input<typeof updateCopyRequestSchema>;

export const withdrawCopyRequestSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export const moveCopyRequestSchema = z.object({ branchId: z.number().int().positive() });
export const mergeTitlesRequestSchema = z.object({ intoTitleId: z.number().int().positive() });

// ─── Responses ──────────────────────────────────────────────────────────────

/** Where a copy is, worked out from loans and requests (R2, FR-REQ-08). */
export const COPY_STATES = [
  'on_shelf',
  'on_loan',
  'in_transit',
  'held',
  'missing',
  'not_useable',
  'withdrawn',
] as const;
export type CopyState = (typeof COPY_STATES)[number];

/** How many copies of a title one branch holds, and how many are on the shelf. */
export const branchHoldingSchema = z.object({
  branchId: z.number().int(),
  total: z.number().int(),
  onShelf: z.number().int(),
});

/** One line of the catalogue: a title with its copies per branch (FR-CAT-05, FR-CAT-06). */
export const titleSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  writer: z.string().nullable(),
  publisher: z.string().nullable(),
  isbn: z.string().nullable(),
  edition: z.string().nullable(),
  categoryCode: z.string(),
  categoryName: z.string(),
  holdings: z.array(branchHoldingSchema),
});
export type TitleSummary = z.infer<typeof titleSummarySchema>;

export const copySchema = z.object({
  id: z.number().int(),
  accessionNo: z.string(),
  branchId: z.number().int(),
  accessionedBranchId: z.number().int(),
  condition: z.enum(COPY_CONDITIONS),
  state: z.enum(COPY_STATES),
  withdrawnAt: z.iso.datetime().nullable(),
  withdrawnReason: z.string().nullable(),
  /** Staff only (FR-CAT-12); null for members. */
  priceCents: z.number().int().nullable(),
  source: z.string().nullable(),
  legacyNo: z.string().nullable(),
});
export type Copy = z.infer<typeof copySchema>;

export const titleDetailSchema = titleSummarySchema.extend({
  mergedIntoId: z.number().int().nullable(),
  copies: z.array(copySchema),
});
export type TitleDetail = z.infer<typeof titleDetailSchema>;

export const catalogueResponseSchema = z.object({
  titles: z.array(titleSummarySchema),
  /** True when there are more results than were returned. */
  more: z.boolean(),
});
export type CatalogueResponse = z.infer<typeof catalogueResponseSchema>;

/** Possible duplicates shown before a new title is created (FR-CAT-01). */
export const similarTitleSchema = titleSummarySchema.extend({
  reason: z.enum(['same_isbn', 'similar_title']),
});
export type SimilarTitle = z.infer<typeof similarTitleSchema>;

export const createdCopiesResponseSchema = z.object({
  title: titleDetailSchema,
  accessionNumbers: z.array(z.string()),
});
