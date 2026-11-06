import { Inject, Injectable } from '@nestjs/common';
import {
  type BranchDetail,
  type BranchSettings,
  branchSettingsSchema,
  type BranchSummary,
  type CreateBranchRequest,
  type UpdateBranchRequest,
  type UpdateBranchSettingsRequest,
} from '@pothgula/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { UnitOfWork } from '../audit/unit-of-work';
import type { AuthContext } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { isPgError, PG } from '../common/pg-error';
import type { Db, Queryable } from '../db/client';
import { DB } from '../db/db.module';
import { branch, branchSetting, copy } from '../db/schema';
import { processImage, storeImage } from '../images/images';

type SettingsRow = typeof branchSetting.$inferSelect;

function toSettings(row: SettingsRow): BranchSettings {
  const { branchId: _b, updatedAt: _u, ...settings } = row;
  return settings;
}

const codeInUse = () =>
  AppError.conflict('branch_code_in_use', 'Another branch already uses this code.');
const codeLocked = () =>
  AppError.conflict(
    'branch_code_locked',
    'This code is printed on books and can no longer change.',
  );

@Injectable()
export class BranchesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  list(): Promise<BranchSummary[]> {
    return this.db
      .select({
        id: branch.id,
        code: branch.branchCode,
        name: branch.branchName,
        logoImageId: branch.logoImageId,
      })
      .from(branch)
      .orderBy(asc(branch.branchName));
  }

  async detail(id: number, q: Queryable = this.db): Promise<BranchDetail> {
    const [row] = await q
      .select({
        branch,
        settings: branchSetting,
        codeLocked: sql<boolean>`exists (select 1 from ${copy} where ${copy.accessionedBranchId} = ${branch.id})`,
      })
      .from(branch)
      .innerJoin(branchSetting, eq(branchSetting.branchId, branch.id))
      .where(eq(branch.id, id));
    if (!row) throw AppError.notFound('branch_not_found', 'No such branch.');
    return {
      id: row.branch.id,
      code: row.branch.branchCode,
      name: row.branch.branchName,
      address: row.branch.address,
      phone: row.branch.phone,
      logoImageId: row.branch.logoImageId,
      codeLocked: row.codeLocked,
      settings: toSettings(row.settings),
    };
  }

  /** FR-BRN-01: a branch, with default settings, created by a super admin. */
  async create(ctx: AuthContext, body: CreateBranchRequest): Promise<BranchDetail> {
    try {
      return await this.uow.run(ctx.actor, async (tx, log) => {
        const [row] = await tx
          .insert(branch)
          .values({
            branchName: body.branchName,
            branchCode: body.branchCode,
            address: body.address,
            phone: body.phone,
          })
          .returning();
        await tx.insert(branchSetting).values({ branchId: row!.id });
        const created = await this.detail(row!.id, tx);
        await log({
          action: 'branch.create',
          entity: 'branch',
          entityId: row!.id,
          branchId: row!.id,
          after: created,
        });
        return created;
      });
    } catch (error) {
      if (isPgError(error, PG.uniqueViolation, 'branch_branch_code_unique')) throw codeInUse();
      throw error;
    }
  }

  /** FR-BRN-02, FR-BRN-03: rename at any time; the code only until a copy carries it. */
  async update(ctx: AuthContext, id: number, body: UpdateBranchRequest): Promise<BranchDetail> {
    try {
      return await this.uow.run(ctx.actor, async (tx, log) => {
        const before = await this.detail(id, tx);
        await tx
          .update(branch)
          .set({
            branchName: body.branchName,
            branchCode: body.branchCode,
            address: body.address,
            phone: body.phone,
          })
          .where(eq(branch.id, id));
        const after = await this.detail(id, tx);
        await log({
          action: 'branch.update',
          entity: 'branch',
          entityId: id,
          branchId: id,
          before: pick(before, detailKeys(body)),
          after: pick(after, detailKeys(body)),
        });
        return after;
      });
    } catch (error) {
      if (isPgError(error, PG.uniqueViolation, 'branch_branch_code_unique')) throw codeInUse();
      if (isPgError(error, PG.checkViolation, 'branch_code_locked')) throw codeLocked();
      throw error;
    }
  }

  /** FR-BRN-04: a new logo is a new image; the old one is kept (R12). */
  async setLogo(ctx: AuthContext, id: number, file: Buffer): Promise<BranchDetail> {
    const processed = await processImage(file, 'logo');
    return this.uow.run(ctx.actor, async (tx, log) => {
      const before = await this.detail(id, tx);
      const imageId = await storeImage(tx, log, processed, ctx.user.id, id);
      await tx.update(branch).set({ logoImageId: imageId }).where(eq(branch.id, id));
      await log({
        action: 'branch.logo',
        entity: 'branch',
        entityId: id,
        branchId: id,
        before: { logoImageId: before.logoImageId },
        after: { logoImageId: imageId },
      });
      return { ...before, logoImageId: imageId };
    });
  }

  /**
   * Branch settings; only a super admin changes them (FR-MEM-06 for the fee, and
   * FR-LOG-04 "any other branch setting"). A new fee applies to payments
   * recorded from now on.
   */
  async updateSettings(
    ctx: AuthContext,
    id: number,
    changes: UpdateBranchSettingsRequest,
  ): Promise<BranchDetail> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const before = await this.detail(id, tx);
      const merged = branchSettingsSchema.safeParse({ ...before.settings, ...changes });
      if (!merged.success) {
        throw AppError.badRequest(
          'invalid_request',
          'Some of the settings are not valid together.',
          merged.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      await tx.update(branchSetting).set(merged.data).where(eq(branchSetting.branchId, id));
      await log({
        action: 'branch.settings',
        entity: 'branch_setting',
        entityId: id,
        branchId: id,
        before: pick(before.settings, Object.keys(changes)),
        after: pick(merged.data, Object.keys(changes)),
      });
      return { ...before, settings: merged.data };
    });
  }
}

/** The request's field names as they appear on a BranchDetail (branchName → name, …). */
function detailKeys(body: UpdateBranchRequest): string[] {
  const names: Record<keyof UpdateBranchRequest, keyof BranchDetail> = {
    branchName: 'name',
    branchCode: 'code',
    address: 'address',
    phone: 'phone',
  };
  return (Object.keys(body) as (keyof UpdateBranchRequest)[]).map((k) => names[k]);
}

function pick<T extends object>(obj: T, keys: string[]): Partial<T> {
  return Object.fromEntries(
    keys.filter((k) => k in obj).map((k) => [k, obj[k as keyof T]]),
  ) as Partial<T>;
}
