import { type BranchDue, callList } from '@pothgula/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useDueLists } from '../api/dashboard';
import { errorMessage } from '../api/errors';
import { useBranches } from '../api/queries';
import { useMe } from '../auth/auth';
import { DueTable, Phones, SheetButton } from '../components/dashboard';
import { Alert, Card, Field, PageTitle, Select } from '../components/ui';

/** A super admin chooses a branch, or sees them all grouped by branch. */
function useBranchChoice() {
  const [params, setParams] = useSearchParams();
  const branchId = Number(params.get('branch')) || null;
  const choose = (id: number | null) => setParams(id === null ? {} : { branch: String(id) });
  return { branchId, choose };
}

function BranchPicker({
  branchId,
  choose,
}: {
  branchId: number | null;
  choose: (id: number | null) => void;
}) {
  const { t } = useTranslation();
  const { user } = useMe();
  const branches = useBranches(user.userType === 'super_admin');
  if (user.userType !== 'super_admin') return null;
  return (
    <div className="mb-5 max-w-xs">
      <Field label={t('due.branch')}>
        {({ id }) => (
          <Select
            id={id}
            value={branchId ?? ''}
            onChange={(e) => choose(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{t('due.allBranches')}</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Card>
      <h3 className="mb-3 font-semibold">
        {title} <span className="text-stone-600 tabular-nums">({count})</span>
      </h3>
      {children}
    </Card>
  );
}

/** FR-NOT-12: overdue books held above the five-day list, then today's late returns. */
export function DuePage() {
  const { t } = useTranslation();
  const { branchId, choose } = useBranchChoice();
  const due = useDueLists(branchId);

  return (
    <>
      <PageTitle lead={t('due.lead')}>{t('due.title')}</PageTitle>
      <BranchPicker branchId={branchId} choose={choose} />
      {due.isError && <Alert tone="error">{errorMessage(t, due.error)}</Alert>}
      {due.data && (
        <div className="space-y-10">
          {due.data.branches.map((b) => (
            <BranchLists
              key={b.branchId}
              branch={b}
              today={due.data.today}
              many={due.data.branches.length > 1}
            />
          ))}
        </div>
      )}
    </>
  );
}

function BranchLists({
  branch: b,
  today,
  many,
}: {
  branch: BranchDue;
  today: string;
  many: boolean;
}) {
  const { t } = useTranslation();
  const people = new Set(b.overdue.map((l) => l.memberId)).size;
  return (
    <section className="space-y-5" aria-label={`${b.branchCode} — ${b.branchName}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {many ? (
          <h2 className="text-lg font-semibold">
            {b.branchCode} — {b.branchName}
          </h2>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-start gap-3">
          {people > 0 && (
            <Link
              to={`/due/calls?branch=${b.branchId}`}
              className="inline-flex min-h-10 items-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50"
            >
              {t('today.callList', { count: people })}
            </Link>
          )}
          <SheetButton sheet="daily-loans" branchId={b.branchId} />
        </div>
      </div>

      <Section title={t('due.overdue')} count={b.overdue.length}>
        {b.overdue.length === 0 ? (
          <p className="text-stone-600">{t('due.noneOverdue')}</p>
        ) : (
          <DueTable loans={b.overdue} today={today} />
        )}
      </Section>

      <Section title={t('due.soon', { count: b.warningDays })} count={b.dueSoon.length}>
        {b.dueSoon.length === 0 ? (
          <p className="text-stone-600">{t('due.noneSoon', { count: b.warningDays })}</p>
        ) : (
          <DueTable loans={b.dueSoon} today={today} />
        )}
      </Section>

      {b.returnedLateToday.length > 0 && (
        <Section title={t('due.lateToday')} count={b.returnedLateToday.length}>
          <ul className="space-y-1 text-sm">
            {b.returnedLateToday.map((l) => (
              <li key={l.id}>
                <Link to={`/loans/${l.id}`} className="underline">
                  {l.title}
                </Link>{' '}
                · <span className="font-mono text-xs">{l.accessionNo}</span> · {l.memberName} ·{' '}
                <span className="font-medium text-red-800">
                  {t('loans.daysLate', { count: l.daysLate })}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </section>
  );
}

/** FR-NOT-04: who to telephone about overdue books, longest overdue first. */
export function CallListPage() {
  const { t } = useTranslation();
  const { branchId, choose } = useBranchChoice();
  const due = useDueLists(branchId);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link
          to={branchId ? `/due?branch=${branchId}` : '/due'}
          className="text-emerald-800 underline"
        >
          ← {t('due.title')}
        </Link>
      </p>
      <PageTitle lead={t('calls.lead')}>{t('calls.title')}</PageTitle>
      <BranchPicker branchId={branchId} choose={choose} />
      {due.isError && <Alert tone="error">{errorMessage(t, due.error)}</Alert>}
      {due.data && (
        <div className="space-y-10">
          {due.data.branches.map((b) => {
            const entries = callList(b.overdue);
            return (
              <section key={b.branchId} className="space-y-4" aria-label={b.branchName}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">
                    {b.branchCode} — {b.branchName}{' '}
                    <span className="text-stone-600 tabular-nums">({entries.length})</span>
                  </h2>
                  {entries.length > 0 && <SheetButton sheet="call-list" branchId={b.branchId} />}
                </div>
                {entries.length === 0 ? (
                  <p className="text-stone-600">{t('calls.none')}</p>
                ) : (
                  <ul className="grid gap-4 md:grid-cols-2">
                    {entries.map((e) => (
                      <li key={e.memberId}>
                        <Card>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <Link to={`/members/${e.memberId}`} className="font-semibold underline">
                              {e.fullName}
                            </Link>
                            <span className="rounded bg-red-50 px-2 py-0.5 text-sm font-medium text-red-900">
                              {t('loans.daysLate', { count: e.maxDaysLate })}
                            </span>
                          </div>
                          <div className="mt-2 text-sm tabular-nums">
                            <Phones whatsapp={e.whatsappPhone} other={e.otherPhone} />
                          </div>
                          <ul className="mt-3 space-y-1 text-sm text-stone-800">
                            {e.loans.map((l) => (
                              <li key={l.id}>
                                {l.title} ·{' '}
                                <span className="font-mono text-xs">{l.accessionNo}</span> ·{' '}
                                {t('calls.dueOn', { date: l.dueDate })}
                              </li>
                            ))}
                          </ul>
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
