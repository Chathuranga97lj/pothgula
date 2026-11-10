import type { Settlement } from '@pothgula/shared';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { errorMessage } from '../api/errors';
import { useBranches } from '../api/queries';
import { useSettlementBoard } from '../api/settlements';
import { useMe } from '../auth/auth';
import { SettlementLine, SettlementStatus } from '../components/settlements';
import { Alert, Card, Field, PageTitle, Select } from '../components/ui';

/** FR-LST-10: unsettled lost books per branch, windows passed first; the tariff is one click away. */
export function SettlementsPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const isSuper = user.userType === 'super_admin';
  const [params, setParams] = useSearchParams();
  const branchId = Number(params.get('branch')) || null;
  const branches = useBranches(isSuper);
  const board = useSettlementBoard(branchId);
  const tariffBranch = branchId ?? user.branchId;

  return (
    <>
      <PageTitle lead={t('settlements.boardLead')}>{t('settlements.boardTitle')}</PageTitle>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        {isSuper && (
          <div className="w-full max-w-xs">
            <Field label={t('due.branch')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={branchId ?? ''}
                  onChange={(e) => setParams(e.target.value ? { branch: e.target.value } : {})}
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
        )}
        {tariffBranch !== null && (
          <Link
            to={`/lost-books/tariff/${tariffBranch}`}
            className="inline-flex min-h-10 items-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50"
          >
            {t('settlements.tariffLink')}
          </Link>
        )}
      </div>
      {board.isError && <Alert tone="error">{errorMessage(t, board.error)}</Alert>}
      {board.data && (
        <div className="space-y-10">
          {board.data.branches.map((b) => (
            <section
              key={b.branchId}
              className="space-y-5"
              aria-label={`${b.branchCode} — ${b.branchName}`}
            >
              {board.data.branches.length > 1 && (
                <h2 className="text-lg font-semibold">
                  {b.branchCode} — {b.branchName}
                </h2>
              )}
              <Section title={t('settlements.openTitle')} list={b.open} />
              <Section title={t('settlements.recentTitle')} list={b.recent} />
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function Section({ title, list }: { title: string; list: Settlement[] }) {
  const { t } = useTranslation();
  return (
    <Card className="min-w-0 p-0">
      <h3 className="px-5 pt-4 font-semibold">
        {title} <span className="text-stone-600 tabular-nums">({list.length})</span>
      </h3>
      {list.length === 0 ? (
        <p className="px-5 py-3 text-sm text-stone-600">{t('requests.nothingHere')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100 border-t border-stone-200">
          {list.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm"
            >
              <div className="min-w-0">
                <p>
                  <Link
                    to={`/lost-books/${s.id}`}
                    className="font-medium text-emerald-900 underline"
                  >
                    {s.title}
                  </Link>{' '}
                  <span className="font-mono text-xs text-stone-600">{s.accessionNo}</span>
                </p>
                <p className="text-stone-700">
                  <Link to={`/members/${s.memberId}`} className="underline">
                    {s.memberName}
                  </Link>
                  {s.memberPhone && <span className="tabular-nums"> · {s.memberPhone}</span>} ·{' '}
                  {t('settlements.declaredOn', { date: s.declaredOn })}
                </p>
                <p className="text-stone-700">
                  <SettlementLine settlement={s} />
                </p>
              </div>
              <SettlementStatus settlement={s} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
