import { Inject, Injectable } from '@nestjs/common';
import {
  type AddClosure,
  addDays,
  type BranchHours,
  branchStatus,
  CLOSURES_AHEAD_DAYS,
  daysBetween,
  type DayHours,
  nowColomboTime,
  type SaveWeek,
  type Timetable,
  todayColombo,
  WEEKDAYS,
} from '@pothgula/shared';
import { and, asc, between, eq, isNull } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { UnitOfWork } from '../audit/unit-of-work';
import { AppError } from '../common/app-error';
import { assertBranchAccess } from '../common/scope';
import type { Db, Queryable } from '../db/client';
import { DB } from '../db/db.module';
import { branch, branchClosure, branchSchedule } from '../db/schema';

/** Postgres gives times as HH:MM:SS; the app speaks HH:MM. */
const hm = (t: string | null) => (t === null ? null : t.slice(0, 5));

/**
 * A branch's weekly pattern and its closures from `from` for `days` days — what
 * `branchStatus`, `hoursOn` and `nextOpenDay` need. Read anywhere a date must
 * respect opening hours (a hold's last day, the member's panel).
 */
export async function timetable(
  q: Queryable,
  branchId: number,
  from: string,
  days: number,
): Promise<Timetable> {
  const rows = await q.select().from(branchSchedule).where(eq(branchSchedule.branchId, branchId));
  const closures = await q
    .select({ id: branchClosure.id, date: branchClosure.closedOn, reason: branchClosure.reason })
    .from(branchClosure)
    .where(
      and(
        eq(branchClosure.branchId, branchId),
        isNull(branchClosure.withdrawnAt),
        between(branchClosure.closedOn, from, addDays(from, days)),
      ),
    )
    .orderBy(asc(branchClosure.closedOn));
  return {
    configured: rows.length > 0,
    week: WEEKDAYS.map((weekday): DayHours => {
      const r = rows.find((x) => x.weekday === weekday);
      return { weekday, open: hm(r?.openTime ?? null), close: hm(r?.closeTime ?? null) };
    }),
    closures,
  };
}

/**
 * §11: opening hours. Any signed-in person may look up any branch's hours
 * (FR-SCH-03, applicants too); staff of the branch, and super admins, change
 * them. Every change is logged against the branch (FR-LOG-04).
 */
@Injectable()
export class HoursService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  async get(branchId: number, q: Queryable = this.db): Promise<BranchHours> {
    const [b] = await q
      .select({ id: branch.id, code: branch.branchCode, name: branch.branchName })
      .from(branch)
      .where(eq(branch.id, branchId));
    if (!b) throw AppError.notFound('branch_not_found', 'No such branch.');
    const today = todayColombo();
    const t = await timetable(q, branchId, today, CLOSURES_AHEAD_DAYS);
    return {
      branch: b,
      configured: t.configured,
      week: t.week,
      closures: t.closures,
      today,
      status: branchStatus(today, nowColomboTime(), t),
    };
  }

  /** FR-SCH-01: the whole week at once, logged with the old and new pattern. */
  async saveWeek(ctx: AuthContext, branchId: number, body: SaveWeek): Promise<BranchHours> {
    assertBranchAccess(ctx.user, branchId);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const before = await this.get(branchId, tx);
      for (const d of body.week) {
        const values = { openTime: d.open, closeTime: d.close, updatedBy: ctx.user.id };
        await tx
          .insert(branchSchedule)
          .values({ branchId, weekday: d.weekday, ...values })
          .onConflictDoUpdate({
            target: [branchSchedule.branchId, branchSchedule.weekday],
            set: values,
          });
      }
      await log({
        action: 'hours.update',
        entity: 'branch',
        entityId: branchId,
        branchId,
        before: { week: before.configured ? describe(before.week) : null },
        after: { week: describe(body.week) },
      });
      return this.get(branchId, tx);
    });
  }

  /** FR-SCH-02, FR-SCH-05: one date or a run of dates closed, with the reason. */
  async addClosure(ctx: AuthContext, branchId: number, body: AddClosure): Promise<BranchHours> {
    assertBranchAccess(ctx.user, branchId);
    const today = todayColombo();
    if (body.from < today) {
      throw AppError.badRequest('date_in_past', 'Closures are recorded for today or later.');
    }
    const to = body.to ?? body.from;
    const dates = Array.from({ length: daysBetween(body.from, to) + 1 }, (_, i) =>
      addDays(body.from, i),
    );
    return this.uow.run(ctx.actor, async (tx, log) => {
      const added = await tx
        .insert(branchClosure)
        .values(
          dates.map((closedOn) => ({
            branchId,
            closedOn,
            reason: body.reason,
            createdBy: ctx.user.id,
          })),
        )
        .onConflictDoNothing()
        .returning({ date: branchClosure.closedOn });
      if (added.length === 0) {
        throw AppError.conflict('already_closed', 'The branch is already closed on those dates.');
      }
      await log({
        action: 'closure.add',
        entity: 'branch',
        entityId: branchId,
        branchId,
        after: { dates: added.map((a) => a.date), reason: body.reason },
      });
      return this.get(branchId, tx);
    });
  }

  /** A closure entered by mistake is withdrawn, never deleted (R12). */
  async withdrawClosure(ctx: AuthContext, id: number): Promise<BranchHours> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [c] = await tx
        .select()
        .from(branchClosure)
        .where(eq(branchClosure.id, id))
        .for('update');
      if (!c || c.withdrawnAt) throw AppError.notFound('closure_not_found', 'No such closure.');
      assertBranchAccess(ctx.user, c.branchId);
      await tx
        .update(branchClosure)
        .set({ withdrawnAt: new Date(), withdrawnBy: ctx.user.id })
        .where(eq(branchClosure.id, id));
      await log({
        action: 'closure.withdraw',
        entity: 'branch',
        entityId: c.branchId,
        branchId: c.branchId,
        before: { date: c.closedOn, reason: c.reason },
      });
      return this.get(c.branchId, tx);
    });
  }
}

/** "Mon 09:00–17:00, …, Sun closed", for the log. */
function describe(week: DayHours[]): string[] {
  const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return week
    .toSorted((a, b) => a.weekday - b.weekday)
    .map((d) => `${names[d.weekday]} ${d.open ? `${d.open}–${d.close}` : 'closed'}`);
}
