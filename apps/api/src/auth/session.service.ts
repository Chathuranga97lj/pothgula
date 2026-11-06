import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { MEMBER_IDLE_MS, STAFF_IDLE_MS } from '../config';
import type { Db, Queryable } from '../db/client';
import { DB } from '../db/db.module';
import { appUser, session } from '../db/schema';
import type { UserRow } from './users';

/** Account states that may hold a session. Applicants and suspended members can still sign in. */
const MAY_SIGN_IN = new Set<UserRow['status']>(['active', 'pending', 'suspended']);

/** last_seen_at is written at most this often, to keep reads cheap. */
const TOUCH_EVERY_MS = 60_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Opaque sign-in sessions held in the database, so that they can be ended at
 * once — on password change, reset or deactivation (FR-AUT-10) — and expire
 * after inactivity (FR-AUT-07). Only a SHA-256 of the token is stored.
 */
@Injectable()
export class SessionService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Creates a session and returns the token, which is never seen again. */
  async create(q: Queryable, userId: number, meta: SessionMeta): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await q.insert(session).values({
      tokenHash: hashToken(token),
      userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    return token;
  }

  /** The signed-in user for a token, or null if the session is unknown, ended or idle too long. */
  async resolve(
    token: string,
    now = new Date(),
  ): Promise<{ user: UserRow; tokenHash: string } | null> {
    const tokenHash = hashToken(token);
    const [row] = await this.db
      .select({ session, user: appUser })
      .from(session)
      .innerJoin(appUser, eq(appUser.id, session.userId))
      .where(and(eq(session.tokenHash, tokenHash), isNull(session.revokedAt)));
    if (!row) return null;

    const idleLimit = row.user.userType === 'member' ? MEMBER_IDLE_MS : STAFF_IDLE_MS;
    const idleFor = now.getTime() - row.session.lastSeenAt.getTime();
    if (idleFor > idleLimit || !MAY_SIGN_IN.has(row.user.status)) {
      await this.db.update(session).set({ revokedAt: now }).where(eq(session.tokenHash, tokenHash));
      return null;
    }
    if (idleFor > TOUCH_EVERY_MS) {
      await this.db
        .update(session)
        .set({ lastSeenAt: now })
        .where(eq(session.tokenHash, tokenHash));
    }
    return { user: row.user, tokenHash };
  }

  async revoke(q: Queryable, tokenHash: string): Promise<void> {
    await q
      .update(session)
      .set({ revokedAt: new Date() })
      .where(and(eq(session.tokenHash, tokenHash), isNull(session.revokedAt)));
  }

  /** Ends every session of a user, optionally keeping the one making the request. */
  async revokeAllForUser(q: Queryable, userId: number, keepTokenHash?: string): Promise<void> {
    const conditions = [eq(session.userId, userId), isNull(session.revokedAt)];
    if (keepTokenHash) conditions.push(ne(session.tokenHash, keepTokenHash));
    await q
      .update(session)
      .set({ revokedAt: new Date() })
      .where(and(...conditions));
  }
}
