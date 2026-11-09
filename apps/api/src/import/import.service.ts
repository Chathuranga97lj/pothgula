import { Inject, Injectable } from '@nestjs/common';
import {
  type ImportCandidate,
  type ImportDecision,
  type ImportGroup,
  type ImportPreview,
  type ImportResult,
  type ImportRowError,
} from '@pothgula/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { type Log, UnitOfWork } from '../audit/unit-of-work';
import { allocateAccessionNumbers } from '../catalogue/accession';
import { AppError } from '../common/app-error';
import { assertBranchAccess } from '../common/scope';
import type { Db, Tx } from '../db/client';
import { DB } from '../db/db.module';
import { branch, category, copy, title } from '../db/schema';
import { groupRows, type ImportRow, readImportFile, type RowGroup } from './rows';

/** "Near-identical" (FR-CAT-13): trigram similarity of the names, and of the writers. */
const TITLE_SIMILARITY = 0.6;
const WRITER_SIMILARITY = 0.5;
const MAX_CANDIDATES = 5;

interface Analysis {
  preview: ImportPreview;
  groups: RowGroup[];
}

/**
 * FR-CAT-13: the one-off import of books already on the shelves. The preview
 * writes nothing; the commit re-reads the same file, checks it again, insists
 * that every probable duplicate was looked at, and then numbers every copy in
 * one transaction with its log entries (FR-LOG-13).
 */
