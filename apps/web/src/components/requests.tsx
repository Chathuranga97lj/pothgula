import type { BookRequest, TitleDetail } from '@pothgula/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useBranches } from '../api/queries';
import { useOwnRequests, useRequestStep } from '../api/requests';
import { useMe } from '../auth/auth';
import { Alert, Button, Card } from './ui';

const TONE: Record<BookRequest['status'], string> = {
  requested: 'bg-amber-50 text-amber-950',
  accepted: 'bg-sky-50 text-sky-950',
  in_transit: 'bg-sky-50 text-sky-950',
  held: 'bg-violet-50 text-violet-950',
  issued: 'bg-emerald-50 text-emerald-900',
  returning: 'bg-sky-50 text-sky-950',
  completed: 'bg-stone-100 text-stone-700',
  declined: 'bg-red-50 text-red-900',
  cancelled: 'bg-stone-100 text-stone-700',
  lapsed: 'bg-amber-50 text-amber-950',
  lost_in_transit: 'bg-red-50 text-red-900',
};

export function RequestStatus({ request }: { request: BookRequest }) {
  const { t } = useTranslation();
  // On the way home, waiting at the member's branch reads differently from on the road.
  const key =
    request.status === 'returning' && request.returnDispatchedAt === null
      ? 'returning_waiting'
      : request.status;
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[request.status]}`}
    >
      {t(`requests.status.${key}`)}
    </span>
  );
}

/**
 * FR-REQ-01: on a title's page, a member may ask another branch for a copy on its
 * shelf. Their own branch's copies are borrowed at the counter as usual.
 */
export function AskAnotherBranch({ title }: { title: TitleDetail }) {
  const { t } = useTranslation();
  const { user } = useMe();
  const branches = useBranches();
  const [done, setDone] = useState<string | null>(null);
  const { step, error } = useRequestStep((r) =>
    setDone(t('requests.asked', { branch: r[0]?.from.name ?? '' })),
  );
  const elsewhere = [
    ...new Set(
      title.copies
        .filter((c) => c.state === 'on_shelf' && c.branchId !== user.branchId)
        .map((c) => c.branchId),
    ),
  ];
  if (elsewhere.length === 0 || title.mergedIntoId) return null;
  const name = (id: number) => branches.data?.find((b) => b.id === id)?.name ?? '';

  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('requests.askTitle')}</h2>
      <p className="mb-3 text-sm text-stone-600">{t('requests.askLead')}</p>
      {done ? (
        <Alert tone="success">
          {done}{' '}
          <Link to="/my-membership" className="font-medium underline">
            {t('requests.seeMine')}
          </Link>
        </Alert>
      ) : (
        <div className="flex flex-wrap gap-2">
          {elsewhere.map((id) => (
            <Button
              key={id}
              variant="secondary"
              disabled={step.isPending}
              onClick={() =>
                step.mutate({ path: '/me/requests', body: { titleId: title.id, fromBranchId: id } })
              }
            >
              {t('requests.askBranch', { branch: name(id) })}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </Card>
  );
}

/** The member's own requests, with the way to withdraw one not yet accepted (FR-REQ-11). */
export function MyRequests() {
  const { t } = useTranslation();
  const mine = useOwnRequests(true);
  const { step, error } = useRequestStep();
  if (!mine.data || mine.data.length === 0) return null;
  return (
    <Card className="mb-6 p-0">
      <h2 className="px-5 pt-5 font-semibold">{t('requests.mine')}</h2>
      <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-200">
        {mine.data.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium">{r.title}</p>
              <p className="text-stone-600">
                {t('requests.fromBranch', { branch: r.from.name })} · {r.requestedAt.slice(0, 10)}
              </p>
              {r.status === 'held' && r.holdUntil && (
                <p className="text-violet-900">
                  {t('requests.collectBy', { branch: r.to.name, date: r.holdUntil })}
                </p>
              )}
              {r.status === 'declined' && r.declineReason && (
                <p className="text-stone-700">{r.declineReason}</p>
              )}
            </div>
            <div className="text-right">
              <RequestStatus request={r} />
              {r.status === 'requested' && (
                <Button
                  variant="ghost"
                  className="mt-1 block min-h-8 px-2 py-1 text-xs"
                  disabled={step.isPending}
                  onClick={() => step.mutate({ path: `/me/requests/${r.id}/cancel` })}
                >
                  {t('requests.cancel')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <div className="px-5 pb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </Card>
  );
}
