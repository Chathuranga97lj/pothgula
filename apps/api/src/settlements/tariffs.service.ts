import { Inject, Injectable } from '@nestjs/common';
import { formatRupees, type SaveTariff, type Tariff } from '@pothgula/shared';
import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AuthContext } from '../auth/auth-context';
import { UnitOfWork } from '../audit/unit-of-work';
import { AppError } from '../common/app-error';
import { assertBranchAccess } from '../common/scope';
import type { Db, Queryable } from '../db/client';
import { DB } from '../db/db.module';
import { appUser, branch, category, lostTariff } from '../db/schema';
import type { ExportTable } from '../exports/table-export';

const editor = alias(appUser, 'editor');

/**
 * FR-LST-16: each branch's lost-book tariff — an amount per category, kept by
 * that branch's admins and by super admins. Every change is logged with the old
 * and new amounts. A category without an amount leaves the figure to staff.
 */
@Injectable()
export class TariffsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  async get(ctx: AuthContext, branchId: number, q: Queryable = this.db): Promise<Tariff> {
    assertBranchAccess(ctx.user, branchId);
    const [b] = await q
      .select({ id: branch.id, code: branch.branchCode, name: branch.branchName })
      .from(branch)
      .where(eq(branch.id, branchId));
    if (!b) throw AppError.notFound('branch_not_found', 'No such branch.');
    const rows = await q
      .select({
        categoryCode: category.code,
        categoryName: category.name,
        categoryActive: category.isActive,
        amountCents: lostTariff.amountCents,
        updatedAt: lostTariff.updatedAt,
        updatedByName: editor.fullName,
      })
      .from(category)
      .leftJoin(
        lostTariff,
        and(eq(lostTariff.categoryCode, category.code), eq(lostTariff.branchId, branchId)),
      )
      .leftJoin(editor, eq(editor.id, lostTariff.updatedBy))
      .orderBy(asc(category.code));
    return {
      branch: b,
      rows: rows.map((r) => ({
        ...r,
        amountCents: r.amountCents ?? null,
        updatedAt: r.updatedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Saves the amounts that changed, one log entry each with the old and new figures. */
  async save(ctx: AuthContext, branchId: number, body: SaveTariff): Promise<Tariff> {
    assertBranchAccess(ctx.user, branchId);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const current = await this.get(ctx, branchId, tx);
      let changed = 0;
      for (const { categoryCode, amountCents } of body.amounts) {
        const row = current.rows.find((r) => r.categoryCode === categoryCode);
        if (!row) throw AppError.badRequest('category_not_found', 'No such category.');
        if (row.amountCents === amountCents) continue;
        await tx
          .insert(lostTariff)
          .values({ branchId, categoryCode, amountCents, updatedBy: ctx.user.id })
          .onConflictDoUpdate({
            target: [lostTariff.branchId, lostTariff.categoryCode],
            set: { amountCents, updatedBy: ctx.user.id },
          });
        await log({
          action: 'tariff.update',
          entity: 'lost_tariff',
          entityId: `${current.branch.code}-${categoryCode}`,
          branchId,
          before: { categoryCode, amountCents: row.amountCents },
          after: { categoryCode, amountCents },
        });
        changed++;
      }
      if (changed === 0) {
        throw AppError.badRequest('nothing_to_change', 'The tariff already says that.');
      }
      return this.get(ctx, branchId, tx);
    });
  }

  /** The tariff as a table, for printing at the counter. */
  async table(ctx: AuthContext, branchId: number): Promise<{ tariff: Tariff; table: ExportTable }> {
    const tariff = await this.get(ctx, branchId);
    return {
      tariff,
      table: {
        title: `Lost-book tariff — ${tariff.branch.code} ${tariff.branch.name}`,
        about: [
          'The amount a member pays for a lost or ruined book, by category, unless they bring a copy of the same book.',
          'A category with no amount is decided by staff at the counter.',
        ],
        columns: [
          { header: 'Category', width: 60 },
          { header: 'Name', width: '*' },
          { header: 'Amount (Rs.)', width: 90, numeric: true },
        ],
        rows: tariff.rows
          .filter((r) => r.categoryActive || r.amountCents !== null)
          .map((r) => [
            r.categoryCode,
            r.categoryName,
            r.amountCents === null ? '—' : formatRupees(r.amountCents),
          ]),
        textLayout: 'columns',
      },
    };
  }
}
