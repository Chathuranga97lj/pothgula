import { daysLate, isOverdue, type Loan } from '@pothgula/shared';
import { eq, sql } from 'drizzle-orm';
import type { Queryable } from '../db/client';
import { appUser, borrow, copy, title } from '../db/schema';

/**
 * The SQL side of `isOverdue` and `daysLate`: a loan with an extension request
 * waiting is neither overdue nor late (FR-CIR-13). Add it wherever SQL decides lateness.
 */
export const notProtectedByRequest = sql`${borrow.extensionStatus} <> 'requested'`;

/**
 * A loan ended by a lost declaration has `returned_on` set, but it was never
 * taken back and is not a late return (FR-LST-01). Add it wherever SQL counts late returns.
 */
export const notLost = sql`${borrow.lostDeclaredAt} IS NULL`;

/** A loan with its copy, title and member, ready for `toLoan`; add `.where()`. */
export function loanQuery(q: Queryable) {
  return q
    .select(loanColumns)
    .from(borrow)
    .innerJoin(copy, eq(copy.id, borrow.copyId))
    .innerJoin(title, eq(title.id, copy.titleId))
    .innerJoin(appUser, eq(appUser.id, borrow.userId));
}

export const loanColumns = {
  borrow,
  accessionNo: copy.accessionNo,
  titleId: copy.titleId,
  title: title.title,
  writer: title.writer,
  memberName: appUser.fullName,
  memberPhone: appUser.whatsappPhone,
  settlementId: sql<
    number | null
  >`(SELECT s.id FROM book_settlement s WHERE s.borrow_id = ${borrow.id})`,
};

export interface LoanRow {
  borrow: typeof borrow.$inferSelect;
  accessionNo: string;
  titleId: number;
  title: string;
  writer: string | null;
  memberName: string;
  memberPhone: string | null;
  settlementId: number | null;
}

/** Days late and overdue are worked out here from the dates, never stored (R2). */
export function toLoan(r: LoanRow, today: string): Loan {
  const b = r.borrow;
  const voided = b.voidedAt !== null;
  const lost = b.lostDeclaredAt !== null;
  const dates = {
    dueDate: b.dueDate,
    returnedOn: b.returnedOn,
    voided,
    extensionStatus: b.extensionStatus,
    lost,
  };
  return {
    id: b.id,
    copyId: b.copyId,
    accessionNo: r.accessionNo,
    titleId: r.titleId,
    title: r.title,
    writer: r.writer,
    memberId: b.userId,
    memberName: r.memberName,
    memberPhone: r.memberPhone,
    branchId: b.branchId,
    borrowDate: b.borrowDate,
    dueDate: b.dueDate,
    originalDueDate: b.originalDueDate,
    returnedOn: b.returnedOn,
    status: voided ? 'void' : lost ? 'lost' : b.returnedOn ? 'returned' : 'open',
    overdue: isOverdue(dates, today),
    daysLate: daysLate(dates, today),
    isBackdated: b.isBackdated,
    returnBackdated: b.returnBackdated,
    voidedAt: b.voidedAt?.toISOString() ?? null,
    voidReason: b.voidReason,
    extensionStatus: b.extensionStatus,
    extensionRequestedAt: b.extensionRequestedAt?.toISOString() ?? null,
    extensionDecidedAt: b.extensionDecidedAt?.toISOString() ?? null,
    extensionReason: b.extensionReason,
    settlementId: r.settlementId,
  };
}
