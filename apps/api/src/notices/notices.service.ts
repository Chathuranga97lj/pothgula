import { Inject, Injectable } from '@nestjs/common';
import {
  type Notice,
  type NoticeBoard,
  type NoticeValues,
  noticeState,
  todayColombo,
} from '@pothgula/shared';
import { and, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { UnitOfWork } from '../audit/unit-of-work';
import { AppError } from '../common/app-error';
import { assertBranchAccess } from '../common/scope';
import type { Db, Queryable } from '../db/client';
import { DB } from '../db/db.module';
import { appUser, branch, notice, noticeRead } from '../db/schema';
import { processImage, storeImage } from '../images/images';

type NoticeRow = typeof notice.$inferSelect;
const hm = (t: string | null) => (t === null ? null : t.slice(0, 5));
const notFound = () => AppError.notFound('notice_not_found', 'No such notice.');

/**
 * §12: notices and events. Staff of a branch publish for it; a super admin for
 * any branch or every branch at once (FR-PUB-01). Everyone signed in — members,
 * applicants and staff — reads them (FR-PUB-04). Nothing is deleted: a notice
 * is withdrawn and can be shown again (FR-PUB-03, FR-PUB-06), each step logged.
 */
@Injectable()
export class NoticesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  /** FR-PUB-04: what a branch's members see today: its own and the library-wide ones. */
  async board(ctx: AuthContext, branchId: number): Promise<NoticeBoard> {
    const [b] = await this.db
      .select({ id: branch.id, code: branch.branchCode, name: branch.branchName })
      .from(branch)
      .where(eq(branch.id, branchId));
    if (!b) throw AppError.notFound('branch_not_found', 'No such branch.');
    const all = await this.rows(
      ctx,
      and(or(eq(notice.branchId, branchId), isNull(notice.branchId)), isNull(notice.withdrawnAt)),
    );
    const shown = all.filter((n) => n.state === 'shown');
    return {
      branch: b,
      notices: shown.filter((n) => n.kind === 'notice'),
      // Soonest first; those already past go after the coming ones (FR-PUB-02).
      events: shown.filter((n) => n.kind === 'event').toSorted(byWhen),
    };
  }

  /** The staff list: an admin's own branch and the library-wide ones; a super admin's every one. */
  async manage(ctx: AuthContext, branchId: number | null): Promise<Notice[]> {
    const user = ctx.user;
    if (branchId !== null) assertBranchAccess(user, branchId);
    const scope = branchId ?? (user.userType === 'super_admin' ? null : user.branchId);
    return this.rows(
      ctx,
      scope === null ? undefined : or(eq(notice.branchId, scope), isNull(notice.branchId)),
    );
  }

  /**
   * One notice. A member opening an important one is recorded, so it leaves their
   * panel (FR-PUB-07) — a read receipt, not a change to any record, so not logged.
   */
  async detail(ctx: AuthContext, id: number): Promise<Notice> {
    const n = await this.one(ctx, id);
    const staff = ctx.user.userType !== 'member';
    if (!staff && n.state !== 'shown') throw notFound();
    if (!staff && n.isImportant && !n.opened) {
      await this.db
        .insert(noticeRead)
        .values({ noticeId: id, userId: ctx.user.id })
        .onConflictDoNothing();
      return { ...n, opened: true };
    }
    return n;
  }

  /** FR-PUB-07: important notices shown to this member that they have not opened yet. */
  async unopenedImportant(ctx: AuthContext, branchId: number): Promise<Notice[]> {
    const board = await this.board(ctx, branchId);
    return [...board.notices, ...board.events].filter((n) => n.isImportant && !n.opened);
  }

  async create(ctx: AuthContext, input: NoticeValues): Promise<Notice> {
    this.assertMayPublishFor(ctx, input.branchId);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [row] = await tx
        .insert(notice)
        .values({ ...values(input), createdBy: ctx.user.id })
        .returning();
      await log({
        action: 'notice.publish',
        entity: 'notice',
        entityId: row!.id,
        branchId: row!.branchId,
        after: loggable(row!),
      });
      return this.one(ctx, row!.id, tx);
    });
  }

  /** FR-PUB-06: the whole notice again; the old and new values are logged. */
  async update(ctx: AuthContext, id: number, input: NoticeValues): Promise<Notice> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const before = await this.lock(tx, ctx, id);
      this.assertMayPublishFor(ctx, input.branchId);
      const [after] = await tx
        .update(notice)
        .set(values(input))
        .where(eq(notice.id, id))
        .returning();
      const was = loggable(before);
      const now = loggable(after!);
      const changed = Object.keys(now).filter(
        (k) => JSON.stringify(was[k]) !== JSON.stringify(now[k]),
      );
      if (changed.length === 0) {
        throw AppError.badRequest('nothing_to_change', 'The notice already says that.');
      }
      await log({
        action: 'notice.update',
        entity: 'notice',
        entityId: id,
        branchId: after!.branchId,
        before: Object.fromEntries(changed.map((k) => [k, was[k]])),
        after: Object.fromEntries(changed.map((k) => [k, now[k]])),
      });
      return this.one(ctx, id, tx);
    });
  }

  /** FR-PUB-03, FR-PUB-06: taken down, kept, and can be shown again. */
  async setWithdrawn(ctx: AuthContext, id: number, withdrawn: boolean): Promise<Notice> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const before = await this.lock(tx, ctx, id);
      if ((before.withdrawnAt !== null) === withdrawn) {
        throw AppError.conflict(
          withdrawn ? 'notice_withdrawn' : 'notice_not_withdrawn',
          withdrawn ? 'This notice is already withdrawn.' : 'This notice is not withdrawn.',
        );
      }
      await tx
        .update(notice)
        .set({ withdrawnAt: withdrawn ? new Date() : null })
        .where(eq(notice.id, id));
      await log({
        action: withdrawn ? 'notice.withdraw' : 'notice.restore',
        entity: 'notice',
        entityId: id,
        branchId: before.branchId,
        after: { title: before.title },
      });
      return this.one(ctx, id, tx);
    });
  }

  /** FR-PUB-05: the picture, checked, resized and stored inside the system. */
  async setImage(ctx: AuthContext, id: number, file: Buffer | null): Promise<Notice> {
    const processed = file === null ? null : await processImage(file, 'notice');
    return this.uow.run(ctx.actor, async (tx, log) => {
      const before = await this.lock(tx, ctx, id);
      const imageId = processed
        ? await storeImage(tx, log, processed, ctx.user.id, before.branchId)
        : null;
      if (imageId === null && before.imageId === null) {
        throw AppError.badRequest('nothing_to_change', 'The notice has no picture.');
      }
      await tx.update(notice).set({ imageId }).where(eq(notice.id, id));
      await log({
        action: 'notice.image',
        entity: 'notice',
        entityId: id,
        branchId: before.branchId,
        before: { imageId: before.imageId },
        after: { imageId },
      });
      return this.one(ctx, id, tx);
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** An admin publishes for their own branch; only a super admin for every branch (FR-PUB-01). */
  private assertMayPublishFor(ctx: AuthContext, branchId: number | null): void {
    if (branchId === null) {
      if (ctx.user.userType !== 'super_admin') {
        throw AppError.forbidden(
          'super_admin_only',
          'Only a super admin publishes for every branch.',
        );
      }
      return;
    }
    assertBranchAccess(ctx.user, branchId);
  }

  /** The notice, locked, if this member of staff may change it (FR-PUB-06). */
  private async lock(q: Queryable, ctx: AuthContext, id: number): Promise<NoticeRow> {
    const [row] = await q.select().from(notice).where(eq(notice.id, id)).for('update');
    if (!row) throw notFound();
    this.assertMayPublishFor(ctx, row.branchId);
    return row;
  }

  private async one(ctx: AuthContext, id: number, q: Queryable = this.db): Promise<Notice> {
    const [n] = await this.rows(ctx, eq(notice.id, id), q);
    if (!n) throw notFound();
    return n;
  }

  private async rows(
    ctx: AuthContext,
    where: SQL | undefined,
    q: Queryable = this.db,
  ): Promise<Notice[]> {
    const today = todayColombo();
    const rows = await q
      .select({
        n: notice,
        branch: { id: branch.id, code: branch.branchCode, name: branch.branchName },
        createdByName: appUser.fullName,
      })
      .from(notice)
      .leftJoin(branch, eq(branch.id, notice.branchId))
      .innerJoin(appUser, eq(appUser.id, notice.createdBy))
      .where(where)
      .orderBy(desc(notice.createdAt), desc(notice.id));
    const ids = rows.map((r) => r.n.id);
    const opened =
      ctx.user.userType === 'member' && ids.length > 0
        ? new Set(
            (
              await q
                .select({ id: noticeRead.noticeId })
                .from(noticeRead)
                .where(and(eq(noticeRead.userId, ctx.user.id), inArray(noticeRead.noticeId, ids)))
            ).map((r) => r.id),
          )
        : new Set<number>();
    return rows.map(({ n, branch: b, createdByName }): Notice => {
      const view = {
        kind: n.kind,
        eventDate: n.eventDate,
        showFrom: n.showFrom,
        showUntil: n.showUntil,
        withdrawnAt: n.withdrawnAt?.toISOString() ?? null,
      };
      return {
        id: n.id,
        kind: n.kind,
        branch: b && b.id !== null ? b : null,
        title: n.title,
        body: n.body,
        imageId: n.imageId,
        eventDate: n.eventDate,
        startTime: hm(n.startTime),
        endTime: hm(n.endTime),
        venue: n.venue,
        showFrom: n.showFrom,
        showUntil: n.showUntil,
        isImportant: n.isImportant,
        withdrawnAt: view.withdrawnAt,
        createdByName,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
        state: noticeState(view, today),
        past: n.kind === 'event' && n.eventDate !== null && n.eventDate < today,
        opened: opened.has(n.id),
      };
    });
  }
}

/** Coming events soonest first, then those just past, the latest first. */
function byWhen(x: Notice, y: Notice): number {
  const when = (n: Notice) => `${n.eventDate} ${n.startTime}`;
  if (x.past !== y.past) return x.past ? 1 : -1;
  return x.past ? when(y).localeCompare(when(x)) : when(x).localeCompare(when(y));
}

function values(input: NoticeValues) {
  const event = input.kind === 'event';
  return {
    kind: input.kind,
    branchId: input.branchId,
    title: input.title,
    body: input.body,
    eventDate: event ? (input.eventDate ?? null) : null,
    startTime: event ? (input.startTime ?? null) : null,
    endTime: event ? (input.endTime ?? null) : null,
    venue: event ? (input.venue ?? null) : null,
    showFrom: input.showFrom ?? null,
    showUntil: input.showUntil ?? null,
    isImportant: input.isImportant,
  };
}

function loggable(n: NoticeRow): Record<string, unknown> {
  return {
    kind: n.kind,
    branchId: n.branchId,
    title: n.title,
    body: n.body,
    eventDate: n.eventDate,
    startTime: hm(n.startTime),
    endTime: hm(n.endTime),
    venue: n.venue,
    showFrom: n.showFrom,
    showUntil: n.showUntil,
    isImportant: n.isImportant,
  };
}
