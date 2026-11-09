import {
  type AlertTone,
  type DueLoan,
  formatRupees,
  type MemberPanelItem,
  type StaffAlert,
  type StaffDashboard,
} from '@pothgula/shared';
import { useMutation } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { downloadSheet, type Sheet, useMemberDashboard, useStaffDashboard } from '../api/dashboard';
import { errorMessage } from '../api/errors';
import { Alert, Button, Card } from './ui';

const TONE: Record<AlertTone, 'error' | 'warning' | 'info'> = {
  urgent: 'error',
  warning: 'warning',
  info: 'info',
};
const EDGE: Record<AlertTone, string> = {
  urgent: 'border-l-red-600',
  warning: 'border-l-amber-500',
  info: 'border-l-sky-500',
};

/** "Needs attention (3)": every panel opens with a heading and a count (FR-NOT-07). */
function PanelHeading({ children, count }: { children: ReactNode; count: number }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
      {children}{' '}
      <span
        className={`rounded-full px-2 py-0.5 text-sm tabular-nums ${
          count > 0 ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'
        }`}
      >
        {count}
      </span>
    </h2>
  );
}

/** FR-RPT-16, FR-NOT-04: a sheet for one branch, as a PDF to print. */
export function SheetButton({
  sheet,
  branchId,
  variant = 'secondary',
}: {
  sheet: Sheet;
  branchId: number;
  variant?: 'secondary' | 'ghost';
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const download = useMutation({
    mutationFn: () => downloadSheet(sheet, branchId),
    onMutate: () => setError(null),
    onError: (err) => setError(errorMessage(t, err)),
  });
  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant={variant} disabled={download.isPending} onClick={() => download.mutate()}>
        {t(`sheets.${sheet}`)}
      </Button>
      {error && <span className="text-sm text-red-800">{error}</span>}
    </span>
  );
}

// ─── Staff: today's work (FR-NOT-03, FR-NOT-07, FR-NOT-09) ───────────────────

function itemTarget(kind: StaffAlert, branchId: number, many: boolean): string {
  const branch = many ? `?branch=${branchId}` : '';
  switch (kind) {
    case 'overdue':
    case 'due_today':
    case 'due_soon':
    case 'returned_late_today':
      return `/due${branch}`;
    case 'expiring_this_month':
      return '/members?tab=lists';
    case 'applications_waiting':
      return '/members';
    case 'suspended':
      return '/members?tab=search';
  }
}

type BranchToday = StaffDashboard['branches'][number];

