import {
  daysBetween,
  type Settlement,
  type SettlementPaymentEntry,
  windowDaysLeft,
} from '@pothgula/shared';
import { asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Queryable } from '../db/client';
import { appUser, bookSettlement, branch, copy, settlementPayment, title } from '../db/schema';

const member = alias(appUser, 'member');
const declarer = alias(appUser, 'declarer');
const setter = alias(appUser, 'setter');
const handler = alias(appUser, 'handler');
const collector = alias(appUser, 'collector');
const memberBranch = alias(branch, 'member_branch');
const copyBranch = alias(branch, 'copy_branch');
const replacement = alias(copy, 'replacement');

/** Settlements with everything a screen shows, payments included; add the filter. */
export async function settlementsWhere(
  q: Queryable,
  where: SQL | undefined,
  today: string,
): Promise<Settlement[]> {
  const rows = await q
    .select({
      s: bookSettlement,
      accessionNo: copy.accessionNo,
      titleId: copy.titleId,
      title: title.title,
      categoryCode: title.categoryCode,
      memberName: member.fullName,
      memberPhone: member.whatsappPhone,
      memberOtherPhone: member.otherPhone,
      memberStatus: member.status,
      memberBranch: {
        id: memberBranch.id,
        code: memberBranch.branchCode,
        name: memberBranch.branchName,
      },
      copyBranch: { id: copyBranch.id, code: copyBranch.branchCode, name: copyBranch.branchName },
      declaredByName: declarer.fullName,
      amountSetByName: setter.fullName,
      handledByName: handler.fullName,
      replacementAccessionNo: replacement.accessionNo,
    })
    .from(bookSettlement)
    .innerJoin(copy, eq(copy.id, bookSettlement.copyId))
    .innerJoin(title, eq(title.id, copy.titleId))
    .innerJoin(member, eq(member.id, bookSettlement.userId))
    .innerJoin(memberBranch, eq(memberBranch.id, bookSettlement.branchId))
    .innerJoin(copyBranch, eq(copyBranch.id, bookSettlement.copyBranchId))
    .innerJoin(declarer, eq(declarer.id, bookSettlement.declaredBy))
    .innerJoin(setter, eq(setter.id, bookSettlement.amountSetBy))
    .leftJoin(handler, eq(handler.id, bookSettlement.handledBy))
    .leftJoin(replacement, eq(replacement.id, bookSettlement.replacementCopyId))
    .where(where)
    .orderBy(desc(bookSettlement.declaredOn), desc(bookSettlement.id));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.s.id);
  const money = await q
    .select({ p: settlementPayment, collectedByName: collector.fullName })
    .from(settlementPayment)
    .innerJoin(collector, eq(collector.id, settlementPayment.collectedBy))
    .where(inArray(settlementPayment.settlementId, ids))
    .orderBy(asc(settlementPayment.id));
  const reversed = new Set(money.map((m) => m.p.reversesPaymentId).filter((id) => id !== null));

  return rows.map((r): Settlement => {
    const s = r.s;
    const payments = money
      .filter((m) => m.p.settlementId === s.id)
      .map((m): SettlementPaymentEntry => ({
        id: m.p.id,
        kind: m.p.kind,
        amountCents: m.p.amountCents,
        paidOn: m.p.paidOn,
        receiptNo: m.p.receiptNo,
        collectedByName: m.collectedByName,
        reason: m.p.reason,
        reversesPaymentId: m.p.reversesPaymentId,
        reversed: reversed.has(m.p.id),
      }));
    const daysLeft = windowDaysLeft(s.windowEnds, today);
    return {
      id: s.id,
      borrowId: s.borrowId,
      copyId: s.copyId,
      accessionNo: r.accessionNo,
      titleId: r.titleId,
      title: r.title,
      categoryCode: r.categoryCode,
      memberId: s.userId,
      memberName: r.memberName,
      memberPhone: r.memberPhone,
      memberOtherPhone: r.memberOtherPhone,
      memberStatus: r.memberStatus,
      memberBranch: r.memberBranch,
      copyBranch: r.copyBranch,
      kind: s.kind,
      reason: s.reason,
      declaredOn: s.declaredOn,
      declaredByName: r.declaredByName,
      tariffCents: s.tariffCents,
      setAmountCents: s.setAmountCents,
      amountReason: s.amountReason,
      amountSetByName: r.amountSetByName,
      amountDueCents: s.amountDueCents,
      reductionReason: s.reductionReason,
      windowEnds: s.windowEnds,
      daysLeft,
      windowPassed: s.status === 'open' && daysLeft < 0,
      windowExtendedDays: s.windowExtendedDays,
      windowExtensionReason: s.windowExtensionReason,
      status: s.status,
      settledOn: s.settledOn,
      daysToSettle: s.settledOn ? daysBetween(s.declaredOn, s.settledOn) : null,
      handledByName: r.handledByName,
      waiverReason: s.waiverReason,
      replacementCopyId: s.replacementCopyId,
      replacementAccessionNo: r.replacementAccessionNo,
      foundOn: s.foundOn,
      foundReason: s.foundReason,
      payments,
      paidCents: payments.reduce((sum, p) => sum + p.amountCents, 0),
    };
  });
}
