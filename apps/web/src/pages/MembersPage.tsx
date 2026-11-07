import type { MemberSummary } from '@pothgula/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { errorMessage } from '../api/errors';
import { useApplications, useMemberSearch, useMembershipOverview } from '../api/members';
import { useBranches } from '../api/queries';
import { Alert, Card, Input, PageTitle } from '../components/ui';

type Tab = 'waiting' | 'search' | 'lists' | 'rejected';

/** FR-AUT-18, FR-MEM-03: the waiting list, finding a member, and the membership lists. */
export function MembersPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('waiting');
  const waiting = useApplications('pending');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'waiting', label: t('members.tabs.waiting', { count: waiting.data?.length ?? 0 }) },
    { id: 'search', label: t('members.tabs.search') },
    { id: 'lists', label: t('members.tabs.lists') },
    { id: 'rejected', label: t('members.tabs.rejected') },
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle lead={t('members.lead')}>{t('members.title')}</PageTitle>
        <Link
          to="/members/new"
          className="inline-flex min-h-10 items-center rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900"
        >
          {t('members.register')}
        </Link>
      </div>

      <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-stone-200">
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            type="button"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === x.id
                ? 'border-emerald-800 text-emerald-900'
                : 'border-transparent text-stone-600'
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'waiting' && <WaitingList />}
      {tab === 'search' && <Search />}
      {tab === 'lists' && <Lists />}
      {tab === 'rejected' && <Rejected />}
    </>
  );
}

function WaitingList() {
  const { t } = useTranslation();
  const q = useApplications('pending');
  if (q.isError) return <Alert tone="error">{errorMessage(t, q.error)}</Alert>;
  return <MemberTable rows={q.data} empty={t('members.noneWaiting')} showApplied />;
}

function Rejected() {
  const { t } = useTranslation();
  const q = useApplications('rejected');
  if (q.isError) return <Alert tone="error">{errorMessage(t, q.error)}</Alert>;
  return <MemberTable rows={q.data} empty={t('members.noneRejected')} showApplied />;
}

function Search() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const results = useMemberSearch(q);
  return (
    <div className="space-y-4">
      <Input
        type="search"
        aria-label={t('members.searchLabel')}
        placeholder={t('members.searchPlaceholder')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      {results.isError && <Alert tone="error">{errorMessage(t, results.error)}</Alert>}
      {q.trim().length >= 2 && <MemberTable rows={results.data} empty={t('members.noMatch')} />}
    </div>
  );
}

function Lists() {
  const { t } = useTranslation();
  const q = useMembershipOverview();
  if (q.isError) return <Alert tone="error">{errorMessage(t, q.error)}</Alert>;
  if (!q.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  return (
    <div className="space-y-6">
      {(['expiringSoon', 'expired', 'paidRecently'] as const).map((key) => (
        <section key={key}>
          <h2 className="mb-2 font-semibold">
            {t(`members.lists.${key}`)}{' '}
            <span className="text-stone-500">({q.data[key].length})</span>
          </h2>
          <MemberTable rows={q.data[key]} empty={t('members.listEmpty')} showExpiry />
        </section>
      ))}
    </div>
  );
}

export function StateBadge({ state }: { state: MemberSummary['state'] }) {
  const { t } = useTranslation();
  const tone: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-900',
    pending: 'bg-sky-50 text-sky-950',
    expired: 'bg-amber-100 text-amber-950',
    suspended: 'bg-red-50 text-red-900',
  };
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${tone[state] ?? 'bg-stone-200 text-stone-700'}`}
    >
      {t(`membership.${state}`)}
    </span>
  );
}

function MemberTable({
  rows,
  empty,
  showApplied = false,
  showExpiry = false,
}: {
  rows: MemberSummary[] | undefined;
  empty: string;
  showApplied?: boolean;
  showExpiry?: boolean;
}) {
  const { t } = useTranslation();
  const branches = useBranches();
  const code = (id: number | null) => branches.data?.find((b) => b.id === id)?.code ?? '';
  if (!rows) return <p className="text-stone-600">{t('common.loading')}</p>;
  if (rows.length === 0) return <p className="text-stone-600">{empty}</p>;
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-600 uppercase">
          <tr>
            <th className="px-4 py-3 font-medium">{t('person.fullName')}</th>
            <th className="px-4 py-3 font-medium">{t('members.ageArea')}</th>
            <th className="px-4 py-3 font-medium">{t('person.introducedByName')}</th>
            <th className="px-4 py-3 font-medium">
              {showExpiry
                ? t('members.expires')
                : showApplied
                  ? t('members.applied')
                  : t('members.state')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-3">
                <Link to={`/members/${m.id}`} className="font-medium text-emerald-900 underline">
                  {m.fullName}
                </Link>
                <div className="text-xs text-stone-600 tabular-nums">
                  {m.whatsappPhone} · {code(m.branchId)}
                  {m.organisation && ` · ${m.organisation}`}
                </div>
              </td>
              <td className="px-4 py-3">
                {m.age ?? '—'}
                {m.area && <span className="text-stone-600"> · {m.area}</span>}
              </td>
              <td className="px-4 py-3">
                {m.introducedByName ?? '—'}
                <div className="text-xs text-stone-600 tabular-nums">{m.introducedByPhone}</div>
              </td>
              <td className="px-4 py-3">
                {showExpiry && <span className="tabular-nums">{m.expireAt ?? '—'}</span>}
                {showApplied && <span className="tabular-nums">{m.appliedAt?.slice(0, 10)}</span>}
                {!showExpiry && !showApplied && <StateBadge state={m.state} />}
                {m.stale && (
                  <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">
                    {t('members.stale')}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
