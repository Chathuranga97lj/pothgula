import { z } from 'zod';
import { phoneSchema, USER_STATUSES } from './auth.js';
import { addDays, addYears } from './dates.js';

/**
 * FR-MEM-02: a renewal paid before expiry, or within the branch's grace period
 * after it, runs a year from the old expiry date, so paying a little late gains
 * nothing. Paid later than that, a new year runs from the day of payment.
 * With no expiry on record, the year runs from payment.
 */
export function renewedExpiry(
  currentExpiry: string | null,
  paidOn: string,
  graceDays: number,
): string {
  if (currentExpiry && paidOn <= addDays(currentExpiry, graceDays)) {
    return addYears(currentExpiry, 1);
  }
  return addYears(paidOn, 1);
}

/** The area part of an address, as shown on the waiting list (FR-AUT-18): its last part. */
export function areaOf(address: string | null): string | null {
  const parts = (address ?? '')
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.at(-1) ?? null;
}

/** Where a membership stands. Expiry is worked out from the date, never stored (R2). */
export const MEMBERSHIP_STATES = [
  'pending',
  'active',
  'expired',
  'suspended',
  'rejected',
  'deactivated',
  'anonymised',
] as const;
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];

const isoDate = z.iso.date();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const optionalPhone = z
  .union([z.literal(''), z.null(), phoneSchema])
  .optional()
  .transform((v) => (v ? v : null));

/** The fields a person gives about themselves (FR-AUT-03). */
const personFields = {
  fullName: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(500),
  dateOfBirth: isoDate,
  otherPhone: optionalPhone,
  organisation: optionalText(200),
  introducedByName: z.string().trim().min(1).max(200),
  introducedByPhone: phoneSchema,
  homeBranchId: z.number().int().positive(),
};

/** FR-AUT-03, NFR-09: the public application form. */
export const applicationRequestSchema = z.object({
  ...personFields,
  whatsappPhone: phoneSchema,
  password: z.string().min(1).max(256),
  /** The applicant confirms the introducer agreed to be named. */
  introducerConsent: z.literal(true),
  /** The applicant has read the privacy notice. */
  privacyAccepted: z.literal(true),
});
export type ApplicationRequest = z.input<typeof applicationRequestSchema>;

/** FR-AUT-21: an applicant corrects their own application while it is pending. */
export const updateApplicationRequestSchema = z.object(personFields);
export type UpdateApplicationRequest = z.input<typeof updateApplicationRequestSchema>;

/** FR-AUT-21: what a member may change about themselves at any time. */
export const updateProfileRequestSchema = z
  .object({
    address: z.string().trim().min(1).max(500),
    otherPhone: optionalPhone,
    organisation: optionalText(200),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });
export type UpdateProfileRequest = z.input<typeof updateProfileRequestSchema>;

/** FR-AUT-17, FR-MEM-10: the first fee taken at approval, or (super admin) waived. */
export const firstPaymentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('first_fee'),
    amountCents: z.number().int().positive().max(100_000_000),
    receiptNo: z.string().trim().min(1).max(60),
  }),
  z.object({
    kind: z.literal('waiver'),
    reason: z.string().trim().min(1).max(500),
  }),
]);
export type FirstPayment = z.infer<typeof firstPaymentSchema>;

export const approveRequestSchema = z.object({
  /** Staff confirm they checked an identity document against the form (R18). */
  identityChecked: z.literal(true),
  payment: firstPaymentSchema,
});
export type ApproveRequest = z.infer<typeof approveRequestSchema>;

export const rejectRequestSchema = z.object({ reason: z.string().trim().min(1).max(500) });

/** FR-AUT-05: a member registered at the counter, approved in the same step. */
export const registerMemberRequestSchema = z.object({
  ...personFields,
  whatsappPhone: phoneSchema,
  introducerConsent: z.literal(true),
  identityChecked: z.literal(true),
  payment: firstPaymentSchema,
});
export type RegisterMemberRequest = z.input<typeof registerMemberRequestSchema>;

export const renewRequestSchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000),
  receiptNo: z.string().trim().min(1).max(60),
});
export type RenewRequest = z.infer<typeof renewRequestSchema>;

/** FR-MEM-05: a fee taken by mistake is corrected by a reversing entry, with the reason. */
export const reverseFeeSchema = z.object({ reason: z.string().trim().min(1).max(500) });

// ─── Responses ──────────────────────────────────────────────────────────────

/** A line on the waiting list or a search result (FR-AUT-18). */
export const memberSummarySchema = z.object({
  id: z.number().int(),
  fullName: z.string(),
  whatsappPhone: z.string().nullable(),
  branchId: z.number().int().nullable(),
  status: z.enum(USER_STATUSES),
  state: z.enum(MEMBERSHIP_STATES),
  age: z.number().int().nullable(),
  area: z.string().nullable(),
  organisation: z.string().nullable(),
  introducedByName: z.string().nullable(),
  introducedByPhone: z.string().nullable(),
  appliedAt: z.iso.datetime().nullable(),
  expireAt: isoDate.nullable(),
  /** FR-AUT-20: still pending after the branch's stale period. */
  stale: z.boolean(),
});
export type MemberSummary = z.infer<typeof memberSummarySchema>;

export const membershipPaymentSchema = z.object({
  id: z.number().int(),
  kind: z.enum(['fee', 'first_fee', 'waiver', 'reversal']),
  amountCents: z.number().int(),
  paidOn: isoDate,
  receiptNo: z.string().nullable(),
  reason: z.string().nullable(),
  extendsTo: isoDate.nullable(),
  collectedBy: z.number().int(),
  /** A reversing entry: the payment it reverses (FR-MEM-05). */
  reversesPaymentId: z.number().int().nullable(),
});
export type MembershipPayment = z.infer<typeof membershipPaymentSchema>;

/** Everything on a member's record (FR-MEM-09), for staff and for the member. */
export const memberDetailSchema = memberSummarySchema.extend({
  address: z.string().nullable(),
  otherPhone: z.string().nullable(),
  dateOfBirth: isoDate.nullable(),
  rejectionReason: z.string().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  mustChangePassword: z.boolean(),
  payments: z.array(membershipPaymentSchema),
});
export type MemberDetail = z.infer<typeof memberDetailSchema>;

export const registeredMemberResponseSchema = z.object({
  member: memberDetailSchema,
  temporaryPassword: z.string(),
});

/** FR-MEM-03: the three lists on the membership screen. */
export const membershipOverviewSchema = z.object({
  paidRecently: z.array(memberSummarySchema),
  expiringSoon: z.array(memberSummarySchema),
  expired: z.array(memberSummarySchema),
});
export type MembershipOverview = z.infer<typeof membershipOverviewSchema>;
