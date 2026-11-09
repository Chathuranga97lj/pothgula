import { daysLate, isOverdue, type Loan } from '@pothgula/shared';
import { eq } from 'drizzle-orm';
import type { Queryable } from '../db/client';
import { appUser, borrow, copy, title } from '../db/schema';

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
};

export interface LoanRow {
  borrow: typeof borrow.$inferSelect;
  accessionNo: string;
  titleId: number;
  title: string;
  writer: string | null;
  memberName: string;
  memberPhone: string | null;
}

/** Days late and overdue are worked out here from the dates, never stored (R2). */
export function toLoan(r: LoanRow, today: string): Loan {
  const b = r.borrow;
  const voided = b.voidedAt !== null;
  const dates = { dueDate: b.dueDate, returnedOn: b.returnedOn, voided };
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
    status: voided ? 'void' : b.returnedOn ? 'returned' : 'open',
    overdue: isOverdue(dates, today),
    daysLate: daysLate(dates, today),
    isBackdated: b.isBackdated,
    returnBackdated: b.returnBackdated,
    voidedAt: b.voidedAt?.toISOString() ?? null,
    voidReason: b.voidReason,
  };
}
