/**
 * Phase 1 database schema (requirements v3.1 §17).
 *
 * Rules that must hold whatever the screens do (NFR-10) are written here as
 * constraints and indexes, or in the hand-written SQL migrations under
 * `drizzle/` (triggers, the availability view). Things that can be worked out
 * from other rows — where a copy is, how late a loan was, how many late returns
 * a member has — are deliberately not stored (R2).
 *
 * Conventions: timestamps are `timestamptz` (UTC); business dates are `date`
 * strings in Asia/Colombo (NFR-05); money is `bigint` cents of LKR (NFR-14);
 * phone numbers are text (NFR-15).
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const cents = (name: string) => bigint(name, { mode: 'number' });

/** Phone numbers: digits with an optional leading +, 9 to 15 long. Text, never numeric. */
const PHONE = `'^\\+?[0-9]{9,15}$'`;

// ─── Enums ──────────────────────────────────────────────────────────────────

export const userType = pgEnum('user_type', ['member', 'admin', 'super_admin']);
export const userStatus = pgEnum('user_status', [
  'pending',
  'active',
  'suspended',
  'rejected',
  'deactivated',
  'anonymised',
]);
export const copyCondition = pgEnum('copy_condition', ['useable', 'not_useable', 'missing']);
export const paymentKind = pgEnum('payment_kind', ['fee', 'first_fee', 'waiver', 'reversal']);
/** §8: where a request for a book from another branch stands (see shared REQUEST_STATUSES). */
export const requestStatus = pgEnum('request_status', [
  'requested',
  'accepted',
  'in_transit',
  'held',
  'issued',
  'returning',
  'completed',
  'declined',
  'cancelled',
  'lapsed',
  'lost_in_transit',
]);
/** FR-CIR-10 to FR-CIR-13: where a loan's one extension stands. */
export const extensionStatus = pgEnum('extension_status', [
  'none',
  'requested',
  'approved',
  'declined',
]);
export const imageMime = pgEnum('image_mime', ['image/png', 'image/jpeg', 'image/webp']);

// ─── The library, branches and categories (§5) ─────────────────────────────

/**
 * The library itself: one row. Its name and logo are library-wide (FR-BRN-03,
 * FR-BRN-04), so they are held once here rather than copied onto every branch.
 */
export const library = pgTable(
  'library',
  {
    id: integer('id').primaryKey().default(1),
    name: text('name').notNull(),
    logoImageId: integer('logo_image_id').references((): AnyPgColumn => image.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('library_single_row', sql`${t.id} = 1`),
    check('library_name_not_blank', sql`btrim(${t.name}) <> ''`),
  ],
);

export const branch = pgTable(
  'branch',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    branchName: text('branch_name').notNull(),
    branchCode: text('branch_code').notNull().unique(),
    logoImageId: integer('logo_image_id').references((): AnyPgColumn => image.id),
    address: text('address').notNull(),
    phone: text('phone').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('branch_code_format', sql`${t.branchCode} ~ '^[A-Z]{2}$'`),
    check('branch_phone_format', sql`${t.phone} ~ ${sql.raw(PHONE)}`),
  ],
);

export const category = pgTable(
  'category',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('category_code_format', sql`${t.code} ~ '^[A-Z][0-9]$'`)],
);

