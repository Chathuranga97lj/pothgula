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
      /**
       * A scheduled job, the install command, the seed script — or a request
       * with no signed-in user, such as a failed sign-in (its IP is kept).
       */
      kind: 'system';
      ipAddress?: string | null;
    };

export const SYSTEM_ACTOR: Actor = { kind: 'system' };
