import { loanSchema, todayColombo } from '@pothgula/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { useBranches } from '../api/queries';
import { useMe } from '../auth/auth';
import { DecideExtension, isUrgent } from '../components/extensions';
import { Alert, Card, Field, PageTitle, Select } from '../components/ui';

/** Under the loans key, so deciding one (here or on the loan) refreshes the list. */
const extensionsKey = (branchId: number | null) =>
  ['loans', 'extensions', branchId ?? 'all'] as const;

/** FR-CIR-12, FR-CIR-13: the requests waiting for a decision, urgent ones marked. */
export function ExtensionsPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const isSuper = user.userType === 'super_admin';
  const [params, setParams] = useSearchParams();
  const branchId = Number(params.get('branch')) || null;
  const branches = useBranches(isSuper);
  const list = useQuery({
    queryKey: extensionsKey(branchId),
    queryFn: () =>
      api(branchId === null ? '/extensions' : `/extensions?branchId=${branchId}`, {
        schema: z.array(loanSchema),
      }),
  });
  const [notice, setNotice] = useState<string | null>(null);
  const today = todayColombo();
  const code = (id: number) => branches.data?.find((b) => b.id === id)?.code;

  return (
    <>
      <PageTitle lead={t('extensions.listLead')}>{t('extensions.listTitle')}</PageTitle>
      {isSuper && (
        <div className="mb-5 max-w-xs">
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
      {notice && (
        <div className="mb-5">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {list.isError && <Alert tone="error">{errorMessage(t, list.error)}</Alert>}
      {list.data && list.data.length === 0 && (
        <Card>
          <p className="text-stone-700">{t('extensions.noneWaiting')}</p>
        </Card>
      )}
      <ul className="space-y-4">
        {list.data?.map((l) => (
          <li key={l.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    <Link to={`/loans/${l.id}`} className="text-emerald-900 underline">
                      {l.title}
                    </Link>{' '}
                    <span className="font-mono text-xs font-normal text-stone-600">
                      {l.accessionNo}
                    </span>
                  </p>
                  <p className="text-sm text-stone-700">
                    <Link to={`/members/${l.memberId}`} className="underline">
                      {l.memberName}
                    </Link>
                    {l.memberPhone && ` · ${l.memberPhone}`}
                    {isSuper && !branchId && code(l.branchId) && ` · ${code(l.branchId)}`}
                  </p>
                  <p className="mt-1 text-sm text-stone-600 tabular-nums">
                    {l.dueDate < today
                      ? t('extensions.wasDue', { date: l.dueDate })
                      : t('extensions.dueOn', { date: l.dueDate })}
                    {' · '}
                    {t('extensions.askedOn', { date: l.extensionRequestedAt?.slice(0, 10) })}
                  </p>
                </div>
                {isUrgent(l, today) && (
                  <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-900">
                    {t('extensions.urgent')}
                  </span>
                )}
              </div>
              <div className="mt-4">
                <DecideExtension
                  loan={l}
                  onDone={(done, approved) =>
                    setNotice(
                      approved
                        ? t('extensions.approvedFor', { title: done.title, date: done.dueDate })
                        : t('extensions.declinedFor', { title: done.title }),
                    )
                  }
                />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