export const branchSetting = pgTable(
  'branch_setting',
  {
    branchId: integer('branch_id')
      .primaryKey()
      .references(() => branch.id),
    loanDays: integer('loan_days').notNull().default(14),
    maxBooks: integer('max_books').notNull().default(2),
    maxBooksWhileSettling: integer('max_books_while_settling').notNull().default(1),
    settlementWindowDays: integer('settlement_window_days').notNull().default(100),
    staffDueWarningDays: integer('staff_due_warning_days').notNull().default(5),
    memberDueWarningDays: integer('member_due_warning_days').notNull().default(5),
    declineGraceDays: integer('decline_grace_days').notNull().default(3),
    holdDays: integer('hold_days').notNull().default(7),
    /** FR-REQ-12: days on the road before a travelling copy is flagged. */
    transitAlertDays: integer('transit_alert_days').notNull().default(7),
    applicationStaleDays: integer('application_stale_days').notNull().default(30),
    applicationAnonymiseDays: integer('application_anonymise_days').notNull().default(90),
    renewalGraceDays: integer('renewal_grace_days').notNull().default(90),
    frequentLateCount: integer('frequent_late_count').notNull().default(3),
    frequentLateMonths: integer('frequent_late_months').notNull().default(12),
    annualFeeCents: cents('annual_fee_cents').notNull().default(0),
    logRetentionMonths: integer('log_retention_months').notNull().default(24),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'branch_setting_positive',
      sql`${t.loanDays} > 0 AND ${t.maxBooks} > 0 AND ${t.maxBooksWhileSettling} >= 0
        AND ${t.maxBooksWhileSettling} <= ${t.maxBooks} AND ${t.settlementWindowDays} > 0
        AND ${t.staffDueWarningDays} >= 0 AND ${t.memberDueWarningDays} >= 0
        AND ${t.declineGraceDays} >= 0 AND ${t.holdDays} > 0 AND ${t.transitAlertDays} > 0 AND ${t.applicationStaleDays} > 0
        AND ${t.applicationAnonymiseDays} > 0 AND ${t.renewalGraceDays} >= 0
        AND ${t.frequentLateCount} > 0 AND ${t.frequentLateMonths} > 0
        AND ${t.logRetentionMonths} >= 24`,
    ),
    check('branch_setting_fee', sql`${t.annualFeeCents} >= 0`),
  ],
);

// ─── People (§4, §10) ──────────────────────────────────────────────────────

export const appUser = pgTable(
  'app_user',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    fullName: text('full_name').notNull(),
    userType: userType('user_type').notNull(),
    status: userStatus('status').notNull(),
    /** Sign-in name. Null only once the account is anonymised (FR-AUT-20). */
    whatsappPhone: text('whatsapp_phone').unique(),
    otherPhone: text('other_phone'),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    dateOfBirth: day('date_of_birth'),
    address: text('address'),
    organisation: text('organisation'),
    introducedByName: text('introduced_by_name'),
    introducedByPhone: text('introduced_by_phone'),
    /** FR-AUT-03: the applicant confirmed the introducer agreed to be named. */
    introducerConsent: boolean('introducer_consent').notNull().default(false),
    /** Home branch for members, the branch of an admin; null for super admins (R9). */
    branchId: integer('branch_id').references(() => branch.id),
    appliedAt: instant('applied_at'),
    approvedAt: instant('approved_at'),
    approvedBy: integer('approved_by').references((): AnyPgColumn => appUser.id),
    identityCheckedBy: integer('identity_checked_by').references((): AnyPgColumn => appUser.id),
    rejectionReason: text('rejection_reason'),
    suspendedAt: instant('suspended_at'),
    anonymisedAt: instant('anonymised_at'),
    expireAt: day('expire_at'),
    failedSigninCount: integer('failed_signin_count').notNull().default(0),
    lockedUntil: instant('locked_until'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'app_user_branch_by_role',
      sql`(${t.userType} = 'super_admin') = (${t.branchId} IS NULL)`,
    ),
    check(
      'app_user_anonymised_has_no_phone',
      sql`(${t.status} = 'anonymised') = (${t.whatsappPhone} IS NULL)`,
    ),
    check(
      'app_user_phone_format',
      sql`(${t.whatsappPhone} IS NULL OR ${t.whatsappPhone} ~ ${sql.raw(PHONE)})
        AND (${t.otherPhone} IS NULL OR ${t.otherPhone} ~ ${sql.raw(PHONE)})
        AND (${t.introducedByPhone} IS NULL OR ${t.introducedByPhone} ~ ${sql.raw(PHONE)})`,
    ),
    check(
      'app_user_staff_status',
      sql`${t.userType} = 'member' OR ${t.status} IN ('active', 'deactivated')`,
    ),
    check(
      'app_user_rejection_reason',
      sql`${t.status} <> 'rejected' OR ${t.rejectionReason} IS NOT NULL`,
    ),
    check('app_user_failed_signins', sql`${t.failedSigninCount} >= 0`),
    index('app_user_branch_idx').on(t.branchId, t.userType, t.status),
  ],
);

