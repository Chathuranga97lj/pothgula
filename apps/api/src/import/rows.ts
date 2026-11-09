import {
  IMPORT_MAX_ROWS,
  IMPORT_REQUIRED,
  type ImportColumn,
  importColumn,
  type ImportPreview,
  type ImportRowError,
  normalizeIsbn,
  parseRupees,
} from '@pothgula/shared';
import { decodeUtf8, NotUtf8Error, parseCsv } from './csv';

export interface ImportRow {
  line: number;
  oldNumber: string | null;
  title: string;
  writer: string | null;
  publisher: string | null;
  isbn: string | null;
  edition: string | null;
  categoryCode: string;
  priceCents: number | null;
  source: string | null;
}

export interface RowGroup {
  key: string;
  first: ImportRow;
  rows: ImportRow[];
}

export interface ReadFile {
  rows: ImportRow[];
  errors: ImportRowError[];
  ignoredColumns: string[];
  missingColumns: string[];
  fileErrors: ImportPreview['fileErrors'];
}

const LIMITS: Partial<Record<ImportColumn, number>> = {
  old_number: 60,
  title: 500,
  writer: 300,
  publisher: 300,
  edition: 100,
  source: 200,
};

/** Categories as the catalogue has them: code → still in use. */
export type CategoryState = Map<string, boolean>;

/**
 * FR-CAT-13: reads the file and checks every row on its own. Checks that need the
 * database beyond the category list (old numbers already used) come afterwards.
 */
export function readImportFile(bytes: Uint8Array, categories: CategoryState): ReadFile {
  const empty = (fileErrors: ReadFile['fileErrors'], missingColumns: string[] = []): ReadFile => ({
    rows: [],
    errors: [],
    ignoredColumns: [],
    missingColumns,
    fileErrors,
  });

  let text: string;
  try {
    text = decodeUtf8(bytes);
  } catch (error) {
    if (error instanceof NotUtf8Error) return empty(['not_utf8']);
    throw error;
  }
  const records = parseCsv(text);
  if (records.length < 2) return empty(['empty']);
  if (records.length - 1 > IMPORT_MAX_ROWS) return empty(['too_many_rows']);

  const [heading, ...body] = records;
  const columns = heading!.fields.map((h) => importColumn(h.trim()));
  const ignoredColumns = heading!.fields
    .filter((h, i) => columns[i] === null && h.trim() !== '')
    .map((h) => h.trim());
  const missingColumns = IMPORT_REQUIRED.filter((c) => !columns.includes(c));
  if (missingColumns.length > 0) return empty(['missing_column'], missingColumns);

  const rows: ImportRow[] = [];
  const errors: ImportRowError[] = [];
  const seenOld = new Set<string>();

  for (const { line, fields } of body) {
    const get = (c: ImportColumn): string => {
      const i = columns.indexOf(c);
      return i < 0 ? '' : (fields[i] ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
    };
    const rowErrors: ImportRowError[] = [];
    const fail = (code: ImportRowError['code'], value: string | null = null) =>
      rowErrors.push({ line, code, value });
    const text = (c: ImportColumn) => {
      const v = get(c);
      if (LIMITS[c] !== undefined && v.length > LIMITS[c]) fail('too_long', c);
      return v || null;
    };

    const title = text('title');
    if (!title) fail('missing_title');
    const writer = text('writer');
    const publisher = text('publisher');
    const edition = text('edition');
    const source = text('source');
    const oldNumber = text('old_number');
    if (oldNumber) {
      if (seenOld.has(oldNumber.toUpperCase())) fail('old_number_repeated', oldNumber);
      seenOld.add(oldNumber.toUpperCase());
    }

    const categoryCode = get('category').toUpperCase();
    if (!categoryCode) fail('missing_category');
    else if (!categories.has(categoryCode)) fail('unknown_category', categoryCode);
    else if (!categories.get(categoryCode)) fail('retired_category', categoryCode);

    const rawIsbn = get('isbn');
    const isbn = rawIsbn ? normalizeIsbn(rawIsbn) : null;
    if (rawIsbn && !isbn) fail('bad_isbn', rawIsbn);

    const rawPrice = get('price').replace(/^rs\.?\s*/i, '');
    const priceCents = rawPrice ? parseRupees(rawPrice) : null;
    if (rawPrice && priceCents === null) fail('bad_price', get('price'));

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }
    rows.push({
      line,
      oldNumber,
      title: title!,
      writer,
      publisher,
      isbn,
      edition,
      categoryCode,
      priceCents,
      source,
    });
  }
  return { rows, errors, ignoredColumns, missingColumns: [], fileErrors: [] };
}

/** Letters and digits only, in lower case, single-spaced: "Gam Peraliya." = "gam  peraliya". */
export function looseText(value: string | null): string {
  return (value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Copies of the same book become one title: the same ISBN, or else the same
 * name, writer and edition once case, spacing and punctuation are ignored.
 */
export function groupRows(rows: ImportRow[]): { groups: RowGroup[]; errors: ImportRowError[] } {
  const byKey = new Map<string, RowGroup>();
  const errors: ImportRowError[] = [];
  for (const row of rows) {
    const key = row.isbn
      ? `isbn:${row.isbn}`
      : `t:${looseText(row.title)}|${looseText(row.writer)}|${looseText(row.edition)}`;
    const group = byKey.get(key);
    if (!group) {
      byKey.set(key, { key, first: row, rows: [row] });
    } else if (group.first.categoryCode !== row.categoryCode) {
      // Copies of one title share its category, which decides their numbers.
      errors.push({ line: row.line, code: 'category_differs', value: row.categoryCode });
    } else {
      group.rows.push(row);
    }
  }
  return { groups: [...byKey.values()], errors };
}
