import { Inject, Injectable } from '@nestjs/common';
import { formatRupees, type MemberDetail, todayColombo } from '@pothgula/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { UnitOfWork } from '../audit/unit-of-work';
import type { AuthContext } from '../auth/auth-context';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { borrow, branch, copy, title } from '../db/schema';
import { PdfService, txt } from '../pdf/pdf.service';
import { MembersService } from './members.service';

export type ExportFormat = 'txt' | 'pdf';

interface Loan {
  accessionNo: string;
  title: string;
  borrowDate: string;
  dueDate: string;
}

const KIND: Record<string, string> = {
  first_fee: 'First fee',
  fee: 'Annual fee',
  waiver: 'Fee waived',
  reversal: 'Reversal',
};

/**
 * FR-AUT-19, FR-RPT-13: one person's full details as a text file or a PDF. The
 * only export that carries one person's data on its own, so every one is logged
 * with who exported whose details.
 */
@Injectable()
export class MemberExportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly members: MembersService,
    private readonly pdf: PdfService,
    private readonly uow: UnitOfWork,
  ) {}

  async export(
    ctx: AuthContext,
    id: number,
    format: ExportFormat,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const member = await this.members.detail(ctx, id); // checks branch scope
    const [home] =
      member.branchId === null
        ? []
        : await this.db.select().from(branch).where(eq(branch.id, member.branchId));
    const loans = await this.openLoans(id);
    const producedAt = todayColombo();
    const homeName = home ? `${home.branchCode} — ${home.branchName}` : '—';

    const body =
      format === 'txt'
        ? Buffer.from(asText(member, homeName, loans, ctx.user.fullName, producedAt), 'utf8')
        : await this.pdf.render({
            branding: await this.pdf.branding(member.branchId),
            title: 'Member details',
            producedBy: ctx.user.fullName,
            producedAt,
            content: asPdf(member, homeName, loans),
          });

    await this.uow.run(ctx.actor, (_tx, log) =>
      log({
        action: 'member.export',
        entity: 'app_user',
        entityId: id,
        branchId: member.branchId,
        after: { format },
      }),
    );

    return {
      body,
      contentType: format === 'txt' ? 'text/plain; charset=utf-8' : 'application/pdf',
      filename: `member-${id}-${producedAt}.${format}`,
    };
  }

  private openLoans(userId: number): Promise<Loan[]> {
    return this.db
      .select({
        accessionNo: copy.accessionNo,
        title: title.title,
        borrowDate: borrow.borrowDate,
        dueDate: borrow.dueDate,
      })
      .from(borrow)
      .innerJoin(copy, eq(copy.id, borrow.copyId))
      .innerJoin(title, eq(title.id, copy.titleId))
      .where(and(eq(borrow.userId, userId), isNull(borrow.returnedOn), isNull(borrow.voidedAt)))
      .orderBy(asc(borrow.dueDate));
  }
}

function fields(m: MemberDetail, homeName: string): [string, string | null][] {
  return [
    ['Full name', m.fullName],
    ['WhatsApp number', m.whatsappPhone],
    ['Other phone', m.otherPhone],
    ['Address', m.address],
    ['Date of birth', m.dateOfBirth ? `${m.dateOfBirth} (age ${m.age})` : null],
    ['Organisation', m.organisation],
    ['Introduced by', m.introducedByName],
    ["Introducer's phone", m.introducedByPhone],
    ['Home branch', homeName],
    ['Membership', m.state],
    ['Applied', m.appliedAt?.slice(0, 10) ?? null],
    ['Approved', m.approvedAt?.slice(0, 10) ?? null],
    ['Membership expires', m.expireAt],
    ...(m.rejectionReason ? ([['Rejection reason', m.rejectionReason]] as [string, string][]) : []),
  ];
}

function asText(
  m: MemberDetail,
  homeName: string,
  loans: Loan[],
  producedBy: string,
  producedAt: string,
): string {
  const width = 22;
  const lines = [
    'MEMBER DETAILS',
    '',
    ...fields(m, homeName).map(([k, v]) => `${k.padEnd(width)}${v ?? '—'}`),
    '',
    'PAYMENTS',
    ...(m.payments.length === 0
      ? ['  none']
      : m.payments.map(
          (p) =>
            `  ${p.paidOn}  ${KIND[p.kind]!.padEnd(12)}  Rs ${formatRupees(p.amountCents).padStart(10)}  ` +
            `${p.receiptNo ?? p.reason ?? ''}  valid until ${p.extendsTo ?? '—'}`,
        )),
    '',
    'BOOKS ON LOAN',
    ...(loans.length === 0
      ? ['  none']
      : loans.map(
          (l) => `  ${l.accessionNo}  ${l.title}  borrowed ${l.borrowDate}, due ${l.dueDate}`,
        )),
    '',
    `Produced ${producedAt} by ${producedBy}. Personal data — keep it safe (PDPA No. 9 of 2022).`,
    '',
  ];
  return lines.join('\r\n');
}

function asPdf(m: MemberDetail, homeName: string, loans: Loan[]): object[] {
  const label = { fontSize: 9, color: '#5c6763' };
  const heading = (text: string) => txt(text, { bold: true, fontSize: 11, margin: [0, 14, 0, 6] });
  const table = (headers: string[], rows: object[][], widths: (string | number)[]) => ({
    table: {
      headerRows: 1,
      widths,
      body: [headers.map((h) => txt(h, { ...label, bold: true })), ...rows],
    },
    layout: 'lightHorizontalLines',
  });

  return [
    {
      table: {
        widths: [130, '*'],
        body: fields(m, homeName).map(([k, v]) => [txt(k, label), txt(v)]),
      },
      layout: 'noBorders',
    },
    heading('Payments'),
    m.payments.length === 0
      ? txt('None.')
      : table(
          ['Date', 'Kind', 'Amount (Rs)', 'Receipt or reason', 'Valid until'],
          m.payments.map((p) => [
            txt(p.paidOn),
            txt(KIND[p.kind]),
            txt(formatRupees(p.amountCents), { alignment: 'right' }),
            txt(p.receiptNo ?? p.reason),
            txt(p.extendsTo),
          ]),
          [60, 70, 65, '*', 65],
        ),
    heading('Books on loan'),
    loans.length === 0
      ? txt('None.')
      : table(
          ['Accession', 'Title', 'Borrowed', 'Due'],
          loans.map((l) => [txt(l.accessionNo), txt(l.title), txt(l.borrowDate), txt(l.dueDate)]),
          [80, '*', 65, 65],
        ),
    txt('Personal data — keep it safe (Personal Data Protection Act No. 9 of 2022).', {
      ...label,
      margin: [0, 18, 0, 0],
    }),
  ];
}
