import { Inject, Injectable } from '@nestjs/common';
import {
  AGE_BANDS,
  type BranchRef,
  defaultReportPeriod,
  endOfMonth,
  formatRupees,
  LATE_LIMIT,
  monthsBetween,
  PERIOD_REPORTS,
  POPULAR_LIMIT,
  type Report,
  type ReportCell,
  type ReportColumn,
  type ReportKind,
  type ReportQuery,
  type ReportRow,
  todayColombo,
} from '@pothgula/shared';
import { asc, eq, type SQL, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { assertBranchAccess } from '../common/scope';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { branch } from '../db/schema';

/** Who the report is about: one branch, or the whole library with each branch beside it. */
interface Scope {
  branch: BranchRef | null;
  /** Every branch the report covers, by code. */
  branches: BranchRef[];
  today: string;
  from: string | null;
  to: string | null;
}

type Body = Pick<Report, 'title' | 'about' | 'columns' | 'rows' | 'total'>;

const col = (key: string, label: string, numeric = false): ReportColumn => ({
  key,
  label,
  numeric,
});
const row = (cells: ReportCell[], extra: { key?: string; link?: string } = {}): ReportRow => ({
  cells,
  key: extra.key ?? null,
  link: extra.link ?? null,
});
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * §15, the reports that Phase 1's data supports. Each is read live from the
 * tables (R2: nothing here is stored), for one branch or — for a super admin —
 * the whole library with each branch beside the total (FR-RPT-10). Reports are
 * ordinary reads and are not logged (FR-LOG-12).
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async report(ctx: AuthContext, kind: ReportKind, q: ReportQuery): Promise<Report> {
    const scope = await this.scope(ctx, kind, q);
    const body = await this.build(kind, scope, q);
    return {
      kind,
      ...body,
      about: [
        `Branch: ${scope.branch ? `${scope.branch.branchCode} — ${scope.branch.branchName}` : 'the whole library'}`,
        ...(scope.from ? [`Period: ${scope.from} to ${scope.to}`] : [`As at ${scope.today}`]),
        ...body.about,
      ],
      branch: scope.branch,
      from: scope.from,
      to: scope.to,
      today: scope.today,
    };
  }

  private build(kind: ReportKind, s: Scope, q: ReportQuery): Promise<Body> {
    switch (kind) {
      case 'summary':
        return this.summary(s);
      case 'stock':
        return this.stock(s, q.by);
      case 'loans':
        return this.loans(s);
      case 'popular':
        return this.popular(s, q);
      case 'borrowing':
        return this.borrowing(s);
      case 'late':
        return this.late(s);
      case 'ages':
        return this.ages(s);
      case 'requests':
        return this.requests(s);
    }
  }

  private async scope(ctx: AuthContext, kind: ReportKind, q: ReportQuery): Promise<Scope> {
    const user = ctx.user;
    if (q.branchId !== undefined) assertBranchAccess(user, q.branchId);
    const only = q.branchId ?? (user.userType === 'super_admin' ? null : user.branchId);
    const branches = await this.db
      .select({
        branchId: branch.id,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
      })
      .from(branch)
      .where(only === null ? undefined : eq(branch.id, only))
      .orderBy(asc(branch.branchCode));
    if (only !== null && branches.length === 0) {
      throw AppError.notFound('branch_not_found', 'No such branch.');
    }
    const today = todayColombo();
    const period = PERIOD_REPORTS.includes(kind)
      ? { ...defaultReportPeriod(today), ...strip({ from: q.from, to: q.to }) }
      : { from: null, to: null };
    if (period.from && period.to && period.from > period.to) {
      throw AppError.badRequest('invalid_request', 'The start date is after the end date.');
    }
    return { branch: only === null ? null : branches[0]!, branches, today, ...period };
  }

  /** `col = <branch>` for one branch, or true for the whole library. */
  private inScope(s: Scope, column: SQL): SQL {
    return s.branch ? sql`${column} = ${s.branch.branchId}` : sql`true`;
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.db.execute(query)).rows as T[];
  }

  // ─── FR-RPT-06: at a glance ────────────────────────────────────────────────

  private async summary(s: Scope): Promise<Body> {
    const monthStart = `${s.today.slice(0, 7)}-01`;
    type Counts = { branch_id: number | null } & Record<string, number | string | null>;
    // GROUPING SETS: one row per branch, and one (branch_id null) for the whole library.
    const sets = (column: string) => sql.raw(`GROUPING SETS ((${column}), ())`);
    const [stock, loans, members, fees, top] = await Promise.all([
      this.rows<Counts>(sql`
        SELECT c.branch_id, count(DISTINCT c.title_id)::int AS titles, count(*)::int AS copies
        FROM copy c WHERE c.withdrawn_at IS NULL AND ${this.inScope(s, sql`c.branch_id`)}
        GROUP BY ${sets('c.branch_id')}`),
      this.rows<Counts>(sql`
        SELECT b.branch_id, count(*)::int AS on_loan,
          (count(*) FILTER (WHERE b.due_date < ${s.today}::date
            AND b.extension_status <> 'requested'))::int AS overdue
        FROM borrow b
        WHERE b.returned_on IS NULL AND b.voided_at IS NULL AND ${this.inScope(s, sql`b.branch_id`)}
        GROUP BY ${sets('b.branch_id')}`),
      this.rows<Counts>(sql`
        SELECT u.branch_id,
          (count(*) FILTER (WHERE u.status = 'active' AND u.expire_at >= ${s.today}::date))::int AS active,
          (count(*) FILTER (WHERE u.status = 'active' AND u.expire_at < ${s.today}::date))::int AS expired,
          (count(*) FILTER (WHERE u.status = 'suspended'))::int AS suspended,
          (count(*) FILTER (WHERE u.status = 'pending'))::int AS waiting
        FROM app_user u
        WHERE u.user_type = 'member' AND ${this.inScope(s, sql`u.branch_id`)}
        GROUP BY ${sets('u.branch_id')}`),
      // Fees and first fees, less any reversed this month; waivers bring in nothing.
      this.rows<Counts>(sql`
        SELECT u.branch_id, coalesce(sum(p.amount_cents), 0)::bigint AS fees
        FROM membership_payment p JOIN app_user u ON u.id = p.user_id
        WHERE p.kind IN ('fee', 'first_fee', 'reversal')
          AND p.paid_on BETWEEN ${monthStart}::date AND ${endOfMonth(s.today)}::date
          AND ${this.inScope(s, sql`u.branch_id`)}
        GROUP BY ${sets('u.branch_id')}`),
      this.rows<{ branch_id: number | null; title: string; n: number }>(sql`
        SELECT DISTINCT ON (branch_id) branch_id, title, n FROM (
          SELECT b.branch_id, t.title, count(*)::int AS n
          FROM borrow b JOIN copy c ON c.id = b.copy_id JOIN title t ON t.id = c.title_id
          WHERE b.voided_at IS NULL AND b.borrow_date >= ${monthStart}::date
            AND ${this.inScope(s, sql`b.branch_id`)}
          GROUP BY GROUPING SETS ((b.branch_id, t.id, t.title), (t.id, t.title))
        ) x ORDER BY branch_id, n DESC, title`),
    ]);

    // Without GROUPING SETS' total row the whole-library figures would double count titles.
    const keyed = <T extends { branch_id: number | null }>(list: T[]) =>
      new Map(list.map((r) => [r.branch_id, r]));
    const maps = [keyed(stock), keyed(loans), keyed(members), keyed(fees)];
    const topBy = keyed(top);
    const value = (id: number | null, field: string): ReportCell => {
      for (const m of maps) {
        const r = m.get(id);
        if (r && field in r) return Number(r[field]);
      }
      return 0;
    };
    // With one branch, its own row is the same as the total row.
    const ids: (number | null)[] = s.branch ? [null] : [...s.branches.map((b) => b.branchId), null];
    const measures: [string, string, (id: number | null) => ReportCell][] = [
      ['titles', 'Titles held', (id) => value(id, 'titles')],
      ['copies', 'Copies held', (id) => value(id, 'copies')],
      ['onLoan', 'On loan now', (id) => value(id, 'on_loan')],
      ['overdue', 'Overdue now', (id) => value(id, 'overdue')],
      ['activeMembers', 'Active members', (id) => value(id, 'active')],
      ['expiredMembers', 'Expired members', (id) => value(id, 'expired')],
      ['suspendedMembers', 'Suspended members', (id) => value(id, 'suspended')],
      ['waitingApplications', 'Waiting applications', (id) => value(id, 'waiting')],
      [
        'feesThisMonth',
        'Fees collected this month (Rs)',
        (id) => formatRupees(Number(value(id, 'fees'))),
      ],
      [
        'topThisMonth',
        'Most borrowed title this month',
        (id) => {
          const t = topBy.get(id);
          return t ? `${t.title} (${t.n})` : null;
        },
      ],
    ];
    return {
      title: 'Summary',
      about: ['Unsettled lost books are added with lost-book settlements (M12).'],
      columns: [
        col('measure', 'Measure'),
        ...(s.branch
          ? [col('value', 'Value', true)]
          : [
              ...s.branches.map((b) => col(`branch:${b.branchCode}`, b.branchCode, true)),
              col('total', 'Whole library', true),
            ]),
      ],
      rows: measures.map(([key, label, get]) => row([label, ...ids.map(get)], { key })),
      total: null,
    };
  }

  // ─── FR-RPT-01: stock ──────────────────────────────────────────────────────

  private async stock(s: Scope, by: 'category' | 'branch'): Promise<Body> {
    const byBranch = by === 'branch' && s.branch === null;
    const group = byBranch
      ? sql.raw('br.branch_code, br.branch_name')
      : sql.raw('cat.code, cat.name');
    const list = await this.rows<Record<string, string | number | null>>(sql`
      SELECT ${group},
        (count(DISTINCT c.title_id) FILTER (WHERE a.state <> 'withdrawn'))::int AS titles,
        count(*)::int AS copies,
        (count(*) FILTER (WHERE a.state = 'on_shelf'))::int AS on_shelf,
        (count(*) FILTER (WHERE a.state = 'on_loan'))::int AS on_loan,
        (count(*) FILTER (WHERE a.state = 'in_transit'))::int AS in_transit,
        (count(*) FILTER (WHERE a.state = 'held'))::int AS held,
        (count(*) FILTER (WHERE a.state = 'missing'))::int AS missing,
        (count(*) FILTER (WHERE a.state = 'not_useable'))::int AS not_useable,
        (count(*) FILTER (WHERE a.state = 'withdrawn'))::int AS withdrawn
      FROM copy c
      JOIN copy_availability a ON a.copy_id = c.id
      JOIN title t ON t.id = c.title_id
      JOIN category cat ON cat.code = t.category_code
      JOIN branch br ON br.id = c.branch_id
      WHERE ${this.inScope(s, sql`c.branch_id`)}
      GROUP BY GROUPING SETS ((${group}), ())
      ORDER BY 1 NULLS LAST`);
    const figures = [
      'titles',
      'copies',
      'on_shelf',
      'on_loan',
      'in_transit',
      'held',
      'missing',
      'not_useable',
      'withdrawn',
    ];
    const [first, second] = byBranch ? ['branch_code', 'branch_name'] : ['code', 'name'];
    const totalRow = list.find((r) => r[first!] === null);
    return {
      title: 'Stock',
      about: [
        byBranch ? 'Copies at each branch.' : 'Copies by category.',
        "Titles counts each title with at least one copy not withdrawn. A copy away for another branch's member counts at its owning branch, as in transit or held.",
      ],
      columns: [
        byBranch ? col('branch', 'Branch') : col('category', 'Category'),
        col('name', 'Name'),
        col('titles', 'Titles', true),
        col('copies', 'All copies', true),
        col('onShelf', 'On the shelf', true),
        col('onLoan', 'On loan', true),
        col('inTransit', 'In transit', true),
        col('held', 'Held', true),
        col('missing', 'Missing', true),
        col('notUseable', 'Not useable', true),
        col('withdrawn', 'Withdrawn', true),
      ],
      rows: list
        .filter((r) => r[first!] !== null)
        .map((r) => row([r[first!]!, r[second!]!, ...figures.map((f) => Number(r[f]))])),
      total: totalRow ? ['Total', null, ...figures.map((f) => Number(totalRow[f]))] : null,
    };
  }

  // ─── FR-RPT-02: books out and overdue ──────────────────────────────────────

  private async loans(s: Scope): Promise<Body> {
    const list = await this.rows<{
      id: number;
      accession_no: string;
      title: string;
      member: string;
      phone: string | null;
      branch_code: string;
      borrow_date: string;
      due_date: string;
      original_due_date: string;
      extension_status: string;
      days_late: number;
    }>(sql`
      SELECT b.id, c.accession_no, t.title, u.full_name AS member, u.whatsapp_phone AS phone,
        br.branch_code, b.borrow_date::text, b.due_date::text, b.original_due_date::text, b.extension_status,
        CASE WHEN b.extension_status = 'requested' THEN 0
          ELSE greatest(0, ${s.today}::date - b.due_date) END::int AS days_late
      FROM borrow b
      JOIN copy c ON c.id = b.copy_id
      JOIN title t ON t.id = c.title_id
      JOIN app_user u ON u.id = b.user_id
      JOIN branch br ON br.id = b.branch_id
      WHERE b.returned_on IS NULL AND b.voided_at IS NULL AND ${this.inScope(s, sql`b.branch_id`)}
      ORDER BY b.due_date, c.accession_no`);
    const overdue = list.filter((l) => l.days_late > 0).length;
    const many = s.branch === null;
    return {
      title: 'Books out',
      about: [
        `${plural(list.length, 'book', 'books')} out, ${overdue} overdue; the longest overdue first.`,
        'Personal data — keep it safe (Personal Data Protection Act No. 9 of 2022).',
      ],
      columns: [
        ...(many ? [col('branch', 'Branch')] : []),
        col('accessionNo', 'Book number'),
        col('title', 'Title'),
        col('member', 'Member'),
        col('phone', 'WhatsApp'),
        col('borrowed', 'Borrowed'),
        col('due', 'Due'),
        col('daysLate', 'Days late', true),
        col('extendedFrom', 'Extended from'),
      ],
      rows: list.map((l) =>
        row(
          [
            ...(many ? [l.branch_code] : []),
            l.accession_no,
            l.title,
            l.member,
            l.phone,
            l.borrow_date,
            l.due_date,
            l.days_late,
            l.extension_status === 'approved' ? l.original_due_date : null,
          ],
          { link: `/loans/${l.id}` },
        ),
      ),
      total: null,
    };
  }

  // ─── FR-RPT-05: most and least borrowed ────────────────────────────────────

  private async popular(s: Scope, q: ReportQuery): Promise<Body> {
    const most = q.order === 'most';
    const list = await this.rows<{
      id: number;
      title: string;
      writer: string | null;
      category_code: string;
      n: number;
      copies: number;
    }>(sql`
      WITH counts AS (
        SELECT c.title_id, count(*)::int AS n
        FROM borrow b JOIN copy c ON c.id = b.copy_id
        WHERE b.voided_at IS NULL AND b.borrow_date BETWEEN ${s.from}::date AND ${s.to}::date
          AND ${this.inScope(s, sql`b.branch_id`)}
        GROUP BY c.title_id
      ), held AS (
        SELECT c.title_id, count(*)::int AS copies
        FROM copy c WHERE c.withdrawn_at IS NULL AND ${this.inScope(s, sql`c.branch_id`)}
        GROUP BY c.title_id
      )
      SELECT t.id, t.title, t.writer, t.category_code,
        coalesce(counts.n, 0) AS n, coalesce(held.copies, 0) AS copies
      FROM title t
      LEFT JOIN counts ON counts.title_id = t.id
      LEFT JOIN held ON held.title_id = t.id
      WHERE t.merged_into_id IS NULL
        AND ${most ? sql`counts.n > 0` : sql`held.copies > 0`}
        AND ${q.category ? sql`t.category_code = ${q.category}` : sql`true`}
      ORDER BY n ${most ? sql.raw('DESC') : sql.raw('ASC')}, t.title
      LIMIT ${POPULAR_LIMIT}`);
    return {
      title: most ? 'Most borrowed titles' : 'Least borrowed titles',
      about: [
        `${most ? 'The most' : 'The least'} borrowed ${POPULAR_LIMIT} titles${q.category ? ` in category ${q.category}` : ''}, counting the loans of every copy together.`,
        ...(most ? [] : ['Only titles with copies on hand now; a title never taken out shows 0.']),
      ],
      columns: [
        col('rank', 'No.', true),
        col('title', 'Title'),
        col('writer', 'Writer'),
        col('category', 'Category'),
        col('timesBorrowed', 'Times taken out', true),
        col('copiesHeld', 'Copies held', true),
      ],
      rows: list.map((t, i) =>
        row([i + 1, t.title, t.writer, t.category_code, t.n, t.copies], {
          link: `/titles/${t.id}`,
        }),
      ),
      total: null,
    };
  }

  // ─── FR-RPT-08: borrowing by category and month ────────────────────────────

  private async borrowing(s: Scope): Promise<Body> {
    const list = await this.rows<{ month: string; category_code: string; n: number }>(sql`
      SELECT to_char(b.borrow_date, 'YYYY-MM') AS month, t.category_code, count(*)::int AS n
      FROM borrow b JOIN copy c ON c.id = b.copy_id JOIN title t ON t.id = c.title_id
      WHERE b.voided_at IS NULL AND b.borrow_date BETWEEN ${s.from}::date AND ${s.to}::date
        AND ${this.inScope(s, sql`b.branch_id`)}
      GROUP BY 1, 2`);
    const categories = [...new Set(list.map((r) => r.category_code))].sort();
    const months = monthsBetween(s.from!, s.to!);
    const count = (month: string | null, cat: string | null) =>
      list
        .filter(
          (r) => (month === null || r.month === month) && (cat === null || r.category_code === cat),
        )
        .reduce((sum, r) => sum + r.n, 0);
    return {
      title: 'Borrowing by category and month',
      about: ['Loans by the month they were made; voided loans are not counted.'],
      columns: [
        col('month', 'Month'),
        ...categories.map((c) => col(`category:${c}`, c, true)),
        col('total', 'Total', true),
      ],
      rows: months.map((m) => row([m, ...categories.map((c) => count(m, c)), count(m, null)])),
      total: ['Total', ...categories.map((c) => count(null, c)), count(null, null)],
    };
  }

  // ─── FR-RPT-15: late returns ───────────────────────────────────────────────

  private async late(s: Scope): Promise<Body> {
    const returnedLate = sql`
      b.voided_at IS NULL AND b.returned_on > b.due_date AND b.extension_status <> 'requested'
      AND b.returned_on BETWEEN ${s.from}::date AND ${s.to}::date
      AND ${this.inScope(s, sql`b.branch_id`)}`;
    const [people, branches] = await Promise.all([
      this.rows<{
        id: number;
        member: string;
        branch_code: string;
        n: number;
        avg: string;
        longest: number;
      }>(sql`
        SELECT u.id, u.full_name AS member, br.branch_code, count(*)::int AS n,
          round(avg(b.returned_on - b.due_date), 1)::text AS avg,
          max(b.returned_on - b.due_date)::int AS longest
        FROM borrow b JOIN app_user u ON u.id = b.user_id JOIN branch br ON br.id = u.branch_id
        WHERE ${returnedLate}
        GROUP BY u.id, u.full_name, br.branch_code
        ORDER BY n DESC, avg(b.returned_on - b.due_date) DESC, u.full_name
        LIMIT ${LATE_LIMIT}`),
      // One row per branch, and one (branch_code null) for every late return in scope.
      this.rows<{ branch_code: string | null; n: number; avg: string; longest: number }>(sql`
        SELECT br.branch_code, count(*)::int AS n,
          round(avg(b.returned_on - b.due_date), 1)::text AS avg,
          max(b.returned_on - b.due_date)::int AS longest
        FROM borrow b JOIN branch br ON br.id = b.branch_id
        WHERE ${returnedLate}
        GROUP BY GROUPING SETS ((br.branch_code), ()) ORDER BY br.branch_code NULLS LAST`),
    ]);
    const all = branches.find((b) => b.branch_code === null);
    const perBranch = branches.filter((b) => b.branch_code !== null);
    return {
      title: 'Late returns',
      about: [
        `Books brought back late in the period; the ${LATE_LIMIT} members with the most first.`,
        ...(perBranch.length === 0
          ? ['No late returns in the period.']
          : perBranch.map(
              (b) =>
                `${b.branch_code}: ${plural(b.n, 'late return', 'late returns')}, ${b.avg} days late on average.`,
            )),
      ],
      columns: [
        col('member', 'Member'),
        col('branch', 'Branch'),
        col('lateReturns', 'Late returns', true),
        col('averageDaysLate', 'Average days late', true),
        col('longest', 'Longest (days)', true),
      ],
      rows: people.map((p) =>
        row([p.member, p.branch_code, p.n, Number(p.avg), p.longest], { link: `/members/${p.id}` }),
      ),
      // Every late return in scope, not only the members listed.
      total: all ? ['All late returns', null, all.n, Number(all.avg), all.longest] : null,
    };
  }

  // ─── FR-RPT-14: books from other branches ──────────────────────────────────

  private async requests(s: Scope): Promise<Body> {
    const inPeriod = sql`(r.requested_at AT TIME ZONE 'Asia/Colombo')::date
      BETWEEN ${s.from}::date AND ${s.to}::date
      AND (${this.inScope(s, sql`r.from_branch_id`)} OR ${this.inScope(s, sql`r.to_branch_id`)})`;
    const [pairs, reasons] = await Promise.all([
      this.rows<{
        from_code: string | null;
        to_code: string | null;
        n: number;
        accepted: number;
        declined: number;
        cancelled: number;
        collected: number;
        lapsed: number;
        lost: number;
        days: string | null;
      }>(sql`
        SELECT f.branch_code AS from_code, t.branch_code AS to_code,
          count(*)::int AS n,
          (count(*) FILTER (WHERE r.copy_id IS NOT NULL))::int AS accepted,
          (count(*) FILTER (WHERE r.status = 'declined'))::int AS declined,
          (count(*) FILTER (WHERE r.status = 'cancelled'))::int AS cancelled,
          (count(*) FILTER (WHERE r.borrow_id IS NOT NULL))::int AS collected,
          (count(*) FILTER (WHERE r.lapsed_at IS NOT NULL))::int AS lapsed,
          (count(*) FILTER (WHERE r.status = 'lost_in_transit'))::int AS lost,
          round(avg(b.borrow_date - (r.requested_at AT TIME ZONE 'Asia/Colombo')::date), 1)::text AS days
        FROM book_request r
        JOIN branch f ON f.id = r.from_branch_id
        JOIN branch t ON t.id = r.to_branch_id
        LEFT JOIN borrow b ON b.id = r.borrow_id
        WHERE ${inPeriod}
        GROUP BY GROUPING SETS ((f.branch_code, t.branch_code), ())
        ORDER BY 1 NULLS LAST, 2`),
      this.rows<{ reason: string; n: number }>(sql`
        SELECT r.decline_reason AS reason, count(*)::int AS n
        FROM book_request r
        WHERE r.status = 'declined' AND ${inPeriod}
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`),
    ]);
    const figures = (p: (typeof pairs)[number]) => [
      p.n,
      p.accepted,
      p.declined,
      p.cancelled,
      p.collected,
      p.lapsed,
      p.lost,
      p.days === null ? null : Number(p.days),
    ];
    const all = pairs.find((p) => p.from_code === null);
    return {
      title: 'Books from other branches',
      about: [
        "Requests made in the period, by the branch asked and the member's branch.",
        'Days to collection runs from the request to the day the member took the book.',
        ...(reasons.length === 0
          ? []
          : ['Declined because:', ...reasons.map((r) => `  ${r.reason} (${r.n})`)]),
      ],
      columns: [
        col('fromBranch', 'Asked of'),
        col('toBranch', 'For members of'),
        col('requests', 'Requests', true),
        col('accepted', 'Accepted', true),
        col('declined', 'Declined', true),
        col('cancelled', 'Cancelled', true),
        col('collected', 'Collected', true),
        col('lapsed', 'Not collected', true),
        col('lostInTransit', 'Lost on the way', true),
        col('daysToCollect', 'Days to collection', true),
      ],
      rows: pairs
        .filter((p) => p.from_code !== null)
        .map((p) => row([p.from_code, p.to_code, ...figures(p)])),
      total: all ? ['Total', null, ...figures(all)] : null,
    };
  }

  // ─── FR-RPT-11: members by age ─────────────────────────────────────────────

  private async ages(s: Scope): Promise<Body> {
    const list = await this.rows<{ branch_id: number; age: number | null; n: number }>(sql`
      SELECT u.branch_id, date_part('year', age(${s.today}::date, u.date_of_birth))::int AS age,
        count(*)::int AS n
      FROM app_user u
      WHERE u.user_type = 'member' AND u.status = 'active' AND u.expire_at >= ${s.today}::date
        AND ${this.inScope(s, sql`u.branch_id`)}
      GROUP BY 1, 2`);
    const count = (band: { min: number; max: number } | null, branchId: number | null) =>
      list
        .filter(
          (r) =>
            (branchId === null || r.branch_id === branchId) &&
            (band === null
              ? r.age === null
              : r.age !== null && r.age >= band.min && r.age <= band.max),
        )
        .reduce((sum, r) => sum + r.n, 0);
    const ids: (number | null)[] = s.branch ? [null] : [...s.branches.map((b) => b.branchId), null];
    const all = list.reduce((sum, r) => sum + r.n, 0);
    const bands: [string, string, { min: number; max: number } | null][] = [
      ...AGE_BANDS.map((b): [string, string, { min: number; max: number }] => [b.key, b.label, b]),
      ['unknown', 'Not recorded', null],
    ];
    const share = (n: number) => (all === 0 ? '0%' : `${Math.round((n / all) * 100)}%`);
    return {
      title: 'Members by age',
      about: ['Active members, by their age today.'],
      columns: [
        col('ageBand', 'Age'),
        ...(s.branch
          ? []
          : s.branches.map((b) => col(`branch:${b.branchCode}`, b.branchCode, true))),
        col('members', s.branch ? 'Members' : 'Whole library', true),
        col('share', 'Share', true),
      ],
      rows: bands.map(([key, label, band]) => {
        const total = count(band, null);
        return row([label, ...ids.map((id) => count(band, id)), share(total)], { key });
      }),
      total: [
        'Total',
        ...ids.map((id) =>
          list.filter((r) => id === null || r.branch_id === id).reduce((n, r) => n + r.n, 0),
        ),
        share(all),
      ],
    };
  }
}

/** Drops undefined values, so they do not overwrite a default. */
function strip<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
