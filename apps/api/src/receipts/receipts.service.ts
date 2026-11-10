import { Inject, Injectable } from '@nestjs/common';
import { formatRupees, todayColombo } from '@pothgula/shared';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AuthContext } from '../auth/auth-context';
import { UnitOfWork } from '../audit/unit-of-work';
import { AppError } from '../common/app-error';
import { assertBranchAccess } from '../common/scope';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import {
  appUser,
  bookSettlement,
  copy,
  membershipPayment,
  settlementPayment,
  title,
} from '../db/schema';
import type { ExportFile } from '../exports/table-export';
import { PdfService, txt } from '../pdf/pdf.service';

const member = alias(appUser, 'member');
const collector = alias(appUser, 'collector');

/** What one receipt says. */
interface Receipt {
  kind: 'membership' | 'settlement';
  paymentId: number;
  memberId: number;
  memberName: string;
  memberPhone: string | null;
  branchId: number | null;
  receiptNo: string;
  paidOn: string;
  amountCents: number;
  collectedByName: string;
  /** What the money was for, in a line. */
  forWhat: string;
  /** A reversing entry prints as a credit note against the receipt it reverses. */
  reverses: string | null;
}

const FEE_KINDS: Record<string, string> = {
  fee: 'Annual membership fee',
  first_fee: 'First year’s membership fee',
  reversal: 'Reversal of a membership payment',
};

/**
 * FR-MEM-07, FR-LST-07: a printable receipt for a payment — a membership fee or
 * lost-book money — for staff of the member's branch, or the member themselves.
 * A receipt carries a person's name, so each one printed is logged (R13).
 */
@Injectable()
export class ReceiptsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly pdf: PdfService,
  ) {}

  async membership(ctx: AuthContext, paymentId: number): Promise<ExportFile> {
    const [p] = await this.db
      .select({
        p: membershipPayment,
        memberName: member.fullName,
        memberPhone: member.whatsappPhone,
        branchId: member.branchId,
        collectedByName: collector.fullName,
      })
      .from(membershipPayment)
      .innerJoin(member, eq(member.id, membershipPayment.userId))
      .innerJoin(collector, eq(collector.id, membershipPayment.collectedBy))
      .where(eq(membershipPayment.id, paymentId));
    if (!p) throw notFound();
    let reverses: string | null = null;
    if (p.p.reversesPaymentId !== null) {
      const [orig] = await this.db
        .select({ receiptNo: membershipPayment.receiptNo })
        .from(membershipPayment)
        .where(eq(membershipPayment.id, p.p.reversesPaymentId));
      reverses = orig?.receiptNo ?? null;
    }
    const receiptNo = p.p.receiptNo ?? (reverses ? `${reverses}-R` : null);
    // A waived first fee took no money, so there is nothing to give a receipt for.
    if (receiptNo === null) {
      throw AppError.unprocessable('no_receipt', 'No money changed hands; there is no receipt.');
    }
    return this.render(ctx, {
      kind: 'membership',
      paymentId,
      memberId: p.p.userId,
      memberName: p.memberName,
      memberPhone: p.memberPhone,
      branchId: p.branchId,
      receiptNo,
      paidOn: p.p.paidOn,
      amountCents: p.p.amountCents,
      collectedByName: p.collectedByName,
      forWhat:
        FEE_KINDS[p.p.kind]! + (p.p.extendsTo ? `, membership valid to ${p.p.extendsTo}` : ''),
      reverses,
    });
  }

  async settlement(ctx: AuthContext, paymentId: number): Promise<ExportFile> {
    const [p] = await this.db
      .select({
        p: settlementPayment,
        memberId: bookSettlement.userId,
        memberName: member.fullName,
        memberPhone: member.whatsappPhone,
        branchId: bookSettlement.branchId,
        collectedByName: collector.fullName,
        accessionNo: copy.accessionNo,
        title: title.title,
      })
      .from(settlementPayment)
      .innerJoin(bookSettlement, eq(bookSettlement.id, settlementPayment.settlementId))
      .innerJoin(member, eq(member.id, bookSettlement.userId))
      .innerJoin(collector, eq(collector.id, settlementPayment.collectedBy))
      .innerJoin(copy, eq(copy.id, bookSettlement.copyId))
      .innerJoin(title, eq(title.id, copy.titleId))
      .where(eq(settlementPayment.id, paymentId));
    if (!p) throw notFound();
    let reverses: string | null = null;
    if (p.p.reversesPaymentId !== null) {
      const [orig] = await this.db
        .select({ receiptNo: settlementPayment.receiptNo })
        .from(settlementPayment)
        .where(eq(settlementPayment.id, p.p.reversesPaymentId));
      reverses = orig?.receiptNo ?? null;
    }
    return this.render(ctx, {
      kind: 'settlement',
      paymentId,
      memberId: p.memberId,
      memberName: p.memberName,
      memberPhone: p.memberPhone,
      branchId: p.branchId,
      receiptNo: p.p.receiptNo ?? `${reverses ?? p.p.id}-R`,
      paidOn: p.p.paidOn,
      amountCents: p.p.amountCents,
      collectedByName: p.collectedByName,
      forWhat: `${p.p.kind === 'reversal' ? 'Refund or correction of lost-book money' : 'Lost book'}: ${p.title} (${p.accessionNo})`,
      reverses,
    });
  }

  private async render(ctx: AuthContext, r: Receipt): Promise<ExportFile> {
    const own = ctx.user.userType === 'member';
    if (own) {
      if (ctx.user.id !== r.memberId) throw notFound();
    } else {
      assertBranchAccess(ctx.user, r.branchId);
    }
    const today = todayColombo();
    const credit = r.amountCents < 0;
    const line = (label: string, value: string | null) => ({
      columns: [
        txt(label, { width: 130, color: '#5c6763' }),
        txt(value, { width: '*', bold: label === 'Amount' }),
      ],
      margin: [0, 0, 0, 6],
    });
    const body = await this.pdf.render({
      branding: await this.pdf.branding(r.branchId),
      title: credit ? `Credit note ${r.receiptNo}` : `Receipt ${r.receiptNo}`,
      producedBy: ctx.user.fullName,
      producedAt: today,
      content: [
        line('Date', r.paidOn),
        line('Received from', r.memberName),
        line('Phone', r.memberPhone),
        line('For', r.forWhat),
        ...(r.reverses ? [line('Reverses receipt', r.reverses)] : []),
        line('Amount', `Rs. ${formatRupees(r.amountCents)}`),
        line('Taken by', r.collectedByName),
        txt(
          r.kind === 'settlement'
            ? 'Lost-book money is kept apart from membership fees.'
            : 'Thank you for supporting the library.',
          { fontSize: 9, color: '#5c6763', margin: [0, 18, 0, 0] },
        ),
        txt('Personal data — keep it safe (Personal Data Protection Act No. 9 of 2022).', {
          fontSize: 8,
          color: '#5c6763',
          margin: [0, 6, 0, 0],
        }),
      ],
    });
    await this.uow.run(ctx.actor, async (_tx, log) => {
      await log({
        action: 'receipt.print',
        entity: r.kind === 'membership' ? 'membership_payment' : 'settlement_payment',
        entityId: r.paymentId,
        branchId: r.branchId,
        after: { receiptNo: r.receiptNo, memberId: r.memberId },
      });
    });
    return {
      body,
      contentType: 'application/pdf',
      filename: `receipt-${r.receiptNo.replace(/[^A-Za-z0-9-]+/g, '_')}.pdf`,
    };
  }
}

const notFound = () => AppError.notFound('payment_not_found', 'No such payment.');
