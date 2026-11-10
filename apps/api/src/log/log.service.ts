import { Inject, Injectable } from '@nestjs/common';
import {
  type ExportFormat,
  describeChange,
  LIBRARY_TIME_ZONE,
  type LogEntryView,
  type LogFilter,
  type LogPage,
  type LogRole,
  todayColombo,
} from '@pothgula/shared';
import { and, desc, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { UnitOfWork } from '../audit/unit-of-work';
import type { AuthContext } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { assertBranchAccess } from '../common/scope';
import type { Db, Tx } from '../db/client';
import { DB } from '../db/db.module';
import { activityLog, appUser, branch } from '../db/schema';
import { type ExportFile, type ExportTable, renderTable } from '../exports/table-export';
import { PdfService } from '../pdf/pdf.service';

/**
 * Records that belong to the whole library rather than one branch. Their entries
 * made by a super admin carry no branch, and an admin may still read them: a
 * title's history is not another branch's business (FR-LOG-06, FR-LOG-09).
 */
const LIBRARY_WIDE_ENTITIES = ['title', 'category', 'library'];

/** The most entries one file may carry; past this the filter must be narrowed. */
export const EXPORT_LIMITS: Record<ExportFormat, number> = { txt: 50_000, csv: 50_000, pdf: 5_000 };

type Queryable = Db | Tx;

/**
 * §14, reading side. An admin reads their own branch's entries, a super admin any
 * branch's (FR-LOG-06); newest first, filtered (FR-LOG-07). Each new search, each
 * export and each history tab opened is itself written to the log, in the same
 * transaction as the read (FR-LOG-10, FR-LOG-12). Fetching a later page of a
 * search already logged adds nothing.
 */
@Injectable()
export class LogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly pdf: PdfService,
  ) {}

  async page(
    ctx: AuthContext,
    filter: LogFilter,
    opts: { before?: number; limit: number },
  ): Promise<LogPage> {
    const where = this.where(ctx, filter);
    const read = async (q: Queryable) => {
      const rows = await this.select(
        q,
        opts.before ? (and(where, lt(activityLog.id, opts.before)) ?? where) : where,
      ).limit(opts.limit + 1);
      const entries = rows.slice(0, opts.limit).map(toView);
      return {
        entries,
        nextBefore: rows.length > opts.limit ? entries[entries.length - 1]!.id : null,
      };
    };
    const logged = { filter: compact(filter) };
    if (opts.before !== undefined && (await this.alreadyLogged(ctx, logged))) {
      return read(this.db);
    }
    return this.uow.run(ctx.actor, async (tx, log) => {
      const result = await read(tx);
      await log({
        action: 'log.read',
        entity: 'activity_log',
        branchId: filter.branchId ?? ctx.user.branchId,
        after: logged,
      });
      return result;
    });
  }

  /**
   * A later page is free only if this person's read of the same search is
   * already in the log; a made-up cursor on a search never logged is a new read.
   */
  private async alreadyLogged(ctx: AuthContext, logged: object): Promise<boolean> {
    const [hit] = await this.db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.actorId, ctx.user.id),
          sql`${activityLog.at} > now() - interval '12 hours'`,
          eq(activityLog.action, 'log.read'),
          sql`${activityLog.afterData} = ${JSON.stringify(logged)}::jsonb`,
        ),
      )
      .limit(1);
    return hit !== undefined;
  }

  /** FR-LOG-08: the same view as a file, with the filter printed on it. */
  async export(ctx: AuthContext, filter: LogFilter, format: ExportFormat): Promise<ExportFile> {
    const where = this.where(ctx, filter);
    const limit = EXPORT_LIMITS[format];
    const { rows, branchName } = await this.uow.run(ctx.actor, async (tx, log) => {
      const [counted] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(activityLog)
        .where(where);
      const count = counted?.count ?? 0;
      if (count > limit) {
        throw AppError.unprocessable(
          'export_too_large',
          `${count} entries match; one ${format} file can carry ${limit}. Narrow the filter.`,
          { count, limit },
        );
      }
      const rows = (await this.select(tx, where)).map(toView);
      await log({
        action: 'log.export',
        entity: 'activity_log',
        branchId: filter.branchId ?? ctx.user.branchId,
        after: { filter: compact(filter), format, entries: rows.length },
      });
      const scopeBranch = filter.branchId ?? ctx.user.branchId;
      const [br] =
        scopeBranch === null
          ? []
          : await tx.select().from(branch).where(eq(branch.id, scopeBranch));
      return { rows, branchName: br ? `${br.branchCode} — ${br.branchName}` : null };
    });

    const producedAt = todayColombo();
    return renderTable(this.pdf, asTable(rows, filter, branchName), format, {
      branding: await this.pdf.branding(filter.branchId ?? ctx.user.branchId),
      producedBy: ctx.user.fullName,
      producedAt,
      filename: `activity-log-${producedAt}`,
    });
  }

  private where(ctx: AuthContext, filter: LogFilter): SQL {
    if (filter.branchId !== undefined) assertBranchAccess(ctx.user, filter.branchId);
    const parts: (SQL | undefined)[] = [];
    if (ctx.user.userType !== 'super_admin') {
      parts.push(
        or(
          eq(activityLog.branchId, ctx.user.branchId!),
          and(isNull(activityLog.branchId), inArray(activityLog.entity, LIBRARY_WIDE_ENTITIES)),
        ),
      );
    }
    if (filter.branchId !== undefined) parts.push(eq(activityLog.branchId, filter.branchId));
    if (filter.from) parts.push(sql`${activityLog.at} >= ${startOfDay(filter.from)}`);
    if (filter.to) {
      parts.push(sql`${activityLog.at} < ${startOfDay(filter.to)} + interval '1 day'`);
    }
    if (filter.actorId !== undefined) parts.push(eq(activityLog.actorId, filter.actorId));
    if (filter.role) parts.push(eq(activityLog.actorRole, filter.role));
    if (filter.action) {
      parts.push(
        filter.action.includes('.')
          ? eq(activityLog.action, filter.action)
          : or(
              eq(activityLog.action, filter.action),
              sql`${activityLog.action} LIKE ${`${filter.action}.%`}`,
            ),
      );
    }
    if (filter.entity) parts.push(eq(activityLog.entity, filter.entity));
    if (filter.entityId) parts.push(eq(activityLog.entityId, filter.entityId));
    return and(...parts) ?? sql`true`;
  }

  private select(q: Queryable, where: SQL) {
    return q
      .select({
        id: activityLog.id,
        at: activityLog.at,
        actorId: activityLog.actorId,
        actorName: appUser.fullName,
        actorRole: activityLog.actorRole,
        branchId: activityLog.branchId,
        branchCode: branch.branchCode,
        action: activityLog.action,
        entity: activityLog.entity,
        entityId: activityLog.entityId,
        before: activityLog.beforeData,
        after: activityLog.afterData,
        ipAddress: activityLog.ipAddress,
        redactedAt: activityLog.redactedAt,
      })
      .from(activityLog)
      .leftJoin(appUser, eq(appUser.id, activityLog.actorId))
      .leftJoin(branch, eq(branch.id, activityLog.branchId))
      .where(where)
      .orderBy(desc(activityLog.id))
      .$dynamic();
  }
}