@Injectable()
export class ImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  async preview(
    ctx: AuthContext,
    branchId: number,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<ImportPreview> {
    await this.assertBranch(ctx, branchId);
    // A transaction only for the scratch table it drops at the end; no data changes.
    return this.db.transaction(async (tx) => {
      const { preview } = await this.analyse(tx, branchId, fileName, bytes);
      return preview;
    });
  }

  async commit(
    ctx: AuthContext,
    branchId: number,
    fileName: string,
    bytes: Uint8Array,
    decisions: ImportDecision[],
  ): Promise<ImportResult> {
    await this.assertBranch(ctx, branchId);
    return this.uow.run(ctx.actor, async (tx, log) => {
      const { preview, groups } = await this.analyse(tx, branchId, fileName, bytes);
      if (preview.fileErrors.length > 0 || preview.errors.length > 0) {
        throw AppError.unprocessable(
          'import_has_errors',
          'Correct the rows listed in the preview, then try again.',
          { fileErrors: preview.fileErrors, errors: preview.errors.length },
        );
      }
      const targets = resolveDecisions(preview.groups, decisions);
      return this.write(tx, log, branchId, fileName, groups, preview.groups, targets);
    });
  }

  // ─── Reading and checking ──────────────────────────────────────────────────

  private async analyse(
    tx: Tx,
    branchId: number,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<Analysis> {
    const categories = new Map(
      (await tx.select({ code: category.code, isActive: category.isActive }).from(category)).map(
        (c) => [c.code, c.isActive],
      ),
    );
    const read = readImportFile(bytes, categories);
    const base = {
      branchId,
      fileName,
      rows: read.rows.length + new Set(read.errors.map((e) => e.line)).size,
      ignoredColumns: read.ignoredColumns,
      fileErrors: read.fileErrors,
      missingColumns: read.missingColumns,
    };
    if (read.fileErrors.length > 0) {
      return { preview: { ...base, errors: [], groups: [] }, groups: [] };
    }

    // Old numbers already given to a copy at this branch: most likely the same file twice.
    const errors: ImportRowError[] = [...read.errors];
    const oldNumbers = read.rows.flatMap((r) => (r.oldNumber ? [r.oldNumber.toUpperCase()] : []));
    const taken = new Set<string>();
    for (let i = 0; i < oldNumbers.length; i += 5000) {
      const rows = await tx
        .select({ legacyNo: copy.legacyNo })
        .from(copy)
        .where(
          and(
            eq(copy.accessionedBranchId, branchId),
            inArray(sql`upper(${copy.legacyNo})`, oldNumbers.slice(i, i + 5000)),
          ),
        );
      for (const r of rows) taken.add(r.legacyNo!.toUpperCase());
    }
    const fresh: ImportRow[] = [];
    for (const row of read.rows) {
      if (row.oldNumber && taken.has(row.oldNumber.toUpperCase())) {
        errors.push({ line: row.line, code: 'old_number_exists', value: row.oldNumber });
      } else {
        fresh.push(row);
      }
    }

    const grouped = groupRows(fresh);
    errors.push(...grouped.errors);
    errors.sort((a, b) => a.line - b.line);
    const groups = grouped.groups;
    const { candidates, similar } = await this.duplicates(tx, groups);

    return {
      groups,
      preview: {
        ...base,
        errors,
        groups: groups.map((g, i): ImportGroup => ({
          key: g.key,
          title: g.first.title,
          writer: g.first.writer,
          publisher: g.first.publisher,
          isbn: g.first.isbn,
          edition: g.first.edition,
          categoryCode: g.first.categoryCode,
          lines: g.rows.map((r) => r.line),
          oldNumbers: g.rows.flatMap((r) => (r.oldNumber ? [r.oldNumber] : [])),
          candidates: candidates.get(i) ?? [],
          similarKeys: (similar.get(i) ?? []).map((j) => groups[j]!.key),
        })),
      },
    };
  }

  /**
   * Probable duplicates: titles already in the catalogue with the same ISBN or a
   * near-identical name and writer, and groups in the file that look alike. The
   * groups go into a scratch table with a trigram index, so this stays quick for
   * a whole library's worth of rows.
   */
  private async duplicates(tx: Tx, groups: RowGroup[]) {
    const candidates = new Map<number, ImportCandidate[]>();
    const similar = new Map<number, number[]>();
    if (groups.length === 0) return { candidates, similar };

    await tx.execute(
      sql`SET LOCAL pg_trgm.similarity_threshold = ${sql.raw(String(TITLE_SIMILARITY))}`,
    );
    await tx.execute(sql`
      CREATE TEMP TABLE import_group (idx int, title text, writer text, isbn text) ON COMMIT DROP`);
    const json = JSON.stringify(
      groups.map((g, idx) => ({
        idx,
        title: g.first.title,
        writer: g.first.writer,
        isbn: g.first.isbn,
      })),
    );
    await tx.execute(sql`
      INSERT INTO import_group
      SELECT * FROM jsonb_to_recordset(${json}::jsonb) AS g(idx int, title text, writer text, isbn text)`);
    await tx.execute(sql`CREATE INDEX ON import_group USING gin (title gin_trgm_ops)`);
    await tx.execute(sql`ANALYZE import_group`);

    const writerOk = (a: string, b: string) =>
      sql.raw(
        `(${a}.writer IS NULL OR ${b}.writer IS NULL OR similarity(${a}.writer, ${b}.writer) >= ${WRITER_SIMILARITY})`,
      );
    const found = await tx.execute<{
      idx: number;
      id: number;
      title: string;
      writer: string | null;
      isbn: string | null;
      category_code: string;
      copies: number;
      same_isbn: boolean;
    }>(sql`
      SELECT * FROM (
        SELECT g.idx, t.id, t.title, t.writer, t.isbn, t.category_code,
          (SELECT count(*)::int FROM copy c WHERE c.title_id = t.id) AS copies,
          (g.isbn IS NOT NULL AND t.isbn = g.isbn) AS same_isbn,
          row_number() OVER (
            PARTITION BY g.idx
            ORDER BY (g.isbn IS NOT NULL AND t.isbn = g.isbn) DESC, similarity(t.title, g.title) DESC
          ) AS n
        FROM import_group g
        JOIN title t ON t.merged_into_id IS NULL AND (
          (g.isbn IS NOT NULL AND t.isbn = g.isbn)
          OR (t.title % g.title AND ${writerOk('t', 'g')})
        )
      ) ranked
      WHERE n <= ${MAX_CANDIDATES}
      ORDER BY idx, n`);
    for (const r of found.rows) {
      const list = candidates.get(r.idx) ?? [];
      list.push({
        titleId: r.id,
        title: r.title,
        writer: r.writer,
        isbn: r.isbn,
        categoryCode: r.category_code,
        copies: r.copies,
        reason: r.same_isbn ? 'same_isbn' : 'similar_title',
      });
      candidates.set(r.idx, list);
    }

    const pairs = await tx.execute<{ a: number; b: number }>(sql`
      SELECT a.idx AS a, b.idx AS b
      FROM import_group a JOIN import_group b ON a.idx < b.idx AND a.title % b.title
      WHERE ${writerOk('a', 'b')}
      ORDER BY a.idx, b.idx`);
    for (const { a, b } of pairs.rows) {
      similar.set(a, [...(similar.get(a) ?? []), b]);
      similar.set(b, [...(similar.get(b) ?? []), a]);
    }
    return { candidates, similar };
  }

  // ─── Writing ───────────────────────────────────────────────────────────────

  private async write(
    tx: Tx,
    log: Log,
    branchId: number,
    fileName: string,
    groups: RowGroup[],
    shown: ImportGroup[],
    targets: Map<string, Target>,
  ): Promise<ImportResult> {
    // New titles first, one for each group that is neither added to an existing
    // title nor folded into another group.
    const titleOf = new Map<string, { id: number; title: string; categoryCode: string }>();
    const fresh = groups.filter((g) => {
      const target = targets.get(g.key)!;
      return target.kind === 'new' && target.rootKey === g.key;
    });
    for (let i = 0; i < fresh.length; i += 1000) {
      const chunk = fresh.slice(i, i + 1000);
      const inserted = await tx
        .insert(title)
        .values(
          chunk.map((g) => ({
            title: g.first.title,
            writer: g.first.writer,
            publisher: g.first.publisher,
            isbn: g.first.isbn,
            edition: g.first.edition,
            categoryCode: g.first.categoryCode,
          })),
        )
        .returning();
      // Identities are given in the order of the VALUES list.
      const rows = inserted.toSorted((x, y) => x.id - y.id);
      rows.forEach((row, n) =>
        titleOf.set(chunk[n]!.key, {
          id: row.id,
          title: row.title,
          categoryCode: row.categoryCode,
        }),
      );
      await log(
        rows.map((row) => ({
          action: 'title.create',
          entity: 'title',
          entityId: row.id,
          branchId: null,
          after: { ...row, source: 'import' },
        })),
      );
    }
    const titlesCreated = fresh.length;

    const existingIds = [
      ...new Set([...targets.values()].flatMap((t) => (t.kind === 'existing' ? [t.titleId] : []))),
    ];
    const existing = new Map(
      (existingIds.length === 0
        ? []
        : await tx.select().from(title).where(inArray(title.id, existingIds))
      ).map((t) => [t.id, t]),
    );
    for (const id of existingIds) {
      const t = existing.get(id);
      if (!t || t.mergedIntoId !== null) {
        throw AppError.conflict(
          'title_merged',
          'A title chosen in the review has since been merged.',
        );
      }
    }

    // Every copy, in file order, with the title it joins.
    const placed = groups
      .flatMap((g) => {
        const target = targets.get(g.key)!;
        const t =
          target.kind === 'existing' ? existing.get(target.titleId)! : titleOf.get(target.rootKey)!;
        return g.rows.map((row) => ({
          row,
          titleId: t.id,
          title: t.title,
          categoryCode: t.categoryCode,
        }));
      })
      .sort((a, b) => a.row.line - b.row.line);

    // Numbers are handed out per category, in the order of the file.
    const numbers = new Map<string, string[]>();
    for (const code of new Set(placed.map((p) => p.categoryCode))) {
      const count = placed.filter((p) => p.categoryCode === code).length;
      numbers.set(code, await allocateAccessionNumbers(tx, branchId, code, count));
    }
    const next = new Map<string, number>();
    const copies = placed.map((p) => {
      const n = next.get(p.categoryCode) ?? 0;
      next.set(p.categoryCode, n + 1);
      return { ...p, accessionNo: numbers.get(p.categoryCode)![n]! };
    });

    for (let i = 0; i < copies.length; i += 1000) {
      await tx.insert(copy).values(
        copies.slice(i, i + 1000).map((c) => ({
          accessionNo: c.accessionNo,
          titleId: c.titleId,
          branchId,
          accessionedBranchId: branchId,
          source: c.row.source,
          priceCents: c.row.priceCents,
          legacyNo: c.row.oldNumber,
        })),
      );
    }

    const perTitle = new Map<number, typeof copies>();
    for (const c of copies) perTitle.set(c.titleId, [...(perTitle.get(c.titleId) ?? []), c]);
    await log(
      [...perTitle].map(([titleId, list]) => ({
        action: 'copy.create',
        entity: 'copy',
        entityId: null,
        branchId,
        after: {
          titleId,
          source: 'import',
          copies: list.map((c) => ({ accessionNo: c.accessionNo, legacyNo: c.row.oldNumber })),
        },
      })),
    );

    const result: ImportResult = {
      titlesCreated,
      titlesAddedTo: existingIds.length,
      copies: copies.map((c) => ({
        line: c.row.line,
        oldNumber: c.row.oldNumber,
        accessionNo: c.accessionNo,
        titleId: c.titleId,
        title: c.title,
      })),
    };
    await log({
      action: 'import.commit',
      entity: 'import',
      entityId: null,
      branchId,
      after: {
        fileName,
        rows: copies.length,
        groups: shown.length,
        titlesCreated,
        titlesAddedTo: existingIds.length,
        merged: [...targets.entries()].filter(([k, t]) => t.kind === 'new' && t.rootKey !== k)
          .length,
      },
    });
    return result;
  }

  private async assertBranch(ctx: AuthContext, branchId: number): Promise<void> {
    assertBranchAccess(ctx.user, branchId);
    const [b] = await this.db.select({ id: branch.id }).from(branch).where(eq(branch.id, branchId));
    if (!b) throw AppError.notFound('branch_not_found', 'No such branch.');
  }
}

type Target = { kind: 'new'; rootKey: string } | { kind: 'existing'; titleId: number };

/**
 * Turns the review into where each group's copies go. Every group with a
 * probable duplicate must have been decided (FR-CAT-13: reviewed before the
 * import is committed); the rest become new titles.
 */
export function resolveDecisions(
  groups: ImportGroup[],
  decisions: ImportDecision[],
): Map<string, Target> {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const chosen = new Map<string, ImportDecision>();
  for (const d of decisions) {
    const g = byKey.get(d.key);
    const bad =
      !g ||
      chosen.has(d.key) ||
      (d.action === 'existing' && !g.candidates.some((c) => c.titleId === d.titleId)) ||
      (d.action === 'merge' && !g.similarKeys.includes(d.intoKey));
    if (bad) {
      throw AppError.unprocessable('bad_decision', 'A review decision does not match the file.', {
        key: d.key,
      });
    }
    chosen.set(d.key, d);
  }

  const unreviewed = groups
    .filter((g) => (g.candidates.length > 0 || g.similarKeys.length > 0) && !chosen.has(g.key))
    .map((g) => g.key);
  if (unreviewed.length > 0) {
    throw AppError.unprocessable(
      'duplicates_unreviewed',
      'Decide each probable duplicate before importing.',
      { keys: unreviewed },
    );
  }

  const targets = new Map<string, Target>();
  const resolve = (key: string, seen: Set<string>): Target => {
    const known = targets.get(key);
    if (known) return known;
    if (seen.has(key)) {
      throw AppError.unprocessable('bad_decision', 'These groups are merged into each other.', {
        key,
      });
    }
    seen.add(key);
    const d = chosen.get(key);
    const target: Target =
      d?.action === 'existing'
        ? { kind: 'existing', titleId: d.titleId }
        : d?.action === 'merge'
          ? resolve(d.intoKey, seen)
          : { kind: 'new', rootKey: key };
    targets.set(key, target);
    return target;
  };
  for (const g of groups) resolve(g.key, new Set());
  return targets;
}
