/** The three roles (CLAUDE.md, §3 of the requirements). */
export const USER_TYPES = ['member', 'admin', 'super_admin'] as const;
export type UserType = (typeof USER_TYPES)[number];
