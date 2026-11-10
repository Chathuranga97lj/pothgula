import {
  addDays,
  BACKDATE_MAX_DAYS,
  type IssueRefusal,
  type Loan,
  type LoanStanding,
  type MembershipState,
  type MemberSummary,
  todayColombo,
} from '@pothgula/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { errorMessage } from '../api/errors';
import { useMemberSearch } from '../api/members';
import { StateBadge } from '../pages/MembersPage';
import { ExtensionNote, OwnExtension } from './extensions';
import { Alert, Field, Input } from './ui';

/**
 * FR-NOT-11: what staff must see first on a member's record — a suspension, any
 * overdue book, a pending application, the frequently-late mark or any late
 * return in the period. It blocks nothing by itself; the borrowing rules are
 * enforced when issuing.
 */
export function StandingBanner({
  standing,
  state,
}: {
  standing: LoanStanding;
  state?: MembershipState;
}) {
  const { t } = useTranslation();
  const notes = [
    state === 'suspended' && (
      <Alert key="suspended" tone="error" title={t('standing.suspended')}>
        {t('standing.suspendedBody')}
      </Alert>
    ),
    standing.overdueLoans > 0 && (
      <Alert
        key="overdue"
        tone="error"
        title={t('loans.overdueTitle', { count: standing.overdueLoans })}
      >
        {t('loans.overdueBody')}
      </Alert>
    ),
    state === 'pending' && (
      <Alert key="pending" tone="info" title={t('standing.pending')}>
        {t('standing.pendingBody')}
      </Alert>
    ),
    standing.frequentlyLate ? (
      <Alert key="late" tone="warning" title={t('loans.frequentlyLate')}>
        {t('loans.frequentlyLateBody', {
          count: standing.lateReturns,
          months: standing.lateReturnMonths,
        })}
      </Alert>
    ) : (
      standing.lateReturns > 0 && (
        <Alert key="late" tone="info">
          {t('standing.lateReturns', {
            count: standing.lateReturns,
            months: standing.lateReturnMonths,
          })}
        </Alert>
      )
    ),
  ].filter(Boolean);
  if (notes.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="standing">
      {notes}
    </div>
  );
}

