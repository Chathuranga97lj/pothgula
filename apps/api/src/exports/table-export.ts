import type { ExportFormat } from '@pothgula/shared';
import type { Response } from 'express';
import { type Branding, PdfService, txt } from '../pdf/pdf.service';

export type Cell = string | number | null | undefined;

export interface ExportColumn {
  header: string;
  /** PDF column width: points, '*' to share what is left, or 'auto'. */
  width?: number | '*' | 'auto';
  /** Leave the column out of these formats (the log's raw values go to CSV only). */
  skip?: ExportFormat[];
  /** Right-align numbers in the text and PDF tables. */
  numeric?: boolean;
}

/** One table to take away as a file (FR-LOG-08, FR-RPT-09). */
export interface ExportTable {
  title: string;
  /** Lines saying what is in it — the branch, the period, the filter used. */
  about: string[];
  columns: ExportColumn[];
  rows: Cell[][];
  /**
   * How the text file lays rows out: aligned columns for short figures, or one
   * block per row ("Header: value" lines) for long values such as log entries.
   */
  textLayout: 'columns' | 'records';
  /** Print across the page. */
  landscape?: boolean;
  /** Smaller type for wide PDF tables. */
  pdfFontSize?: number;
}

export interface ExportFile {
  body: Buffer;
  contentType: string;
  filename: string;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
};

/**
 * Renders a table as .txt, .csv or a branded PDF, all in this process with no
 * outside service (NFR-11). Every log view and report goes through here.
 */
export async function renderTable(
  pdf: PdfService,
  table: ExportTable,
  format: ExportFormat,
  meta: { branding: Branding; producedBy: string; producedAt: string; filename: string },
): Promise<ExportFile> {
  const columns = table.columns
    .map((c, i) => ({ ...c, i }))
    .filter((c) => !c.skip?.includes(format));
  const cells = (row: Cell[]) => columns.map((c) => row[c.i]);

  let body: Buffer;
  if (format === 'csv') {
    body = Buffer.from(toCsv([columns.map((c) => c.header), ...table.rows.map(cells)]), 'utf8');
  } else if (format === 'txt') {
    const head = [
      table.title,
      [meta.branding.libraryName, meta.branding.branchName].filter(Boolean).join(' — '),
      ...table.about,
      `Produced ${meta.producedAt} by ${meta.producedBy}`,
      '',
    ];
    const lines =
      table.textLayout === 'columns'
        ? textColumns(columns, table.rows.map(cells))
        : textRecords(columns, table.rows.map(cells));
    body = Buffer.from([...head, ...lines].join('\n') + '\n', 'utf8');
  } else {
    const fontSize = table.pdfFontSize ?? 9;
    body = await pdf.render({
      branding: meta.branding,
      title: table.title,
      producedBy: meta.producedBy,
      producedAt: meta.producedAt,
      landscape: table.landscape,
      content: [
        ...table.about.map((line) => txt(line, { fontSize: 9, color: '#5c6763' })),
        { text: '', margin: [0, 0, 0, 8] },
        table.rows.length === 0
          ? txt('Nothing to show.')
          : {
              table: {
                headerRows: 1,
                widths: columns.map((c) => c.width ?? 'auto'),
                body: [
                  columns.map((c) => txt(c.header, { fontSize, bold: true, color: '#5c6763' })),
                  ...table.rows.map((row) =>
                    columns.map((c) =>
                      txt(display(row[c.i]), {
                        fontSize,
                        ...(c.numeric ? { alignment: 'right' } : {}),
                      }),
                    ),
                  ),
                ],
              },
              layout: 'lightHorizontalLines',
            },
      ],
    });
  }
  return {
    body,
    contentType: CONTENT_TYPES[format],
    filename: `${meta.filename}.${format}`,
  };
}

function display(value: Cell): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

/**
 * RFC 4180, with a byte-order mark so Excel and LibreOffice read Sinhala and Tamil
 * as UTF-8 (FR-LOG-08), and CRLF line ends. Text that a spreadsheet would run as
 * a formula (=, +, -, @ first) is prefixed with an apostrophe: log values are
 * typed by people, and an export must not be a way to plant a formula.
 */
export function toCsv(rows: Cell[][]): string {
  const field = (value: Cell): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return String(value);
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + rows.map((r) => r.map(field).join(',')).join('\r\n') + '\r\n';
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Width on screen, counting each written character (a Sinhala cluster) once. */
export function displayWidth(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text)) n += 1;
  return n;
}

function pad(text: string, width: number, right: boolean): string {
  const gap = ' '.repeat(Math.max(0, width - displayWidth(text)));
  return right ? gap + text : text + gap;
}

function textColumns(columns: ExportColumn[], rows: Cell[][]): string[] {
  const shown = rows.map((r) => r.map((v) => display(v).replace(/\s*\n\s*/g, '; ')));
  const widths = columns.map((c, i) =>
    Math.max(displayWidth(c.header), ...shown.map((r) => displayWidth(r[i]!))),
  );
  const line = (values: string[]) =>
    values
      .map((v, i) => pad(v, widths[i]!, columns[i]!.numeric === true))
      .join('  ')
      .trimEnd();
  if (rows.length === 0) return ['Nothing to show.'];
  return [
    line(columns.map((c) => c.header)),
    line(widths.map((w) => '-'.repeat(w))),
    ...shown.map(line),
  ];
}

function textRecords(columns: ExportColumn[], rows: Cell[][]): string[] {
  if (rows.length === 0) return ['Nothing to show.'];
  const width = Math.max(...columns.map((c) => displayWidth(c.header)));
  const out: string[] = [];
  for (const row of rows) {
    columns.forEach((c, i) => {
      const value = row[i];
      if (value === null || value === undefined || value === '') return;
      const [first, ...rest] = String(value).split('\n');
      out.push(`${pad(c.header, width, false)}  ${first}`);
      for (const more of rest) out.push(`${' '.repeat(width)}  ${more}`);
    });
    out.push('');
  }
  return out;
}

/** Sends a rendered file as a download. */
export function sendFile(res: Response, file: ExportFile): void {
  res
    .status(200)
    .set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .end(file.body);
}
