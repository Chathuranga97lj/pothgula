import { txt } from '../pdf/pdf.service';

export interface LabelCopy {
  accessionNo: string;
  title: string;
  legacyNo: string | null;
}

const COLUMNS = 3;
/** A4 less 20 pt margins, in eight rows a page (with each cell's own padding). */
const ROW_HEIGHT = 88;

const shorten = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * FR-CAT-10, FR-CAT-13: spine labels, 24 to an A4 page, the accession number in
 * large plain text (no barcode, R10), with the title and the old number small
 * so the right label goes on the right book.
 */
export function labelsContent(copies: LabelCopy[]): object[] {
  const cells = copies.map((c) => ({
    stack: [
      txt(c.accessionNo, { fontSize: 20, bold: true }),
      txt(shorten(c.title, 60), { fontSize: 8, margin: [0, 4, 0, 0] }),
      ...(c.legacyNo ? [txt(`old ${c.legacyNo}`, { fontSize: 8, color: '#5c6763' })] : []),
    ],
    margin: [8, 10, 8, 0],
  }));
  while (cells.length % COLUMNS !== 0) cells.push({ stack: [txt(' ')], margin: [0, 0, 0, 0] });
  const body: object[][] = [];
  for (let i = 0; i < cells.length; i += COLUMNS) body.push(cells.slice(i, i + COLUMNS));
  return [
    {
      table: { widths: ['*', '*', '*'], heights: ROW_HEIGHT, dontBreakRows: true, body },
      layout: {
        hLineColor: () => '#d6d3d1',
        vLineColor: () => '#d6d3d1',
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
      },
    },
  ];
}
