import { z } from 'zod';
import { normalizePhone } from './phone.js';
import { USER_TYPES } from './roles.js';

/** A phone number as typed, normalised to its stored form (NFR-15). */
export const phoneSchema = z.string().transform((value, ctx) => {
  const phone = normalizePhone(value);
  if (!phone) {
    ctx.addIssue({ code: 'custom', message: 'Not a valid phone number' });
    return z.NEVER;
  }
  return phone;
});

export const USER_STATUSES = [
  'pending',
  'active',
  'suspended',
  'rejected',
  'deactivated',
  'anonymised',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// ─── Requests ───────────────────────────────────────────────────────────────

export const signInRequestSchema = z.object({
  whatsappPhone: z.string().min(1),
  password: z.string().min(1).max(256),
});
export type SignInRequest = z.infer<typeof signInRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const STAFF_TYPES = ['admin', 'super_admin'] as const;

export const createStaffRequestSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    whatsappPhone: phoneSchema,
    userType: z.enum(STAFF_TYPES),
    branchId: z.number().int().positive().nullable(),
  })
  .refine((v) => (v.userType === 'super_admin') === (v.branchId === null), {
    message: 'An admin belongs to one branch; a super admin to none',
    path: ['branchId'],
  });
export type CreateStaffRequest = z.infer<typeof createStaffRequestSchema>;

export const deactivateRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type DeactivateRequest = z.infer<typeof deactivateRequestSchema>;

// ─── Responses ──────────────────────────────────────────────────────────────

export const sessionUserSchema = z.object({
  id: z.number().int(),
  fullName: z.string(),
  userType: z.enum(USER_TYPES),
  status: z.enum(USER_STATUSES),
  branchId: z.number().int().nullable(),
  whatsappPhone: z.string(),
  mustChangePassword: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const signInResponseSchema = z.object({
  token: z.string(),
  user: sessionUserSchema,
});
export type SignInResponse = z.infer<typeof signInResponseSchema>;

export const WARNINGS = ['fewer_than_two_super_admins'] as const;

export const meResponseSchema = z.object({
  user: sessionUserSchema,
  warnings: z.array(z.enum(WARNINGS)),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const staffMemberSchema = z.object({
  id: z.number().int(),
  fullName: z.string(),
  userType: z.enum(STAFF_TYPES),
  status: z.enum(USER_STATUSES),
  branchId: z.number().int().nullable(),
  whatsappPhone: z.string().nullable(),
  mustChangePassword: z.boolean(),
  lockedUntil: z.iso.datetime().nullable(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

export const temporaryPasswordResponseSchema = z.object({
  userId: z.number().int(),
  /** Shown once to the staff member who asked for it; never stored or logged. */
  temporaryPassword: z.string(),
});
export type TemporaryPasswordResponse = z.infer<typeof temporaryPasswordResponseSchema>;

/** Every error the API returns has a stable code the web app can translate. */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