export function LoanStatusBadge({ loan }: { loan: Loan }) {
  const { t } = useTranslation();
  const [key, tone] =
    loan.status === 'void'
      ? ['void', 'bg-stone-200 text-stone-700 line-through']
      : loan.status === 'lost'
        ? ['lost', 'bg-red-50 text-red-900']
        : loan.overdue
          ? ['overdue', 'bg-red-50 text-red-900']
          : loan.status === 'open'
            ? ['open', 'bg-sky-50 text-sky-950']
            : ['returned', 'bg-emerald-50 text-emerald-900'];
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tone}`}>
      {t(`loans.status.${key}`)}
    </span>
  );
}

/** FR-CIR-02: every reason the copy cannot be issued, in the counter's language. */
export function RefusalList({ refusals }: { refusals: IssueRefusal[] }) {
  const { t } = useTranslation();
  return (
    <Alert tone="error" title={t('counter.cannotIssue')}>
      <ul className="list-disc space-y-1 pl-5">
        {refusals.map((r) => (
          <li key={r.code}>{t(`errors.${r.code}`, r.params ?? {})}</li>
        ))}
      </ul>
    </Alert>
  );
}

/** Finding a member by name or phone, then choosing one. */
export function MemberPicker({
  label,
  onPick,
}: {
  label: string;
  onPick: (member: MemberSummary) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const results = useMemberSearch(q);
  return (
    <div className="space-y-3">
      <Field label={label}>
        {({ id }) => (
          <Input
            id={id}
            type="search"
            placeholder={t('members.searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
        )}
      </Field>
      {results.isError && <Alert tone="error">{errorMessage(t, results.error)}</Alert>}
      {q.trim().length >= 2 && results.data && (
        <ul className="divide-y divide-stone-100 rounded-md border border-stone-200">
          {results.data.length === 0 && (
            <li className="px-3 py-2 text-sm text-stone-600">{t('members.noMatch')}</li>
          )}
          {results.data.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(m);
                  setQ('');
                }}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-stone-50"
              >
                <span className="font-medium">{m.fullName}</span>
                <span className="text-stone-600 tabular-nums">{m.whatsappPhone}</span>
                <StateBadge state={m.state} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * FR-CIR-14: entering a transaction written on paper during an outage, with
 * its real date, up to seven days back. `null` means today.
 */
export function PaperDate({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
}) {
  const { t } = useTranslation();
  const today = todayColombo();
  return (
    <div className="space-y-2">
      <label className="flex gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={value !== null}
          onChange={(e) => onChange(e.target.checked ? addDays(today, -1) : null)}
        />
        <span>{t('counter.paper', { days: BACKDATE_MAX_DAYS })}</span>
      </label>
      {value !== null && (
        <Field label={t('counter.paperDate')}>
          {({ id }) => (
            <Input
              id={id}
              type="date"
              className="max-w-48"
              min={addDays(today, -BACKDATE_MAX_DAYS)}
              max={addDays(today, -1)}
              value={value}
              onChange={(e) => onChange(e.target.value || null)}
            />
          )}
        </Field>
      )}
    </div>
  );
}

/** FR-CIR-09: a borrowing history, most recent first. */
export function LoanTable({ loans, staff }: { loans: Loan[]; staff: boolean }) {
  const { t } = useTranslation();
  if (loans.length === 0) return <p className="p-5 text-stone-600">{t('loans.none')}</p>;
  if (!staff) return <OwnLoanList loans={loans} />;
  return (
    <div className="overflow-x-auto">
      <table className="mt-3 w-full min-w-[640px] text-left text-sm">
        <thead className="border-y border-stone-200 bg-stone-50 text-xs text-stone-600 uppercase">
          <tr>
            <th className="px-4 py-2 font-medium">{t('loans.book')}</th>
            <th className="px-4 py-2 font-medium">{t('loans.borrowed')}</th>
            <th className="px-4 py-2 font-medium">{t('loans.due')}</th>
            <th className="px-4 py-2 font-medium">{t('loans.returned')}</th>
            <th className="px-4 py-2 font-medium">{t('loans.statusLabel')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {loans.map((l) => (
            <tr key={l.id} className={l.status === 'void' ? 'text-stone-500' : undefined}>
              <td className="px-4 py-2">
                {staff ? (
                  <Link to={`/loans/${l.id}`} className="font-medium text-emerald-800 underline">
                    {l.title}
                  </Link>
                ) : (
                  <span className="font-medium">{l.title}</span>
                )}
                <span className="block font-mono text-xs text-stone-600">{l.accessionNo}</span>
              </td>
              <td className="px-4 py-2 tabular-nums">
                {l.borrowDate}
                {l.isBackdated && <PaperMark />}
              </td>
              <td className="px-4 py-2 tabular-nums">
                {l.dueDate}
                <ExtensionNote loan={l} />
              </td>
              <td className="px-4 py-2 tabular-nums">
                {l.returnedOn ?? '—'}
                {l.returnBackdated && <PaperMark />}
              </td>
              <td className="px-4 py-2">
                <LoanStatusBadge loan={l} />
                {l.daysLate > 0 && (
                  <span className="mt-1 block text-xs font-medium text-red-800">
                    {t('loans.daysLate', { count: l.daysLate })}
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

/**
 * The member's own books, one block each, so that everything — the extension
 * button included — fits a phone without scrolling sideways (FR-CIR-04, FR-CIR-10).
 */
function OwnLoanList({ loans }: { loans: Loan[] }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-200">
      {loans.map((l) => (
        <li
          key={l.id}
          className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-3 text-sm"
        >
          <div className="min-w-0">
            <p className="font-medium">{l.title}</p>
            <p className="font-mono text-xs text-stone-600">{l.accessionNo}</p>
            <p className="mt-1 text-stone-700 tabular-nums">
              {t('loans.borrowed')} {l.borrowDate} · {t('loans.due')}{' '}
              {l.returnedOn ? l.dueDate : <strong>{l.dueDate}</strong>}
              {l.returnedOn && ` · ${t('loans.returned')} ${l.returnedOn}`}
            </p>
            <ExtensionNote loan={l} />
          </div>
          <div className="text-right">
            <LoanStatusBadge loan={l} />
            {l.daysLate > 0 && (
              <span className="mt-1 block text-xs font-medium text-red-800">
                {t('loans.daysLate', { count: l.daysLate })}
              </span>
            )}
            <OwnExtension loan={l} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PaperMark() {
  const { t } = useTranslation();
  return (
    <span
      className="ml-1 rounded bg-stone-100 px-1 text-xs text-stone-700"
      title={t('loans.paperHint')}
    >
      {t('loans.paper')}
    </span>
  );
}