export function StaffToday({ superAdmin }: { superAdmin: boolean }) {
  const { t } = useTranslation();
  const dash = useStaffDashboard(true);
  if (dash.isError) return <Alert tone="error">{errorMessage(t, dash.error)}</Alert>;
  if (!dash.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  const { branches } = dash.data;
  const many = branches.length > 1;
  // FR-NOT-09: a super admin sees suspended members at the very top.
  const suspended = superAdmin ? branches.filter((b) => b.counts.suspended > 0) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Link
          to="/counter"
          className="inline-flex min-h-10 items-center rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900"
        >
          {t('today.counter')}
        </Link>
        <Link
          to="/due"
          className="inline-flex min-h-10 items-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50"
        >
          {t('today.dueLists')}
        </Link>
      </div>

      {suspended.length > 0 && (
        <Alert tone="error" title={t('today.suspendedTop')}>
          <ul className="space-y-1">
            {suspended.map((b) => (
              <li key={b.branchId}>
                <Link to="/members?tab=search" className="underline">
                  {b.branchCode} — {t('today.items.suspended', { count: b.counts.suspended })}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {branches.length === 0 && <p className="text-stone-600">{t('today.noBranches')}</p>}
      <div className={many ? 'grid gap-6 lg:grid-cols-2' : 'max-w-2xl'}>
        {branches.map((b) => (
          <BranchPanel key={b.branchId} branch={b} many={many} hideSuspended={superAdmin} />
        ))}
      </div>
    </div>
  );
}

function BranchPanel({
  branch: b,
  many,
  hideSuspended,
}: {
  branch: BranchToday;
  many: boolean;
  hideSuspended: boolean;
}) {
  const { t } = useTranslation();
  const items = b.items.filter((i) => !(hideSuspended && i.kind === 'suspended'));
  return (
    <Card>
      {many && (
        <p className="mb-1 text-sm font-medium text-stone-600">
          {b.branchCode} — {b.branchName}
        </p>
      )}
      <PanelHeading count={items.length}>{t('today.needsAttention')}</PanelHeading>
      {items.length === 0 ? (
        <p className="text-stone-700">{t('today.quiet')}</p>
      ) : (
        <ul className="space-y-2" data-testid={`panel-${b.branchCode}`}>
          {items.map((i) => (
            <li key={i.kind}>
              <Link
                to={itemTarget(i.kind, b.branchId, many)}
                className={`block rounded-md border border-l-4 border-stone-200 px-3 py-2 hover:bg-stone-50 ${EDGE[i.tone]}`}
              >
                {t(`today.items.${i.kind}`, { count: i.count, days: b.warningDays })}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-stone-100 pt-4">
        <SheetButton sheet="daily-loans" branchId={b.branchId} />
        {b.counts.overdueMembers > 0 && (
          <Link
            to={`/due/calls${many ? `?branch=${b.branchId}` : ''}`}
            className="inline-flex min-h-10 items-center px-2 text-sm font-medium text-emerald-900 underline"
          >
            {t('today.callList', { count: b.counts.overdueMembers })}
          </Link>
        )}
      </div>
    </Card>
  );
}

// ─── Members: the panel (FR-NOT-01, FR-NOT-02, FR-NOT-07, FR-NOT-08) ─────────

export function MemberPanel() {
  const { t } = useTranslation();
  const dash = useMemberDashboard(true);
  if (dash.isError) return <Alert tone="error">{errorMessage(t, dash.error)}</Alert>;
  if (!dash.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  const { items } = dash.data;
  return (
    <section className="max-w-2xl">
      <PanelHeading count={items.length}>{t('panel.title')}</PanelHeading>
      {items.length === 0 ? (
        <Card>
          <p className="text-stone-700">{t('panel.quiet')}</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((item, n) => (
            <li key={n}>
              <MemberItem item={item} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm">
        <Link to="/my-membership" className="font-medium text-emerald-900 underline">
          {t('panel.myMembership')}
        </Link>
      </p>
    </section>
  );
}

function MemberItem({ item }: { item: MemberPanelItem }) {
  const { t } = useTranslation();
  const tone = TONE[item.tone];
  switch (item.kind) {
    case 'suspended':
      return (
        <Alert tone={tone} title={t('panel.suspended.title')}>
          {t('panel.suspended.body')}
        </Alert>
      );
    case 'loan_overdue':
      return (
        <Alert
          tone={tone}
          title={t('panel.overdue.title', { title: item.title, count: item.daysLate })}
        >
          {t('panel.overdue.body', { date: item.dueDate, accession: item.accessionNo })}
        </Alert>
      );
    case 'membership_expired':
      return (
        <Alert tone={tone} title={t('panel.expired.title')}>
          {t('panel.expired.body', { date: item.expireAt })}
        </Alert>
      );
    case 'loan_due_soon':
      return (
        <Alert
          tone={tone}
          title={
            item.daysLeft === 0
              ? t('panel.dueSoon.today', { title: item.title })
              : t('panel.dueSoon.title', { title: item.title, count: item.daysLeft })
          }
        >
          {t('panel.dueSoon.body', { date: item.dueDate, accession: item.accessionNo })}
        </Alert>
      );
    case 'membership_expiring':
      return (
        <Alert
          tone={tone}
          title={
            item.daysLeft === 0
              ? t('panel.expiring.today')
              : t('panel.expiring.title', { count: item.daysLeft })
          }
        >
          {t('panel.expiring.body', { date: item.expireAt })}
        </Alert>
      );
    case 'late_returns':
      return (
        <Alert
          tone={tone}
          title={t('panel.lateReturns.title', { count: item.count, months: item.months })}
        >
          {t('panel.lateReturns.body')}
        </Alert>
      );
    case 'application_waiting':
      return (
        <Alert tone={tone} title={t('panel.application.title')}>
          {item.feeCents > 0
            ? t('panel.application.bodyFee', {
                branch: item.branchName,
                fee: formatRupees(item.feeCents),
              })
            : t('panel.application.body', { branch: item.branchName })}{' '}
          <Link to="/my-membership" className="font-medium underline">
            {t('panel.application.link')}
          </Link>
        </Alert>
      );
  }
}

// ─── The lists (FR-NOT-12) ───────────────────────────────────────────────────

type SortKey = 'due' | 'member' | 'title' | 'accession';

const compare: Record<SortKey, (a: DueLoan, b: DueLoan) => number> = {
  due: (a, b) => a.dueDate.localeCompare(b.dueDate) || a.memberName.localeCompare(b.memberName),
  member: (a, b) => a.memberName.localeCompare(b.memberName) || a.dueDate.localeCompare(b.dueDate),
  title: (a, b) => a.title.localeCompare(b.title) || a.dueDate.localeCompare(b.dueDate),
  accession: (a, b) => a.accessionNo.localeCompare(b.accessionNo),
};

/** A list of loans staff can sort by clicking a column heading. */
export function DueTable({ loans, today }: { loans: DueLoan[]; today: string }) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'due', desc: false });
  const rows = loans.toSorted((a, b) => (sort.desc ? -1 : 1) * compare[sort.key](a, b));

  const heading = (key: SortKey, label: string) => (
    <th
      scope="col"
      className="px-3 py-2 font-medium"
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))}
      >
        {label}
        <span aria-hidden="true" className="text-xs text-stone-500">
          {sort.key === key ? (sort.desc ? '▼' : '▲') : '↕'}
        </span>
      </button>
    </th>
  );

  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="border-b border-stone-200 text-stone-600">
          <tr>
            {heading('due', t('due.columns.due'))}
            {heading('member', t('due.columns.member'))}
            <th scope="col" className="px-3 py-2 font-medium">
              {t('due.columns.phones')}
            </th>
            {heading('title', t('due.columns.book'))}
            {heading('accession', t('due.columns.accession'))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((l) => (
            <tr key={l.id} className="align-top">
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                {l.dueDate === today ? (
                  <span className="font-semibold">{t('due.today')}</span>
                ) : (
                  l.dueDate
                )}
                {l.overdue && (
                  <span className="block font-medium text-red-800">
                    {t('loans.daysLate', { count: l.daysLate })}
                  </span>
                )}
                {l.extended && (
                  <span className="block text-xs text-stone-600">{t('due.extended')}</span>
                )}
              </td>
              <td className="px-3 py-2">
                <Link to={`/members/${l.memberId}`} className="font-medium underline">
                  {l.memberName}
                </Link>
                <span className="block text-xs text-stone-600">
                  {t('due.homeBranch', { code: l.memberBranchCode })}
                </span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                <Phones whatsapp={l.memberPhone} other={l.memberOtherPhone} />
              </td>
              <td className="px-3 py-2">
                <Link to={`/loans/${l.id}`} className="underline">
                  {l.title}
                </Link>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="font-mono text-xs">{l.accessionNo}</span>
                {l.copyBranchCode !== l.memberBranchCode && (
                  <span className="block text-xs text-stone-600">
                    {t('due.copyBranch', { code: l.copyBranchCode })}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Phone numbers as links, for calling or messaging by hand (FR-NOT-04). */
export function Phones({ whatsapp, other }: { whatsapp: string | null; other: string | null }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-col">
      {whatsapp && (
        <a href={`tel:${whatsapp}`} className="underline">
          {whatsapp}
        </a>
      )}
      {other && (
        <a href={`tel:${other}`} className="text-stone-700 underline">
          {other} <span className="text-xs">({t('due.otherPhone')})</span>
        </a>
      )}
    </span>
  );
}