/** Opaque sign-in sessions; the token itself is never stored, only its SHA-256. */
export const session = pgTable(
  'session',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
    lastSeenAt: instant('last_seen_at').notNull().defaultNow(),
    revokedAt: instant('revoked_at'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

// ─── Images (§12, NFR-16) ──────────────────────────────────────────────────

export const image = pgTable(
  'image',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    data: bytea('data').notNull(),
    thumbnail: bytea('thumbnail').notNull(),
    mimeType: imageMime('mime_type').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    uploadedBy: integer('uploaded_by').references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [check('image_dimensions', sql`${t.width} > 0 AND ${t.height} > 0 AND ${t.bytes} > 0`)],
);

// ─── Catalogue (§6) ────────────────────────────────────────────────────────

export const title = pgTable(
  'title',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    title: text('title').notNull(),
    writer: text('writer'),
    publisher: text('publisher'),
    isbn: text('isbn'),
    edition: text('edition'),
    categoryCode: text('category_code')
      .notNull()
      .references(() => category.code),
    mergedIntoId: integer('merged_into_id').references((): AnyPgColumn => title.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('title_not_blank', sql`btrim(${t.title}) <> ''`),
    check(
      'title_not_merged_into_self',
      sql`${t.mergedIntoId} IS NULL OR ${t.mergedIntoId} <> ${t.id}`,
    ),
    index('title_isbn_idx').on(t.isbn),
    index('title_category_idx').on(t.categoryCode),
  ],
);

export const copy = pgTable(
  'copy',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    accessionNo: text('accession_no').notNull().unique(),
    titleId: integer('title_id')
      .notNull()
      .references(() => title.id),
    /** Where the copy belongs now (may change, FR-CAT-08). */
    branchId: integer('branch_id')
      .notNull()
      .references(() => branch.id),
    /** The branch that numbered it; never changes (FR-CAT-14). */
    accessionedBranchId: integer('accessioned_branch_id')
      .notNull()
      .references(() => branch.id),
    condition: copyCondition('condition').notNull().default('useable'),
    withdrawnAt: instant('withdrawn_at'),
    withdrawnReason: text('withdrawn_reason'),
    priceCents: cents('price_cents'),
    source: text('source'),
    legacyNo: text('legacy_no'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'copy_accession_format',
      sql`${t.accessionNo} ~ '^[A-Z]{2}-[A-Z][0-9]-[0-9]{5}$' AND ${t.accessionNo} !~ '-00000$'`,
    ),
    check(
      'copy_withdrawn_with_reason',
      sql`(${t.withdrawnAt} IS NULL) = (${t.withdrawnReason} IS NULL)`,
    ),
    check('copy_price', sql`${t.priceCents} IS NULL OR ${t.priceCents} >= 0`),
    index('copy_title_idx').on(t.titleId),
    index('copy_branch_idx').on(t.branchId),
  ],
);

/** Next running number per branch and category (FR-CAT-02), taken under a row lock. */
export const accessionCounter = pgTable(
  'accession_counter',
  {
    branchId: integer('branch_id')
      .notNull()
      .references(() => branch.id),
    categoryCode: text('category_code')
      .notNull()
      .references(() => category.code),
    nextRunning: integer('next_running').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.categoryCode] }),
    check('accession_counter_range', sql`${t.nextRunning} BETWEEN 1 AND 100000`),
  ],
);

// ─── Circulation (§7) ──────────────────────────────────────────────────────

