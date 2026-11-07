import { Inject, Injectable } from '@nestjs/common';
import {
  type AddCopiesRequest,
  type CatalogueResponse,
  type Copy,
  type CopyState,
  normalizeIsbn,
  type SimilarTitle,
  type TitleDetail,
  type TitleSummary,
} from '@pothgula/shared';
import { eq, type SQL, sql } from 'drizzle-orm';
import { type Log, UnitOfWork } from '../audit/unit-of-work';
import type { AuthContext } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { assertBranchAccess } from '../common/scope';
import type { Db, Queryable, Tx } from '../db/client';
import { DB } from '../db/db.module';
import { branch, category, copy, title } from '../db/schema';
import { allocateAccessionNumbers } from './accession';

const PAGE = 50;

export interface CatalogueFilters {
  q?: string;
  branchId?: number;
  categoryCode?: string;
  writer?: string;
  available?: boolean;
  page?: number;
}

interface TitleFields {
  title: string;
  writer: string | null;
  publisher: string | null;
  isbn: string | null;
  edition: string | null;
  categoryCode: string;
}

interface CopyFields {
  branchId: number;
  count: number;
  source: string | null;
  priceCents?: number | null;
}

const isStaff = (ctx: AuthContext) => ctx.user.userType !== 'member';
const titleNotFound = () => AppError.notFound('title_not_found', 'No such title.');
const copyNotFound = () => AppError.notFound('copy_not_found', 'No such copy.');

/** An accession-style query: `KS`, `KS-A1`, `KSA1012`, `KS-A1-01234` (FR-CAT-07). */
const ACCESSION_QUERY = /^([A-Z]{2})(?:-?([A-Z][0-9])(?:-?(\d{1,5}))?)?$/;

/**
 * The catalogue (§6): titles held once, physical copies under them (R1), and
 * where each copy is worked out from loans, never stored (R2).
 */
