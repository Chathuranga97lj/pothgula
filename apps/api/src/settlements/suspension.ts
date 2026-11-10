/**
 * FR-LST-15: a member whose lost-book settlement passes its window unsettled is
 * suspended; the suspension lifts when nothing past its window is left open.
 *
 * The stored status is kept in step by the jobs and by every step that clears
 * or extends a settlement, each logged. The counter does not wait for the job:
 * `effectiveStatus` treats a member with a passed window as suspended at once.
 */
import type { SettlementStanding } from '@pothgula/shared';
import { todayColombo } from '@pothgula/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { SYSTEM_ACTOR } from '../audit/actor';
import type { Log, UnitOfWork } from '../audit/unit-of-work';
import type { Db, Queryable, Tx } from '../db/client';
import { appUser, bookRequest, bookSettlement } from '../db/schema';

/** A member's open settlements: within the window, and past it. */
export async function settlementStanding(
  q: Queryable,
  userId: number,
  today: string,
): Promise<SettlementStanding> {
  const [row] = await q
    .select({
      open: sql<number>`count(*) filter (where ${bookSettlement.windowEnds} >= ${today})`.mapWith(
        Number,
      ),
      passed: sql<number>`count(*) filter (where ${bookSettlement.windowEnds} < ${today})`.mapWith(
        Number,
      ),
    })
    .from(bookSettlement)
    .where(and(eq(bookSettlement.userId, userId), eq(bookSettlement.status, 'open')));
  return { open: row?.open ?? 0, passed: row?.passed ?? 0 };
}

/** The status the borrowing rules should see: suspended as soon as a window has passed. */
export function effectiveStatus<S extends string>(
  status: S,
  standing: SettlementStanding,
): S | 'suspended' {
  return status === 'active' && standing.passed > 0 ? 'suspended' : status;
}

/** Any open settlement at all: the member may hold fewer books (FR-LST-04). */
export function isSettling(standing: SettlementStanding): boolean {
  return standing.open + standing.passed > 0;
}

/**
 * Suspends an active member (FR-LST-15) and ends their requests in progress:
 * not yet sent ones are cancelled; a copy already held for them goes home.
 */
export async function suspendMember(
  tx: Tx,
  log: Log,
  userId: number,
  why: { settlementIds: number[] },
): Promise<boolean> {
  const [m] = await tx.select().from(appUser).where(eq(appUser.id, userId)).for('update');
  if (!m || m.status !== 'active') return false;
  const suspendedAt = new Date();
  await tx.update(appUser).set({ status: 'suspended', suspendedAt }).where(eq(appUser.id, userId));
  await log({
    action: 'member.suspend',
    entity: 'app_user',
    entityId: userId,
    branchId: m.branchId,
    before: { status: 'active' },
    after: { status: 'suspended', settlementIds: why.settlementIds },
  });
  await endRequests(tx, log, userId);
  return true;
}

/** FR-LST-15: requests in progress end when the member is suspended. */
export async function endRequests(tx: Tx, log: Log, userId: number): Promise<number> {
  const open = await tx
    .select()
    .from(bookRequest)
    .where(
      and(
        eq(bookRequest.userId, userId),
        inArray(bookRequest.status, ['requested', 'accepted', 'held']),
      ),
    )
    .for('update');
  for (const r of open) {
    if (r.status === 'held') {
      await tx
        .update(bookRequest)
        .set({ status: 'lapsed', lapsedAt: new Date() })
        .where(eq(bookRequest.id, r.id));
      await log({
        action: 'request.lapse',
        entity: 'book_request',
        entityId: r.id,
        branchId: r.toBranchId,
        before: { status: 'held' },
        after: { status: 'lapsed', reason: 'member_suspended' },
      });
    } else {
      await tx
        .update(bookRequest)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(bookRequest.id, r.id));
      await log({
        action: 'request.cancel',
        entity: 'book_request',
        entityId: r.id,
        branchId: r.fromBranchId,
        before: { status: r.status },
        after: { status: 'cancelled', reason: 'member_suspended' },
      });
    }
  }
  return open.length;
}