export const borrow = pgTable(
  'borrow',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    copyId: integer('copy_id')
      .notNull()
      .references(() => copy.id),
    userId: integer('user_id')
      .notNull()
      .references(() => appUser.id),
    /** Branch it was issued at. */
    branchId: integer('branch_id')
      .notNull()
      .references(() => branch.id),
    borrowDate: day('borrow_date').notNull(),
    dueDate: day('due_date').notNull(),
    originalDueDate: day('original_due_date').notNull(),
    returnedOn: day('returned_on'),
    issuedBy: integer('issued_by')
      .notNull()
      .references(() => appUser.id),
    receivedBy: integer('received_by').references(() => appUser.id),
    /** When it was keyed in; differs from the dates above for back-dated entries (FR-CIR-14). */
    enteredAt: instant('entered_at').notNull().defaultNow(),
    /** The issue was entered later from paper, with its real date (FR-CIR-14). */
    isBackdated: boolean('is_backdated').notNull().default(false),
    /** The take-back was entered later from paper, with its real date (FR-CIR-14). */
    returnBackdated: boolean('return_backdated').notNull().default(false),
    voidedAt: instant('voided_at'),
    voidedBy: integer('voided_by').references(() => appUser.id),
    voidReason: text('void_reason'),
    /** FR-CIR-10 to FR-CIR-13: the loan's one extension, requested by the member or granted by staff. */
    extensionStatus: extensionStatus('extension_status').notNull().default('none'),
    /** When the member asked; null when staff granted it directly (FR-CIR-11). */
    extensionRequestedAt: instant('extension_requested_at'),
    extensionDecidedAt: instant('extension_decided_at'),
    extensionDecidedBy: integer('extension_decided_by').references(() => appUser.id),
    /** Why it was declined; the member sees it (FR-CIR-12). */
    extensionReason: text('extension_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'borrow_extension',
      sql`CASE ${t.extensionStatus}
        WHEN 'none' THEN ${t.extensionRequestedAt} IS NULL AND ${t.extensionDecidedAt} IS NULL
          AND ${t.extensionDecidedBy} IS NULL AND ${t.extensionReason} IS NULL
        WHEN 'requested' THEN ${t.extensionRequestedAt} IS NOT NULL
          AND ${t.extensionDecidedAt} IS NULL AND ${t.extensionDecidedBy} IS NULL
          AND ${t.extensionReason} IS NULL
        WHEN 'approved' THEN ${t.extensionDecidedAt} IS NOT NULL
          AND ${t.extensionDecidedBy} IS NOT NULL AND ${t.extensionReason} IS NULL
        WHEN 'declined' THEN ${t.extensionDecidedAt} IS NOT NULL
          AND ${t.extensionDecidedBy} IS NOT NULL AND ${t.extensionReason} IS NOT NULL
      END`,
    ),
    check(
      'borrow_dates',
      sql`${t.dueDate} > ${t.borrowDate} AND ${t.originalDueDate} > ${t.borrowDate}
        AND ${t.dueDate} >= ${t.originalDueDate}
        AND (${t.returnedOn} IS NULL OR ${t.returnedOn} >= ${t.borrowDate})`,
    ),
    check(
      'borrow_received_when_returned',
      sql`(${t.returnedOn} IS NULL) = (${t.receivedBy} IS NULL)`,
    ),
    check(
      'borrow_return_backdated_when_returned',
      sql`NOT ${t.returnBackdated} OR ${t.returnedOn} IS NOT NULL`,
    ),
    check(
      'borrow_void_complete',
      sql`(${t.voidedAt} IS NULL) = (${t.voidReason} IS NULL)
        AND (${t.voidedAt} IS NULL) = (${t.voidedBy} IS NULL)`,
    ),
    /** NFR-10: a copy can have only one open loan. */
    uniqueIndex('borrow_one_open_loan_per_copy')
      .on(t.copyId)
      .where(sql`${t.returnedOn} IS NULL AND ${t.voidedAt} IS NULL`),
    index('borrow_user_idx').on(t.userId),
    index('borrow_open_due_idx')
      .on(t.branchId, t.dueDate)
      .where(sql`${t.returnedOn} IS NULL AND ${t.voidedAt} IS NULL`),
    /** FR-CIR-12: the requests waiting for staff. */
    index('borrow_extension_waiting_idx')
      .on(t.branchId, t.dueDate)
      .where(
        sql`${t.extensionStatus} = 'requested' AND ${t.returnedOn} IS NULL AND ${t.voidedAt} IS NULL`,
      ),
  ],
);

