/**
 * FR-REQ-06: a copy held for a member who has not collected it by the last day
 * lapses; staff are told on their panel and send it home. Run with the other
 * jobs; safe to run any number of times.
 */
import { todayColombo } from '@pothgula/shared';
import { and, eq, sql } from 'drizzle-orm';
import { SYSTEM_ACTOR } from '../audit/actor';
import type { UnitOfWork } from '../audit/unit-of-work';
import type { Db } from '../db/client';
import { bookRequest } from '../db/schema';

/** Lapses every hold past its last day; returns the request ids lapsed. */
export async function lapseExpiredHolds(db: Db, uow: UnitOfWork): Promise<number[]> {
  const today = todayColombo();
  const due = await db
    .select({ id: bookRequest.id })
    .from(bookRequest)
    .where(and(eq(bookRequest.status, 'held'), sql`${bookRequest.holdUntil} < ${today}`));
  const lapsed: number[] = [];
  for (const { id } of due) {
    const done = await uow.run(SYSTEM_ACTOR, async (tx, log) => {
      const [r] = await tx.select().from(bookRequest).where(eq(bookRequest.id, id)).for('update');
      // Re-checked under the lock: it may have been collected meanwhile.
      if (!r || r.status !== 'held' || !r.holdUntil || r.holdUntil >= today) {
        await log({ action: 'request.lapse_skipped', entity: 'book_request', entityId: id });
        return false;
      }
      await tx
        .update(bookRequest)
        .set({ status: 'lapsed', lapsedAt: new Date() })
        .where(eq(bookRequest.id, id));
      await log({
        action: 'request.lapse',
        entity: 'book_request',
        entityId: id,
        branchId: r.toBranchId,
        before: { status: 'held' },
        after: { status: 'lapsed', holdUntil: r.holdUntil },
      });
      return true;
    });
    if (done) lapsed.push(id);
  }
  return lapsed;
}
