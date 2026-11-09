import { BACKDATE_MAX_DAYS, type CallListEntry, type DueLoan } from '@pothgula/shared';
import { txt } from '../pdf/pdf.service';

const label = { fontSize: 9, color: '#5c6763' };
const head = (h: string) => txt(h, { ...label, bold: true });
const KEEP_SAFE = txt(
  'Personal data — keep it safe (Personal Data Protection Act No. 9 of 2022).',
  {
    ...label,
    margin: [0, 18, 0, 0],
  },
);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const late = (l: DueLoan) => (l.daysLate > 0 ? `${plural(l.daysLate, 'day', 'days')} late` : '');

/** FR-RPT-16: every open loan at the branch, by book number, for working on paper. */
export function dailySheetContent(today: string, loans: DueLoan[]): object[] {
  return [
    txt(
      `${plural(loans.length, 'book', 'books')} out at opening on ${today}. If the system cannot be reached, ` +
        'write each issue and take-back on a paper slip with the date, and enter it within ' +
        `${BACKDATE_MAX_DAYS} days ("Entering a paper slip" at the counter).`,
      { margin: [0, 0, 0, 10] },
    ),
    loans.length === 0
      ? txt('No books are out.')
      : {
          table: {
            headerRows: 1,
            widths: [72, '*', 110, 62, 54],
            body: [
              ['Book number', 'Title', 'Member', 'WhatsApp', 'Due'].map(head),
              ...loans.map((l) => [
                txt(l.accessionNo),
                txt(l.title),
                txt(l.memberName),
                txt(l.memberPhone),
                {
                  stack: [txt(l.dueDate), ...(l.overdue ? [txt(late(l), label)] : [])],
                },
              ]),
            ],
          },
          layout: 'lightHorizontalLines',
        },
    KEEP_SAFE,
  ];
}

/** FR-NOT-04: who to telephone, with room to note the call. */
export function callSheetContent(today: string, entries: CallListEntry[]): object[] {
  return [
    txt(
      `${plural(entries.length, 'member', 'members')} holding overdue books on ${today}, ` +
        'the longest overdue first. ' +
        'Nothing is sent by the system: call or message each person by hand.',
      { margin: [0, 0, 0, 10] },
    ),
    entries.length === 0
      ? txt('Nobody is holding an overdue book.')
      : {
          table: {
            headerRows: 1,
            dontBreakRows: true,
            widths: [95, 68, '*', 90],
            body: [
              ['Member', 'Phones', 'Overdue books', 'Called / notes'].map(head),
              ...entries.map((e) => [
                txt(e.fullName),
                { stack: [txt(e.whatsappPhone), ...(e.otherPhone ? [txt(e.otherPhone)] : [])] },
                {
                  stack: e.loans.map((l) => ({
                    stack: [
                      txt(`${l.accessionNo}  ${l.title}`),
                      txt(`due ${l.dueDate} · ${late(l)}`, label),
                    ],
                    margin: [0, 0, 0, 4],
                  })),
                },
                txt(' '),
              ]),
            ],
          },
          layout: 'lightHorizontalLines',
        },
    KEEP_SAFE,
  ];
}
