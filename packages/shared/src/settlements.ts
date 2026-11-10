import { z } from 'zod';
import { daysBetween } from './dates.js';

/**
 * §9: lost and damaged books. A copy declared lost (or damaged beyond use) ends
 * its loan and opens a settlement owed by the member who held it. It is cleared
 * by a replacement copy of the same title or by paying the amount, within a
 * window (100 days by default); after that the member is suspended until it is
 * cleared (FR-LST-15). Only a super admin waives, reduces or extends (FR-LST-09).
 *
 *   open → replaced | paid | waived | found
 *   paid → open        (the payment reversed as a mistake)
 *   paid → found       (the copy found and the payment refunded, FR-LST-12)
 */
export const SETTLEMENT_STATUSES = ['open', 'replaced', 'paid', 'waived', 'found'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/** FR-LST-01, FR-LST-11: lost, or back but damaged beyond use — treated the same. */
export const LOSS_KINDS = ['lost', 'damaged'] as const;
export type LossKind = (typeof LOSS_KINDS)[number];

/** FR-LST-14: the staff panel shows windows closing within this many days. */
export const SETTLEMENT_CLOSING_DAYS = 14;

/** Lost-book money entries (FR-LST-07): a payment, or the entry that reverses one. */
export const SETTLEMENT_PAYMENT_KINDS = ['payment', 'reversal'] as const;
export type SettlementPaymentKind = (typeof SETTLEMENT_PAYMENT_KINDS)[number];

/**
 * Why a lost-book step is refused. Each is also an error code, translated by
 * the web app.
 */
export const SETTLEMENT_REFUSALS = [
  'loan_not_open',
  'settlement_not_found',
  'settlement_closed',
  'settlement_not_paid',
  'amount_required',
  'amount_reason_required',
  'amount_not_lower',
  'amount_mismatch',
  'window_extended',
  'payment_reversed',
  'copy_not_lost',
  'copy_lost_use_found',
] as const;
export type SettlementRefusalCode = (typeof SETTLEMENT_REFUSALS)[number];

/** Days left in a window: 0 on its last day, negative once it has passed. */
export function windowDaysLeft(windowEnds: string, today: string): number {
  return daysBetween(today, windowEnds);
}

// ─── Requests ───────────────────────────────────────────────────────────────

const reason = z.string().trim().min(1).max(500);
const cents = z.number().int().nonnegative().max(100_000_000_00);
const isoDate = z.iso.date();

/**
 * FR-LST-01, FR-LST-02: declaring the copy on an open loan lost. The amount
 * comes from the owning branch's tariff; `amountCents` sets another, and then
 * needs `amountReason`. With no tariff amount for the category, staff enter it.
 */
export const declareLostSchema = z.object({
  kind: z.enum(LOSS_KINDS),
  reason,
  amountCents: cents.optional(),
  amountReason: reason.optional(),
});
export type DeclareLost = z.infer<typeof declareLostSchema>;

/** FR-LST-07: a payment of the amount due, with its receipt number. */
export const settlementPaymentSchema = z.object({
  amountCents: cents.positive(),
  receiptNo: z.string().trim().min(1).max(50),
  /** A paper receipt entered later; today when absent. */
  paidOn: isoDate.optional(),
});
export type SettlementPaymentRequest = z.infer<typeof settlementPaymentSchema>;

/**
 * FR-LST-05, FR-LST-06: a copy of the same title accepted at the counter. It is
 * catalogued as a new copy, numbered for the branch that owned the lost one.
 */
export const settlementReplacementSchema = z.object({
  /** Where the book came from, kept on the new copy. */
  source: z.string().trim().max(200).optional(),
  priceCents: cents.optional(),
});

/** FR-LST-09: waive, with a reason (super admin). */
export const waiveSettlementSchema = z.object({ reason });

/** FR-LST-09: reduce the amount after it is set, with a reason (super admin). */
export const reduceSettlementSchema = z.object({ amountCents: cents, reason });

/** FR-LST-09: extend the window once, by a number of days (super admin). */
export const extendSettlementSchema = z.object({
  days: z.number().int().min(1).max(365),
  reason,
});

/** FR-LST-07, FR-LST-12: a payment reversed — a mistake, or a refund once the copy is found. */
export const reverseSettlementPaymentSchema = z.object({ reason });

/** FR-LST-12: a copy declared lost is found and goes back on the shelf (super admin). */
export const copyFoundSchema = z.object({ reason });

/** FR-LST-16: a branch's tariff, as saved from the tariff screen; null clears an amount. */
export const saveTariffSchema = z.object({
  amounts: z
    .array(
      z.object({
        categoryCode: z.string().regex(/^[A-Z][0-9]$/),
        amountCents: cents.nullable(),
      }),
    )
    .min(1)
    .max(260),
});
export type SaveTariff = z.infer<typeof saveTariffSchema>;

// ─── Responses ──────────────────────────────────────────────────────────────

const branchRef = z.object({ id: z.number().int(), code: z.string(), name: z.string() });

export const settlementPaymentEntrySchema = z.object({
  id: z.number().int(),
  kind: z.enum(SETTLEMENT_PAYMENT_KINDS),
  /** Negative for a reversal. */
  amountCents: z.number().int(),
  paidOn: isoDate,
  receiptNo: z.string().nullable(),
  collectedByName: z.string(),
  reason: z.string().nullable(),
  reversesPaymentId: z.number().int().nullable(),
  /** A payment that a later entry reversed. */
  reversed: z.boolean(),
});
export type SettlementPaymentEntry = z.infer<typeof settlementPaymentEntrySchema>;

export const settlementSchema = z.object({
  id: z.number().int(),
  borrowId: z.number().int(),
  copyId: z.number().int(),
  accessionNo: z.string(),
  titleId: z.number().int(),
  title: z.string(),
  categoryCode: z.string(),
  memberId: z.number().int(),
  memberName: z.string(),
  memberPhone: z.string().nullable(),
  memberOtherPhone: z.string().nullable(),
  memberStatus: z.string(),
  /** The member's home branch, where the loan was issued and the settlement is handled. */
  memberBranch: branchRef,
  /** The branch that owns the copy: its tariff, and the replacement's number. */
  copyBranch: branchRef,
  kind: z.enum(LOSS_KINDS),
  reason: z.string(),
  declaredOn: isoDate,
  declaredByName: z.string(),
  /** The tariff amount when it was declared; null if the category had none. */
  tariffCents: z.number().int().nullable(),
  /** The amount set when it was declared, and why it differs from the tariff. */
  setAmountCents: z.number().int(),
  amountReason: z.string().nullable(),
  amountSetByName: z.string(),
  /** What is owed now: the set amount, or less after a super admin reduced it. */
  amountDueCents: z.number().int(),
  reductionReason: z.string().nullable(),
  windowEnds: isoDate,
  /** Days left: 0 on the last day, negative once passed. Only meaningful while open. */
  daysLeft: z.number().int(),
  windowPassed: z.boolean(),
  windowExtendedDays: z.number().int().nullable(),
  windowExtensionReason: z.string().nullable(),
  status: z.enum(SETTLEMENT_STATUSES),
  settledOn: isoDate.nullable(),
  /** Days from declaration to clearing (FR-LST-13). */
  daysToSettle: z.number().int().nullable(),
  handledByName: z.string().nullable(),
  waiverReason: z.string().nullable(),
  replacementCopyId: z.number().int().nullable(),
  replacementAccessionNo: z.string().nullable(),
  /** FR-LST-12: the lost copy turned up again and went back on the shelf. */
  foundOn: isoDate.nullable(),
  foundReason: z.string().nullable(),
  payments: z.array(settlementPaymentEntrySchema),
  /** Paid less reversed. */
  paidCents: z.number().int(),
});
export type Settlement = z.infer<typeof settlementSchema>;

/** FR-LST-10, FR-LST-15: what each branch has open, and its suspended members. */
export const settlementBoardSchema = z.object({
  today: isoDate,
  branches: z.array(
    z.object({
      branchId: z.number().int(),
      branchCode: z.string(),
      branchName: z.string(),
      /** Open settlements, windows passed first, then by days left. */
      open: z.array(settlementSchema),
      /** Cleared in the last 30 days. */
      recent: z.array(settlementSchema),
    }),
  ),
});
export type SettlementBoard = z.infer<typeof settlementBoardSchema>;

/** FR-LST-16: one branch's tariff, a row for every category. */
export const tariffSchema = z.object({
  branch: branchRef,
  rows: z.array(
    z.object({
      categoryCode: z.string(),
      categoryName: z.string(),
      categoryActive: z.boolean(),
      amountCents: z.number().int().nullable(),
      updatedAt: z.iso.datetime().nullable(),
      updatedByName: z.string().nullable(),
    }),
  ),
});
export type Tariff = z.infer<typeof tariffSchema>;

/** What declaring would set, shown before staff confirm (FR-LST-02). */
export const lostQuoteSchema = z.object({
  loanId: z.number().int(),
  copyBranch: branchRef,
  categoryCode: z.string(),
  tariffCents: z.number().int().nullable(),
  windowDays: z.number().int(),
  windowEnds: isoDate,
});
export type LostQuote = z.infer<typeof lostQuoteSchema>;

/** A member's open settlements, for limits and the counter's callouts. */
export interface SettlementStanding {
  /** Open, window not passed. */
  open: number;
  /** Open, window passed: the member is (or is about to be) suspended. */
  passed: number;
}