// ─── Membership payments (§10) ─────────────────────────────────────────────

export const membershipPayment = pgTable(
  'membership_payment',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .references(() => appUser.id),
    kind: paymentKind('kind').notNull(),
    amountCents: cents('amount_cents').notNull(),
    paidOn: day('paid_on').notNull(),
    receiptNo: text('receipt_no'),
    collectedBy: integer('collected_by')
      .notNull()
      .references(() => appUser.id),
    reason: text('reason'),
    extendsTo: day('extends_to'),
    reversesPaymentId: integer('reverses_payment_id').references(
      (): AnyPgColumn => membershipPayment.id,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'membership_payment_by_kind',
      sql`CASE ${t.kind}
        WHEN 'fee' THEN ${t.amountCents} > 0 AND ${t.receiptNo} IS NOT NULL
          AND ${t.extendsTo} IS NOT NULL AND ${t.reversesPaymentId} IS NULL
        WHEN 'first_fee' THEN ${t.amountCents} > 0 AND ${t.receiptNo} IS NOT NULL
          AND ${t.extendsTo} IS NOT NULL AND ${t.reversesPaymentId} IS NULL
        WHEN 'waiver' THEN ${t.amountCents} = 0 AND ${t.reason} IS NOT NULL
          AND ${t.extendsTo} IS NOT NULL AND ${t.reversesPaymentId} IS NULL
        WHEN 'reversal' THEN ${t.amountCents} <= 0 AND ${t.reason} IS NOT NULL
          AND ${t.reversesPaymentId} IS NOT NULL
      END`,
    ),
    uniqueIndex('membership_payment_reversed_once').on(t.reversesPaymentId),
    index('membership_payment_user_idx').on(t.userId),
  ],
);

// ─── Books from other branches (§8) ────────────────────────────────────────

/**
 * One request: a member asking for a title held at another branch, and then the
 * journey of the copy chosen for it. Each step keeps its time and, with the
 * activity log, who took it (FR-REQ-10). Whether a copy is in transit or held is
 * worked out from here by the copy_availability view (R2).
 */
