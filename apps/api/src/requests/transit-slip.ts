import type { BookRequest } from '@pothgula/shared';
import { txt } from '../pdf/pdf.service';

const label = { fontSize: 9, color: '#5c6763' };
const head = (h: string) => txt(h, { ...label, bold: true });

/** Which way the copy is going: out to the member's branch, or home to its owner. */
function leg(r: BookRequest) {
  return r.status === 'returning' || r.status === 'lapsed'
    ? { from: r.to, to: r.from, home: true }
    : { from: r.from, to: r.to, home: false };
}

/**
 * FR-REQ-13, R20: what travels with the books — each copy, the sending and
 * receiving branches, who it is for, the date, and room for the carrier and the
 * receiver to sign. One section per pair of branches.
 */
export function transitSlipContent(requests: BookRequest[], today: string): object[] {
  const groups = new Map<string, BookRequest[]>();
  for (const r of requests) {
    const l = leg(r);
    const key = `${l.from.id}-${l.to.id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const content: object[] = [];
  let first = true;
  for (const group of groups.values()) {
    const l = leg(group[0]!);
    content.push(
      txt(`From ${l.from.code} — ${l.from.name}   to   ${l.to.code} — ${l.to.name}`, {
        fontSize: 12,
        bold: true,
        margin: [0, 0, 0, 4],
        ...(first ? {} : { pageBreak: 'before' }),
      }),
      txt(
        `${today} · ${group.length} ${group.length === 1 ? 'book' : 'books'} · ${
          l.home ? 'going home to its owning branch' : 'for members of the receiving branch'
        }`,
        { ...label, margin: [0, 0, 0, 10] },
      ),
      {
        table: {
          headerRows: 1,
          widths: [80, '*', 120, 50],
          body: [
            ['Book number', 'Title', l.home ? 'Was for' : 'For', 'Request'].map(head),
            ...group.map((r) => [
              txt(r.accessionNo),
              txt(r.title),
              txt(r.memberName),
              txt(`#${r.id}`),
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      {
        margin: [0, 28, 0, 0],
        columns: [
          {
            stack: [
              txt('Carried by (name and signature)', label),
              txt('_______________________________', { margin: [0, 18, 0, 0] }),
              txt('Date: ______________', { margin: [0, 10, 0, 0] }),
            ],
          },
          {
            stack: [
              txt(`Received at ${l.to.code} by (name and signature)`, label),
              txt('_______________________________', { margin: [0, 18, 0, 0] }),
              txt('Date: ______________', { margin: [0, 10, 0, 0] }),
            ],
          },
        ],
      },
      txt(
        'Keep the signed slip for a year. The receiving librarian records the arrival in the system the same day.',
        { ...label, margin: [0, 18, 0, 0] },
      ),
    );
    first = false;
  }
  return content;
}
