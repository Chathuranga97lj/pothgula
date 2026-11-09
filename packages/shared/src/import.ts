import { z } from 'zod';

/**
 * FR-CAT-13: the one-off import of books already on the shelves. One CSV row is
 * one physical copy; rows are grouped into titles, each copy gets a new
 * accession number, and its old number is kept alongside (`copy.legacy_no`).
 */

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 20_000;

/** The columns, in the order of the template. Only `title` and `category` are required. */
export const IMPORT_COLUMNS = [
  'old_number',
  'title',
  'writer',
  'publisher',
  'isbn',
  'edition',
  'category',
  'price',
  'source',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export const IMPORT_REQUIRED: readonly ImportColumn[] = ['title', 'category'];

/** Other spellings a librarian's spreadsheet may use for a heading. */
export const IMPORT_ALIASES: Record<ImportColumn, string[]> = {
  old_number: ['oldnumber', 'oldno', 'oldaccession', 'oldaccessionno', 'legacyno', 'number', 'no'],
  title: ['title', 'booktitle', 'name', 'bookname'],
  writer: ['writer', 'author', 'authors'],
  publisher: ['publisher', 'publishers'],
  isbn: ['isbn'],
  edition: ['edition'],
  category: ['category', 'categorycode', 'code'],
  price: ['price', 'pricers', 'rs', 'value'],
  source: ['source', 'donor', 'donatedby', 'from'],
};

/** Which column a heading means, if any: case, spaces, dots and underscores are ignored. */
export function importColumn(heading: string): ImportColumn | null {
  const h = heading.toLowerCase().replace(/[\s._-]/g, '');
  return (
    IMPORT_COLUMNS.find((c) => c.replace('_', '') === h || IMPORT_ALIASES[c].includes(h)) ?? null
  );
}

export const IMPORT_ERRORS = [
  'missing_title',
  'missing_category',
  'unknown_category',
  'retired_category',
  'bad_isbn',
  'bad_price',
  'too_long',
  'old_number_repeated',
  'old_number_exists',
  'category_differs',
] as const;
export type ImportErrorCode = (typeof IMPORT_ERRORS)[number];

export const importRowErrorSchema = z.object({
  /** The line in the file, counting the heading as line 1. */
  line: z.number().int(),
  code: z.enum(IMPORT_ERRORS),
  /** The offending value, when there is one. */
  value: z.string().nullable(),
});
export type ImportRowError = z.infer<typeof importRowErrorSchema>;

export const importCandidateSchema = z.object({
  titleId: z.number().int(),
  title: z.string(),
  writer: z.string().nullable(),
  isbn: z.string().nullable(),
  categoryCode: z.string(),
  copies: z.number().int(),
  reason: z.enum(['same_isbn', 'similar_title']),
});
export type ImportCandidate = z.infer<typeof importCandidateSchema>;

export const importGroupSchema = z.object({
  /** Stable for the same file: decisions refer to it. */
  key: z.string(),
  title: z.string(),
  writer: z.string().nullable(),
  publisher: z.string().nullable(),
  isbn: z.string().nullable(),
  edition: z.string().nullable(),
  categoryCode: z.string(),
  lines: z.array(z.number().int()),
  oldNumbers: z.array(z.string()),
  /** Probable duplicates already in the catalogue. */
  candidates: z.array(importCandidateSchema),
  /** Other groups in the same file with a near-identical name and writer. */
  similarKeys: z.array(z.string()),
});
export type ImportGroup = z.infer<typeof importGroupSchema>;

export const importPreviewSchema = z.object({
  branchId: z.number().int(),
  fileName: z.string(),
  rows: z.number().int(),
  ignoredColumns: z.array(z.string()),
  /** File-level problems (no title column, empty file…); nothing else is checked. */
  fileErrors: z.array(z.enum(['empty', 'not_utf8', 'too_many_rows', 'missing_column'])),
  missingColumns: z.array(z.string()),
  errors: z.array(importRowErrorSchema),
  groups: z.array(importGroupSchema),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

/** What staff decided for a group that has probable duplicates. */
export const importDecisionSchema = z.discriminatedUnion('action', [
  z.object({ key: z.string(), action: z.literal('new') }),
  z.object({
    key: z.string(),
    action: z.literal('existing'),
    titleId: z.number().int().positive(),
  }),
  z.object({ key: z.string(), action: z.literal('merge'), intoKey: z.string() }),
]);
export type ImportDecision = z.infer<typeof importDecisionSchema>;
export const importDecisionsSchema = z.array(importDecisionSchema).max(IMPORT_MAX_ROWS);

export const importResultSchema = z.object({
  titlesCreated: z.number().int(),
  titlesAddedTo: z.number().int(),
  copies: z.array(
    z.object({
      line: z.number().int(),
      oldNumber: z.string().nullable(),
      accessionNo: z.string(),
      titleId: z.number().int(),
      title: z.string(),
    }),
  ),
});
export type ImportResult = z.infer<typeof importResultSchema>;

/** FR-CAT-10, FR-CAT-13: spine labels for these copies. */
export const labelsRequestSchema = z.object({
  accessionNumbers: z.array(z.string()).min(1).max(IMPORT_MAX_ROWS),
});

/** The heading row of the template file staff fill in. */
export const IMPORT_TEMPLATE = `${IMPORT_COLUMNS.join(',')}\r\n`;