@Injectable()
export class CatalogueService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  // ─── Reading ───────────────────────────────────────────────────────────────

  /** FR-CAT-05 – FR-CAT-07: one line per title, filtered and searched. */
  async search(ctx: AuthContext, f: CatalogueFilters): Promise<CatalogueResponse> {
    const staff = isStaff(ctx);
    const conditions: SQL[] = [sql`t.merged_into_id IS NULL`];
    // Members see only books in the collection; staff also see titles with no copies yet.
    if (!staff)
      conditions.push(
        sql`EXISTS (SELECT 1 FROM copy c WHERE c.title_id = t.id AND c.withdrawn_at IS NULL)`,
      );
    if (f.categoryCode) conditions.push(sql`t.category_code = ${f.categoryCode}`);
    if (f.writer?.trim())
      conditions.push(sql`t.writer ILIKE ${`%${escapeLike(f.writer.trim())}%`}`);
    if (f.branchId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM copy c WHERE c.title_id = t.id AND c.branch_id = ${f.branchId} AND c.withdrawn_at IS NULL)`,
      );
    }
    if (f.available) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM copy c JOIN copy_availability a ON a.copy_id = c.id
        WHERE c.title_id = t.id AND a.state = 'on_shelf'
        ${f.branchId ? sql`AND c.branch_id = ${f.branchId}` : sql``})`);
    }

    const q = f.q?.trim();
    if (q) {
      const prefix = await this.accessionPrefix(q);
      if (prefix) {
        conditions.push(sql`EXISTS (
          SELECT 1 FROM copy c WHERE c.title_id = t.id AND c.accession_no LIKE ${`${prefix}%`}
          ${staff ? sql`` : sql`AND c.withdrawn_at IS NULL`})`);
      } else {
        const like = `%${escapeLike(q)}%`;
        const isbn = normalizeIsbn(q);
        conditions.push(sql`(t.title ILIKE ${like} OR t.writer ILIKE ${like}
          OR similarity(t.title, ${q}) > 0.35 ${isbn ? sql`OR t.isbn = ${isbn}` : sql``})`);
      }
    }

    const page = Math.max(0, f.page ?? 0);
    const rows = await this.summaries(
      this.db,
      sql.join(conditions, sql` AND `),
      sql`ORDER BY t.title LIMIT ${PAGE + 1} OFFSET ${page * PAGE}`,
    );
    return { titles: rows.slice(0, PAGE), more: rows.length > PAGE };
  }

  async detail(ctx: AuthContext, id: number, q: Queryable = this.db): Promise<TitleDetail> {
    const [summary] = await this.summaries(q, sql`t.id = ${id}`, sql``);
    if (!summary) throw titleNotFound();
    const [row] = await q
      .select({ mergedIntoId: title.mergedIntoId })
      .from(title)
      .where(eq(title.id, id));
    const staff = isStaff(ctx);
    const copies = await this.copiesOf(q, id);
    return {
      ...summary,
      mergedIntoId: row?.mergedIntoId ?? null,
      copies: staff
        ? copies
        : copies.filter((c) => c.state !== 'withdrawn').map((c) => ({ ...c, priceCents: null })),
    };
  }

  /** FR-CAT-01: titles that may be the same book, shown before a new one is created. */
  async similar(text: string, isbnInput?: string): Promise<SimilarTitle[]> {
    const isbn = isbnInput ? normalizeIsbn(isbnInput) : null;
    const q = text.trim();
    if (!q && !isbn) return [];
    const rows = await this.summaries(
      this.db,
      sql`t.merged_into_id IS NULL AND (
        ${isbn ? sql`t.isbn = ${isbn}` : sql`FALSE`}
        ${q ? sql`OR similarity(t.title, ${q}) > 0.3 OR t.title ILIKE ${`%${escapeLike(q)}%`}` : sql``})`,
      q ? sql`ORDER BY similarity(t.title, ${q}) DESC LIMIT 10` : sql`LIMIT 10`,
    );
    return rows.map((r) => ({
      ...r,
      reason: isbn && r.isbn === isbn ? 'same_isbn' : 'similar_title',
    }));
  }

  /** A copy by its accession number, typed with or without hyphens (staff). */
  async copyByAccession(
    ctx: AuthContext,
    input: string,
  ): Promise<TitleDetail & { copyId: number }> {
    const compact = input.trim().toUpperCase().replace(/-/g, '');
    const m = /^([A-Z]{2})([A-Z][0-9])(\d{5})$/.exec(compact);
    if (!m) throw copyNotFound();
    const accessionNo = `${m[1]}-${m[2]}-${m[3]}`;
    const [row] = await this.db
      .select({ id: copy.id, titleId: copy.titleId })
      .from(copy)
      .where(eq(copy.accessionNo, accessionNo));
    if (!row) throw copyNotFound();
    return { ...(await this.detail(ctx, row.titleId)), copyId: row.id };
  }

  // ─── Changing (staff) ──────────────────────────────────────────────────────

  /** FR-CAT-01: a title once, with any number of copies in the same action. */
  async createTitle(
    ctx: AuthContext,
    body: TitleFields & { copies?: CopyFields },
  ): Promise<{ title: TitleDetail; accessionNumbers: string[] }> {
    await this.assertActiveCategory(this.db, body.categoryCode);
    if (body.copies) assertBranchAccess(ctx.user, body.copies.branchId);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [row] = await tx.insert(title).values(titleValues(body)).returning();
      await log({
        action: 'title.create',
        entity: 'title',
        entityId: row!.id,
        branchId: null,
        after: row,
      });
      const accessionNumbers = body.copies
        ? await this.insertCopies(tx, log, row!.id, body.categoryCode, body.copies)
        : [];
      return { title: await this.detail(ctx, row!.id, tx), accessionNumbers };
    });
  }

  /** FR-CAT-08: a title is shared by every branch, so a correction shows everywhere. */
  async updateTitle(
    ctx: AuthContext,
    id: number,
    changes: Partial<TitleFields>,
  ): Promise<TitleDetail> {
    const before = await this.titleRow(this.db, id);
    if (changes.categoryCode && changes.categoryCode !== before.categoryCode) {
      await this.assertActiveCategory(this.db, changes.categoryCode);
    }
    return this.uow.run(ctx.actor, async (tx, log) => {
      const [after] = await tx.update(title).set(changes).where(eq(title.id, id)).returning();
      await log({
        action: 'title.update',
        entity: 'title',
        entityId: id,
        branchId: null,
        before: pick(before, Object.keys(changes)),
        after: pick(after!, Object.keys(changes)),
      });
      return this.detail(ctx, id, tx);
    });
  }

  async addCopies(
    ctx: AuthContext,
    titleId: number,
    body: AddCopiesRequest & CopyFields,
  ): Promise<{ title: TitleDetail; accessionNumbers: string[] }> {
    assertBranchAccess(ctx.user, body.branchId);
    const t = await this.titleRow(this.db, titleId);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const accessionNumbers = await this.insertCopies(tx, log, titleId, t.categoryCode, body);
      return { title: await this.detail(ctx, titleId, tx), accessionNumbers };
    });
  }

  async updateCopy(
    ctx: AuthContext,
    copyId: number,
    changes: {
      condition?: Copy['condition'];
      source?: string | null;
      priceCents?: number | null;
      legacyNo?: string | null;
    },
  ): Promise<TitleDetail> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const before = await this.lockCopy(tx, copyId);
      assertBranchAccess(ctx.user, before.branchId);
      const [after] = await tx.update(copy).set(changes).where(eq(copy.id, copyId)).returning();
      await log({
        action: 'copy.update',
        entity: 'copy',
        entityId: copyId,
        branchId: before.branchId,
        before: pick(before, Object.keys(changes)),
        after: pick(after!, Object.keys(changes)),
      });
      return this.detail(ctx, before.titleId, tx);
    });
  }

  /** FR-CAT-11: nobody deletes a copy; it is withdrawn with a reason and its history stays. */
  async withdraw(ctx: AuthContext, copyId: number, reason: string): Promise<TitleDetail> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const c = await this.lockCopy(tx, copyId);
      assertBranchAccess(ctx.user, c.branchId);
      if (c.withdrawnAt)
        throw AppError.conflict('already_withdrawn', 'This copy is already withdrawn.');
      await this.assertNotOnLoan(tx, copyId);
      await tx
        .update(copy)
        .set({ withdrawnAt: new Date(), withdrawnReason: reason })
        .where(eq(copy.id, copyId));
      await log({
        action: 'copy.withdraw',
        entity: 'copy',
        entityId: copyId,
        branchId: c.branchId,
        after: { accessionNo: c.accessionNo, reason },
      });
      return this.detail(ctx, c.titleId, tx);
    });
  }

  /** Only a super admin brings a withdrawn copy back (FR-CAT-11). */
  async reinstate(ctx: AuthContext, copyId: number): Promise<TitleDetail> {
    return this.uow.run(ctx.actor, async (tx, log) => {
      const c = await this.lockCopy(tx, copyId);
      if (!c.withdrawnAt) throw AppError.conflict('not_withdrawn', 'This copy is not withdrawn.');
      await tx
        .update(copy)
        .set({ withdrawnAt: null, withdrawnReason: null })
        .where(eq(copy.id, copyId));
      await log({
        action: 'copy.reinstate',
        entity: 'copy',
        entityId: copyId,
        branchId: c.branchId,
        before: { withdrawnReason: c.withdrawnReason },
      });
      return this.detail(ctx, c.titleId, tx);
    });
  }

  /**
   * FR-CAT-08, FR-CAT-14: only a super admin moves a copy to another branch for
   * good. Its accession number, printed on the book, stays as it is.
   */
  async move(ctx: AuthContext, copyId: number, toBranchId: number): Promise<TitleDetail> {
    const [target] = await this.db
      .select({ id: branch.id })
      .from(branch)
      .where(eq(branch.id, toBranchId));
    if (!target) throw AppError.badRequest('branch_not_found', 'No such branch.');
    return this.uow.run(ctx.actor, async (tx, log) => {
      const c = await this.lockCopy(tx, copyId);
      if (c.branchId === toBranchId)
        throw AppError.badRequest('same_branch', 'The copy is already at that branch.');
      if (c.withdrawnAt)
        throw AppError.conflict('already_withdrawn', 'A withdrawn copy cannot be moved.');
      await this.assertNotOnLoan(tx, copyId);
      await tx.update(copy).set({ branchId: toBranchId }).where(eq(copy.id, copyId));
      await log({
        action: 'copy.move',
        entity: 'copy',
        entityId: copyId,
        branchId: toBranchId,
        before: { branchId: c.branchId },
        after: { branchId: toBranchId, accessionNo: c.accessionNo },
      });
      return this.detail(ctx, c.titleId, tx);
    });
  }

  /**
   * FR-CAT-18: two titles found to be the same book become one. The copies move
   * under the title that stays; the other is kept, marked as merged, and no
   * longer shown. Accession numbers are untouched.
   */
  async merge(ctx: AuthContext, fromId: number, intoId: number): Promise<TitleDetail> {
    if (fromId === intoId)
      throw AppError.badRequest('merge_into_self', 'A title cannot be merged into itself.');
    return this.uow.run(ctx.actor, async (tx, log) => {
      const from = await this.titleRow(tx, fromId);
      const into = await this.titleRow(tx, intoId);
      if (from.mergedIntoId || into.mergedIntoId) {
        throw AppError.conflict('title_merged', 'One of these titles has already been merged.');
      }
      const moved = await tx
        .update(copy)
        .set({ titleId: intoId })
        .where(eq(copy.titleId, fromId))
        .returning({ id: copy.id, accessionNo: copy.accessionNo });
      await tx.update(title).set({ mergedIntoId: intoId }).where(eq(title.id, fromId));
      await log({
        action: 'title.merge',
        entity: 'title',
        entityId: fromId,
        branchId: null,
        before: { title: from.title, writer: from.writer },
        after: { mergedIntoId: intoId, copiesMoved: moved.map((m) => m.accessionNo) },
      });
      return this.detail(ctx, intoId, tx);
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async insertCopies(
    tx: Tx,
    log: Log,
    titleId: number,
    categoryCode: string,
    c: CopyFields,
  ): Promise<string[]> {
    const numbers = await allocateAccessionNumbers(tx, c.branchId, categoryCode, c.count);
    const rows = await tx
      .insert(copy)
      .values(
        numbers.map((accessionNo) => ({
          accessionNo,
          titleId,
          branchId: c.branchId,
          accessionedBranchId: c.branchId,
          source: c.source,
          priceCents: c.priceCents ?? null,
        })),
      )
      .returning();
    await log({
      action: 'copy.create',
      entity: 'copy',
      entityId: rows.length === 1 ? rows[0]!.id : null,
      branchId: c.branchId,
      after: {
        titleId,
        accessionNumbers: numbers,
        source: c.source,
        priceCents: c.priceCents ?? null,
      },
    });
    return numbers;
  }

  /** `KS` / `KS-A1` / `KS-A1-012` as an accession prefix, if the branch code exists. */
  private async accessionPrefix(q: string): Promise<string | null> {
    const m = ACCESSION_QUERY.exec(q.toUpperCase().replace(/\s/g, ''));
    if (!m) return null;
    const [, branchCode, categoryCode, digits] = m;
    const [known] = await this.db
      .select({ id: branch.id })
      .from(branch)
      .where(eq(branch.branchCode, branchCode!));
    if (!known) return null;
    if (!categoryCode) return `${branchCode}-`;
    if (!digits) return `${branchCode}-${categoryCode}-`;
    // Typed digits match from the left of the five printed ones: `KS-A1-012` finds 01200–01299.
    return `${branchCode}-${categoryCode}-${digits}`;
  }

  private async summaries(q: Queryable, where: SQL, tail: SQL): Promise<TitleSummary[]> {
    const result = await q.execute<{
      id: number;
      title: string;
      writer: string | null;
      publisher: string | null;
      isbn: string | null;
      edition: string | null;
      category_code: string;
      category_name: string;
      holdings: { branchId: number; total: number; onShelf: number }[];
    }>(sql`
      SELECT t.id, t.title, t.writer, t.publisher, t.isbn, t.edition,
             t.category_code, cat.name AS category_name,
             COALESCE((
               SELECT json_agg(json_build_object('branchId', h.branch_id, 'total', h.total, 'onShelf', h.on_shelf)
                               ORDER BY h.branch_id)
               FROM (
                 SELECT c.branch_id, count(*)::int AS total,
                        count(*) FILTER (WHERE a.state = 'on_shelf')::int AS on_shelf
                 FROM copy c JOIN copy_availability a ON a.copy_id = c.id
                 WHERE c.title_id = t.id AND c.withdrawn_at IS NULL
                 GROUP BY c.branch_id
               ) h
             ), '[]'::json) AS holdings
      FROM title t JOIN category cat ON cat.code = t.category_code
      WHERE ${where}
      ${tail}`);
    return result.rows.map((r) => ({
      id: r.id,
      title: r.title,
      writer: r.writer,
      publisher: r.publisher,
      isbn: r.isbn,
      edition: r.edition,
      categoryCode: r.category_code,
      categoryName: r.category_name,
      holdings: r.holdings,
    }));
  }

  private async copiesOf(q: Queryable, titleId: number): Promise<Copy[]> {
    const result = await q.execute<{
      id: number;
      accession_no: string;
      branch_id: number;
      accessioned_branch_id: number;
      condition: Copy['condition'];
      state: CopyState;
      withdrawn_at: Date | string | null;
      withdrawn_reason: string | null;
      price_cents: string | number | null;
      source: string | null;
      legacy_no: string | null;
    }>(sql`
      SELECT c.id, c.accession_no, c.branch_id, c.accessioned_branch_id, c.condition, a.state,
             c.withdrawn_at, c.withdrawn_reason, c.price_cents, c.source, c.legacy_no
      FROM copy c JOIN copy_availability a ON a.copy_id = c.id
      WHERE c.title_id = ${titleId}
      ORDER BY c.branch_id, c.accession_no`);
    return result.rows.map((r) => ({
      id: r.id,
      accessionNo: r.accession_no,
      branchId: r.branch_id,
      accessionedBranchId: r.accessioned_branch_id,
      condition: r.condition,
      state: r.state,
      withdrawnAt: r.withdrawn_at ? new Date(r.withdrawn_at).toISOString() : null,
      withdrawnReason: r.withdrawn_reason,
      priceCents: r.price_cents === null ? null : Number(r.price_cents),
      source: r.source,
      legacyNo: r.legacy_no,
    }));
  }

  private async titleRow(q: Queryable, id: number) {
    const [row] = await q.select().from(title).where(eq(title.id, id));
    if (!row) throw titleNotFound();
    return row;
  }

  /** Locks the copy row for the rest of the transaction (issuing locks it too, in M6). */
  private async lockCopy(tx: Tx, id: number) {
    const [row] = await tx.select().from(copy).where(eq(copy.id, id)).for('update');
    if (!row) throw copyNotFound();
    return row;
  }

  private async assertNotOnLoan(tx: Tx, copyId: number): Promise<void> {
    const result = await tx.execute<{ state: string }>(
      sql`SELECT state FROM copy_availability WHERE copy_id = ${copyId}`,
    );
    if (result.rows[0]?.state === 'on_loan') {
      throw AppError.conflict('copy_on_loan', 'This copy is on loan; take it back first.');
    }
  }

  /** FR-BRN-07: no new title joins a retired category. */
  private async assertActiveCategory(q: Queryable, code: string): Promise<void> {
    const [row] = await q
      .select({ isActive: category.isActive })
      .from(category)
      .where(eq(category.code, code));
    if (!row) throw AppError.badRequest('category_not_found', 'No such category.');
    if (!row.isActive)
      throw AppError.conflict('category_retired', 'This category is retired; choose another.');
  }
}

function titleValues(body: TitleFields) {
  return {
    title: body.title,
    writer: body.writer,
    publisher: body.publisher,
    isbn: body.isbn,
    edition: body.edition,
    categoryCode: body.categoryCode,
  };
}

function pick<T extends object>(obj: T, keys: string[]): Partial<T> {
  return Object.fromEntries(
    keys.filter((k) => k in obj).map((k) => [k, obj[k as keyof T]]),
  ) as Partial<T>;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
