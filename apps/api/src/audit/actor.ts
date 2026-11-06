import type { UserType } from '@pothgula/shared';

/** Who is making a change, as recorded in the activity log (FR-LOG-02). */
export type Actor =
  | {
      kind: 'user';
      userId: number;
      role: UserType;
      /** The actor's own branch; null for super admins. */
      branchId: number | null;
      ipAddress: string | null;
    }
  | {
      /** A scheduled job, the install command or the seed script. */
      kind: 'system';
      ipAddress?: null;
    };

export const SYSTEM_ACTOR: Actor = { kind: 'system' };