export const bookRequest = pgTable(
  'book_request',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    titleId: integer('title_id')
      .notNull()
      .references(() => title.id),
    /** Chosen by the holding branch on acceptance (FR-REQ-04). */
    copyId: integer('copy_id').references(() => copy.id),
    userId: integer('user_id')
      .notNull()
      .references(() => appUser.id),
    /** The owning branch, asked for the book. */
    fromBranchId: integer('from_branch_id')
      .notNull()
      .references(() => branch.id),
    /** The member's home branch, where it is held and issued. */
    toBranchId: integer('to_branch_id')
      .notNull()
      .references(() => branch.id),
    status: requestStatus('status').notNull().default('requested'),
    requestedAt: instant('requested_at').notNull().defaultNow(),
    decidedBy: integer('decided_by').references(() => appUser.id),
    decidedAt: instant('decided_at'),
    declineReason: text('decline_reason'),
    dispatchedAt: instant('dispatched_at'),
    arrivedAt: instant('arrived_at'),
    /** The last day it is held for the member (FR-REQ-05). */
    holdUntil: day('hold_until'),
    /** The loan it became (FR-REQ-05). */
    borrowId: integer('borrow_id').references(() => borrow.id),
    lapsedAt: instant('lapsed_at'),
    returnDispatchedAt: instant('return_dispatched_at'),
    returnArrivedAt: instant('return_arrived_at'),
    cancelledAt: instant('cancelled_at'),
    /** FR-REQ-14: why a super admin wrote the copy off. */
    lostReason: text('lost_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('book_request_branches', sql`${t.fromBranchId} <> ${t.toBranchId}`),
    check(
      'book_request_steps',
      sql`CASE ${t.status}
        WHEN 'requested' THEN ${t.copyId} IS NULL AND ${t.decidedAt} IS NULL
        WHEN 'declined' THEN ${t.copyId} IS NULL AND ${t.decidedAt} IS NOT NULL
          AND ${t.decidedBy} IS NOT NULL AND ${t.declineReason} IS NOT NULL
        WHEN 'cancelled' THEN ${t.cancelledAt} IS NOT NULL
        WHEN 'accepted' THEN ${t.copyId} IS NOT NULL AND ${t.decidedAt} IS NOT NULL
          AND ${t.decidedBy} IS NOT NULL AND ${t.dispatchedAt} IS NULL
        WHEN 'in_transit' THEN ${t.copyId} IS NOT NULL AND ${t.dispatchedAt} IS NOT NULL
          AND ${t.arrivedAt} IS NULL
        WHEN 'held' THEN ${t.arrivedAt} IS NOT NULL AND ${t.holdUntil} IS NOT NULL
          AND ${t.borrowId} IS NULL
        WHEN 'issued' THEN ${t.borrowId} IS NOT NULL
        WHEN 'lapsed' THEN ${t.lapsedAt} IS NOT NULL AND ${t.borrowId} IS NULL
          AND ${t.returnDispatchedAt} IS NULL
        WHEN 'returning' THEN ${t.copyId} IS NOT NULL AND ${t.returnArrivedAt} IS NULL
        WHEN 'completed' THEN ${t.returnArrivedAt} IS NOT NULL
        WHEN 'lost_in_transit' THEN ${t.copyId} IS NOT NULL AND ${t.lostReason} IS NOT NULL
      END`,
    ),
    /** FR-REQ-02: one request open at a time. */
    uniqueIndex('book_request_one_open_per_member')
      .on(t.userId)
      .where(sql`${t.status} IN ('requested', 'accepted', 'in_transit', 'held')`),
    /** A copy travels for one request at a time. */
    uniqueIndex('book_request_one_per_copy')
      .on(t.copyId)
      .where(sql`${t.status} IN ('accepted', 'in_transit', 'held', 'lapsed', 'returning')`),
    uniqueIndex('book_request_borrow_unique').on(t.borrowId),
    index('book_request_from_idx').on(t.fromBranchId, t.status),
    index('book_request_to_idx').on(t.toBranchId, t.status),
  ],
);

// ─── Activity log (§14) ────────────────────────────────────────────────────

/**
 * Append-only (FR-LOG-05): a trigger in `drizzle/0001_rules.sql` refuses every
 * UPDATE, DELETE and TRUNCATE, except the anonymisation redaction of FR-AUT-20.
 */
export const activityLog = pgTable(
  'activity_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: instant('at').notNull().defaultNow(),
    /** Null when the system itself acted (a scheduled job, the install command). */
    actorId: integer('actor_id').references(() => appUser.id),
    actorRole: text('actor_role').notNull(),
    branchId: integer('branch_id').references(() => branch.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    beforeData: jsonb('before_data'),
    afterData: jsonb('after_data'),
    ipAddress: text('ip_address'),
    redactedAt: instant('redacted_at'),
  },
  (t) => [
    check(
      'activity_log_actor',
      sql`${t.actorRole} IN ('member', 'admin', 'super_admin', 'system')
        AND ((${t.actorRole} = 'system') = (${t.actorId} IS NULL))`,
    ),
    index('activity_log_at_idx').on(t.at),
    index('activity_log_entity_idx').on(t.entity, t.entityId, t.at),
    index('activity_log_branch_idx').on(t.branchId, t.at),
    index('activity_log_actor_idx').on(t.actorId, t.at),
  ],
);

// ─── Views (defined in drizzle/0001_rules.sql) ─────────────────────────────

/** Where each copy is right now, worked out from loans (R2). */
export const copyAvailability = pgView('copy_availability', {
  copyId: integer('copy_id').notNull(),
  state: text('state')
    .$type<
      'withdrawn' | 'missing' | 'not_useable' | 'on_loan' | 'held' | 'in_transit' | 'on_shelf'
    >()
    .notNull(),
  openBorrowId: integer('open_borrow_id'),
  /** The request the copy is set apart for (§8). */
  openRequestId: integer('open_request_id'),
}).existing();