/**
 * Lifts a suspension once nothing past its window is left open — after a
 * settlement is cleared, waived or extended (FR-LST-09, FR-LST-15).
 */
export async function liftIfClear(
  tx: Tx,
  log: Log,
  userId: number,
  today: string,
): Promise<boolean> {
  const [m] = await tx.select().from(appUser).where(eq(appUser.id, userId)).for('update');
  if (!m || m.status !== 'suspended') return false;
  const standing = await settlementStanding(tx, userId, today);
  if (standing.passed > 0) return false;
  await tx
    .update(appUser)
    .set({ status: 'active', suspendedAt: null })
    .where(eq(appUser.id, userId));
  await log({
    action: 'member.unsuspend',
    entity: 'app_user',
    entityId: userId,
    branchId: m.branchId,
    before: { status: 'suspended', suspendedAt: m.suspendedAt?.toISOString() ?? null },
    after: { status: 'active' },
  });
  return true;
}

/**
 * The daily job: suspends members whose window has passed, lifts any suspension
 * with nothing past its window left, and ends requests a suspended member still
 * has (a copy on the road when they were suspended is held on arrival, then
 * sent home here). Safe to run any number of times.
 */
export async function syncSuspensions(
  db: Db,
  uow: UnitOfWork,
): Promise<{ suspended: number[]; lifted: number[] }> {
  const today = todayColombo();
  const toSuspend = await db
    .selectDistinct({ userId: bookSettlement.userId })
    .from(bookSettlement)
    .innerJoin(appUser, eq(appUser.id, bookSettlement.userId))
    .where(
      and(
        eq(bookSettlement.status, 'open'),
        sql`${bookSettlement.windowEnds} < ${today}`,
        eq(appUser.status, 'active'),
      ),
    );
  const suspended: number[] = [];
  for (const { userId } of toSuspend) {
    const done = await uow.run(SYSTEM_ACTOR, async (tx, log) => {
      const passed = await tx
        .select({ id: bookSettlement.id })
        .from(bookSettlement)
        .where(
          and(
            eq(bookSettlement.userId, userId),
            eq(bookSettlement.status, 'open'),
            sql`${bookSettlement.windowEnds} < ${today}`,
          ),
        );
      // Re-checked in the transaction: it may have been settled meanwhile.
      const ok =
        passed.length > 0 &&
        (await suspendMember(tx, log, userId, {
          settlementIds: passed.map((p) => p.id),
        }));
      if (!ok) await log({ action: 'job.suspend_skipped', entity: 'app_user', entityId: userId });
      return ok;
    });
    if (done) suspended.push(userId);
  }

  const suspendedNow = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(and(eq(appUser.userType, 'member'), eq(appUser.status, 'suspended')));
  const lifted: number[] = [];
  for (const { id } of suspendedNow) {
    const standing = await settlementStanding(db, id, today);
    const pending = await db
      .select({ id: bookRequest.id })
      .from(bookRequest)
      .where(
        and(
          eq(bookRequest.userId, id),
          inArray(bookRequest.status, ['requested', 'accepted', 'held']),
        ),
      );
    if (standing.passed > 0 && pending.length === 0) continue;
    const done = await uow.run(SYSTEM_ACTOR, async (tx, log) => {
      if (standing.passed === 0) {
        const ok = await liftIfClear(tx, log, id, today);
        if (!ok) await log({ action: 'job.unsuspend_skipped', entity: 'app_user', entityId: id });
        return ok;
      }
      const ended = await endRequests(tx, log, id);
      if (ended === 0) {
        await log({ action: 'job.requests_end_skipped', entity: 'app_user', entityId: id });
      }
      return false;
    });
    if (done) lifted.push(id);
  }
  return { suspended, lifted };
}