/** Midnight at the library on that date, as a timestamp the database compares. */
function startOfDay(isoDate: string): SQL {
  return sql`(${isoDate}::date)::timestamp AT TIME ZONE ${LIBRARY_TIME_ZONE}`;
}

function toView(row: {
  id: number;
  at: Date;
  actorId: number | null;
  actorName: string | null;
  actorRole: string;
  branchId: number | null;
  branchCode: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  redactedAt: Date | null;
}): LogEntryView {
  return {
    ...row,
    at: row.at.toISOString(),
    actorRole: row.actorRole as LogRole,
    redactedAt: row.redactedAt?.toISOString() ?? null,
  };
}

/** The filter as written to the log entry for the read: only the parts set. */
function compact(filter: LogFilter): Partial<LogFilter> {
  return Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined));
}

const FILTER_LABELS: Record<keyof LogFilter, string> = {
  from: 'From',
  to: 'To',
  actorId: 'Person (account id)',
  role: 'Role',
  branchId: 'Branch (id)',
  action: 'Action',
  entity: 'Record kind',
  entityId: 'Record id',
};

/** "2026-11-10 14:05" at the library. */
export function colomboDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LIBRARY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function asTable(rows: LogEntryView[], filter: LogFilter, branchName: string | null): ExportTable {
  const set = Object.entries(compact(filter)).map(
    ([k, v]) => `${FILTER_LABELS[k as keyof LogFilter]}: ${String(v)}`,
  );
  return {
    title: 'Activity log',
    about: [
      `Branch: ${branchName ?? 'every branch'}`,
      `Filter: ${set.length > 0 ? set.join(' · ') : 'none (everything)'}`,
      `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}, newest first. Times are Sri Lanka time.`,
    ],
    textLayout: 'records',
    landscape: true,
    pdfFontSize: 7,
    columns: [
      { header: 'No.', width: 34, numeric: true },
      { header: 'When', width: 62 },
      { header: 'Who', width: 90 },
      { header: 'Role', width: 46 },
      { header: 'Branch', width: 30 },
      { header: 'Action', width: 90 },
      { header: 'Record', width: 70 },
      { header: 'Change', width: '*', skip: ['csv'] },
      { header: 'Before', skip: ['txt', 'pdf'] },
      { header: 'After', skip: ['txt', 'pdf'] },
      { header: 'Network address', width: 60 },
    ],
    rows: rows.map((e) => [
      e.id,
      colomboDateTime(e.at),
      e.actorRole === 'system' ? 'System' : `${e.actorName ?? '—'} (#${e.actorId})`,
      e.actorRole,
      e.branchCode,
      e.action,
      e.entityId === null ? e.entity : `${e.entity} #${e.entityId}`,
      [
        ...describeChange(e.before, e.after),
        ...(e.redactedAt ? [`(personal values removed ${e.redactedAt.slice(0, 10)})`] : []),
      ].join('\n'),
      e.before === null || e.before === undefined ? null : JSON.stringify(e.before),
      e.after === null || e.after === undefined ? null : JSON.stringify(e.after),
      e.ipAddress,
    ]),
  };
}
