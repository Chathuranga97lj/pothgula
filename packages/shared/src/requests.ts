import { z } from 'zod';
import { loanSchema } from './circulation.js';
import { memberDetailSchema } from './membership.js';

/**
 * §8: a book from another branch. The copy travels to the member's home branch,
 * is held for them, issued as an ordinary loan, and travels back; its owning
 * branch and accession number never change (FR-REQ-07).
 *
 *   requested → accepted → in_transit → held → issued → returning → completed
 *   requested → declined | cancelled
 *   held → lapsed → returning → completed      (not collected in time)
 *   in_transit | returning → lost_in_transit    (the library's loss, FR-REQ-14)
 *
 * `returning` covers the copy's way home: waiting at the member's branch to be
 * sent (`returnDispatchedAt` null), then on the road.
 */
export const REQUEST_STATUSES = [
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
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** FR-REQ-02: "one request open at a time" — open until the copy is issued or the request ends. */
export const OPEN_REQUEST_STATUSES = ['requested', 'accepted', 'in_transit', 'held'] as const;

/** The request has a copy set apart for it, away from its shelf (FR-REQ-04, FR-REQ-08). */
export const COPY_AWAY_STATUSES = [
  'accepted',
  'in_transit',
  'held',
  'lapsed',
  'returning',
] as const;

/** FR-REQ-09: a held copy whose hold ends within this many days is flagged. */
export const HOLD_LAPSING_DAYS = 2;

/**
 * Why a member cannot request, or staff cannot take a step (FR-REQ-02, FR-REQ-04).
 * Each is also an error code, translated by the web app. A request is also
 * refused for every FR-CIR-02 reason that concerns the member.
 */
export const REQUEST_REFUSALS = [
  'request_open',
  'own_branch',
  'none_on_shelf',
  'request_not_found',
  'wrong_step',
  'copy_not_on_shelf',
  'hold_not_over',
] as const;
export type RequestRefusalCode = (typeof REQUEST_REFUSALS)[number];

// ─── Requests ───────────────────────────────────────────────────────────────

/** FR-REQ-01: the member asks for a title from one branch. */
export const createBookRequestSchema = z.object({
  titleId: z.number().int().positive(),
  fromBranchId: z.number().int().positive(),
});
export type CreateBookRequest = z.infer<typeof createBookRequestSchema>;

/** FR-REQ-04: accepting means choosing the copy to send. */
export const acceptBookRequestSchema = z.object({ copyId: z.number().int().positive() });

export const declineBookRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

/** FR-REQ-13: one dispatch, of any number of copies going out or coming back. */
export const dispatchRequestSchema = z.object({
  requestIds: z.array(z.number().int().positive()).min(1).max(100),
});

/** FR-REQ-14: a super admin writes off a copy that never arrived. */
export const markLostRequestSchema = z.object({ reason: z.string().trim().min(1).max(500) });

// ─── Views ──────────────────────────────────────────────────────────────────

const isoDate = z.iso.date();
const instant = z.iso.datetime().nullable();
const branchRef = z.object({ id: z.number().int(), code: z.string(), name: z.string() });

export const bookRequestSchema = z.object({
  id: z.number().int(),
  status: z.enum(REQUEST_STATUSES),
  titleId: z.number().int(),
  title: z.string(),
  writer: z.string().nullable(),
  /** Chosen on acceptance. */
  copyId: z.number().int().nullable(),
  accessionNo: z.string().nullable(),
  memberId: z.number().int(),
  memberName: z.string(),
  memberPhone: z.string().nullable(),
  /** The owning branch, which sends the copy. */
  from: branchRef,
  /** The member's home branch, where it is held and issued. */
  to: branchRef,
  requestedAt: z.iso.datetime(),
  decidedAt: instant,
  declineReason: z.string().nullable(),
  dispatchedAt: instant,
  arrivedAt: instant,
  /** The last day it is held for the member (FR-REQ-05). */
  holdUntil: isoDate.nullable(),
  /** The loan, once issued. */
  borrowId: z.number().int().nullable(),
  returnDispatchedAt: instant,
  returnArrivedAt: instant,
  /** Days on the road so far, while travelling either way (FR-REQ-12). */
  daysInTransit: z.number().int().nullable(),
  /** In transit longer than the branch allows (FR-REQ-12). */
  transitOverdue: z.boolean(),
  lostReason: z.string().nullable(),
});
export type BookRequest = z.infer<typeof bookRequestSchema>;

/**
 * FR-REQ-03: what staff at either branch see — the member in full, because the
 * holding branch is lending to someone it has never met.
 */
export const bookRequestDetailSchema = bookRequestSchema.extend({
  member: memberDetailSchema,
  memberLoans: z.array(loanSchema),
  lateReturns: z.number().int(),
  lateReturnMonths: z.number().int(),
});
export type BookRequestDetail = z.infer<typeof bookRequestDetailSchema>;

/** FR-REQ-09: one branch's requests, by what needs doing. */
export const branchRequestsSchema = z.object({
  branchId: z.number().int(),
  branchCode: z.string(),
  branchName: z.string(),
  /** Asked of this branch, waiting for a decision. */
  toDecide: z.array(bookRequestSchema),
  /** Copies to send: accepted here, or coming back from here to their owners. */
  toSend: z.array(bookRequestSchema),
  /** Copies on the road to this branch, to record on arrival. */
  arriving: z.array(bookRequestSchema),
  /** Copies held here for members, the soonest lapsing first. */
  held: z.array(bookRequestSchema),
  /** Asked by this branch's members, still on their way through the steps. */
  ourMembers: z.array(bookRequestSchema),
  /** This branch's copies on loan at other branches, with their due date. */
  outElsewhere: z.array(loanSchema),
  /** FR-REQ-12: copies on the road to or from this branch for longer than allowed. */
  transitOverdue: z.array(bookRequestSchema),
});
export type BranchRequests = z.infer<typeof branchRequestsSchema>;

export const requestBoardSchema = z.object({
  today: isoDate,
  branches: z.array(branchRequestsSchema),
});
export type RequestBoard = z.infer<typeof requestBoardSchema>;
