import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  type Category,
  categoryCodeSchema,
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
} from '@pothgula/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { UnitOfWork } from '../audit/unit-of-work';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { isPgError, PG } from '../common/pg-error';
import { parseBody } from '../common/validate';
import type { Db, Queryable } from '../db/client';
import { DB } from '../db/db.module';
import { category, title } from '../db/schema';

const inUse = sql<boolean>`exists (select 1 from ${title} where ${title.categoryCode} = ${category.code})`;

/** FR-BRN-05 – FR-BRN-07, FR-CAT-09. Categories are library-wide; super admins define them. */
@Controller('categories')
export class CategoriesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  @Get()
  list(): Promise<Category[]> {
    return this.db
      .select({ code: category.code, name: category.name, isActive: category.isActive, inUse })
      .from(category)
      .orderBy(asc(category.code));
  }

  @Post()
  @Roles('super_admin')
  async create(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<Category> {
    const input = parseBody(createCategoryRequestSchema, body);
    try {
      return await this.uow.run(ctx.actor, async (tx, log) => {
        await tx.insert(category).values(input);
        const created = await this.find(tx, input.code);
        await log({
          action: 'category.create',
          entity: 'category',
          entityId: input.code,
          branchId: null,
          after: created,
        });
        return created;
      });
    } catch (error) {
      if (isPgError(error, PG.uniqueViolation)) {
        throw AppError.conflict('category_code_in_use', 'Another category already uses this code.');
      }
      throw error;
    }
  }

  /** The name can change at any time; the code only until a title uses it. */
  @Patch(':code')
  @Roles('super_admin')
  async update(
    @Auth() ctx: AuthContext,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<Category> {
    const current = this.codeParam(code);
    const changes = parseBody(updateCategoryRequestSchema, body);
    try {
      return await this.uow.run(ctx.actor, async (tx, log) => {
        const before = await this.find(tx, current);
        await tx.update(category).set(changes).where(eq(category.code, current));
        const after = await this.find(tx, changes.code ?? current);
        await log({
          action: 'category.update',
          entity: 'category',
          entityId: current,
          branchId: null,
          before,
          after,
        });
        return after;
      });
    } catch (error) {
      if (isPgError(error, PG.uniqueViolation)) {
        throw AppError.conflict('category_code_in_use', 'Another category already uses this code.');
      }
      if (isPgError(error, PG.foreignKeyViolation)) {
        throw AppError.conflict(
          'category_code_locked',
          'Books already carry this code, so it can no longer change. The name can.',
        );
      }
      throw error;
    }
  }

  /** FR-BRN-07: no new title joins a retired category; existing ones keep their numbers. */
  @Post(':code/retire')
  @HttpCode(200)
  @Roles('super_admin')
  retire(@Auth() ctx: AuthContext, @Param('code') code: string): Promise<Category> {
    return this.setActive(ctx, this.codeParam(code), false);
  }

  @Post(':code/reinstate')
  @HttpCode(200)
  @Roles('super_admin')
  reinstate(@Auth() ctx: AuthContext, @Param('code') code: string): Promise<Category> {
    return this.setActive(ctx, this.codeParam(code), true);
  }

  private setActive(ctx: AuthContext, code: string, isActive: boolean): Promise<Category> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const before = await this.find(tx, code);
      await tx.update(category).set({ isActive }).where(eq(category.code, code));
      await log({
        action: isActive ? 'category.reinstate' : 'category.retire',
        entity: 'category',
        entityId: code,
        branchId: null,
        before: { isActive: before.isActive },
        after: { isActive },
      });
      return { ...before, isActive };
    });
  }

  private async find(q: Queryable, code: string): Promise<Category> {
    const [row] = await q
      .select({ code: category.code, name: category.name, isActive: category.isActive, inUse })
      .from(category)
      .where(eq(category.code, code));
    if (!row) throw AppError.notFound('category_not_found', 'No such category.');
    return row;
  }

  private codeParam(code: string): string {
    const parsed = categoryCodeSchema.safeParse(code.toUpperCase());
    if (!parsed.success) throw AppError.badRequest('invalid_id', `Not a category code: ${code}`);
    return parsed.data;
  }
}
