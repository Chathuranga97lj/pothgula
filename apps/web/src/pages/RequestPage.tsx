import type { BookRequestDetail } from '@pothgula/shared';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useTitle } from '../api/catalogue';
import { errorMessage } from '../api/errors';
import { downloadTransitSlip, useRequestDetail, useRequestStep } from '../api/requests';
import { useMe } from '../auth/auth';
import { LoanStatusBadge } from '../components/loans';
import { History } from '../components/log';
import { RequestStatus } from '../components/requests';
import { Alert, Button, Card, Field, Input, PageTitle, Select } from '../components/ui';

/** FR-REQ-03, FR-REQ-04 to FR-REQ-07, FR-REQ-14: one request, its member, and the next step. */
export function RequestPage() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const detail = useRequestDetail(id);
  const [notice, setNotice] = useState<string | null>(null);

  if (detail.isError) return <Alert tone="error">{errorMessage(t, detail.error)}</Alert>;
  if (!detail.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  const r = detail.data;
  const when = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');
  const rows: [string, ReactNode][] = [
    [t('requests.fields.route'), `${r.from.code} — ${r.from.name} → ${r.to.code} — ${r.to.name}`],
    [t('requests.fields.copy'), r.accessionNo ?? '—'],
    [t('requests.fields.asked'), when(r.requestedAt)],
    [t('requests.fields.decided'), when(r.decidedAt)],
    ...(r.declineReason
      ? ([[t('requests.fields.reason'), r.declineReason]] as [string, ReactNode][])
      : []),
    [t('requests.fields.sent'), when(r.dispatchedAt)],
    [t('requests.fields.arrived'), when(r.arrivedAt)],
    [t('requests.fields.holdUntil'), r.holdUntil ?? '—'],
    [
      t('requests.fields.loan'),
      r.borrowId ? (
        <Link to={`/loans/${r.borrowId}`} className="underline">
          {t('requests.openLoan')}
        </Link>
      ) : (
        '—'
      ),
    ],
    [t('requests.fields.sentBack'), when(r.returnDispatchedAt)],
    [t('requests.fields.home'), when(r.returnArrivedAt)],
    ...(r.lostReason ? ([[t('requests.fields.lost'), r.lostReason]] as [string, ReactNode][]) : []),
  ];

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/requests" className="text-emerald-800 underline">
          ← {t('requests.boardTitle')}
        </Link>
      </p>
      <PageTitle lead={t('requests.forMember', { name: r.memberName })}>
        {r.title} <RequestStatus request={r} />
      </PageTitle>
      {notice && (
        <div className="mb-5">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <NextStep request={r} onDone={setNotice} />
          <Card>
            <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-stone-600">{k}</dt>
                  <dd className="font-medium break-words tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
        <MemberCard request={r} />
      </div>
      <div className="mt-6">
        <History entity="book_request" entityId={r.id} />
      </div>
    </>
  );
}

/** FR-REQ-03: the member in full, for a branch lending to someone it has never met. */
function MemberCard({ request: r }: { request: BookRequestDetail }) {
  const { t } = useTranslation();
  const m = r.member;
  const rows: [string, ReactNode][] = [
    [t('requests.member.name'), m.fullName],
    [t('requests.member.whatsapp'), m.whatsappPhone ?? '—'],
    [t('requests.member.other'), m.otherPhone ?? '—'],
    [t('requests.member.address'), m.address ?? '—'],
    [
      t('requests.member.born'),
      m.dateOfBirth ? t('requests.member.age', { date: m.dateOfBirth, age: m.age }) : '—',
    ],
    [t('requests.member.organisation'), m.organisation ?? '—'],
    [
      t('requests.member.introducer'),
      [m.introducedByName, m.introducedByPhone].filter(Boolean).join(' · ') || '—',
    ],
    [t('requests.member.home'), `${r.to.code} — ${r.to.name}`],
    [t('requests.member.expires'), m.expireAt ?? '—'],
    [
      t('requests.member.lateReturns'),
      t('requests.member.lateCount', { count: r.lateReturns, months: r.lateReturnMonths }),
    ],
  ];
  return (
    <Card className="min-w-0">
      <h2 className="mb-3 font-semibold">{t('requests.member.title')}</h2>
      <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-stone-600">{k}</dt>
            <dd className="font-medium break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-5 mb-2 text-sm font-semibold">{t('requests.member.books')}</h3>
      {r.memberLoans.length === 0 ? (
        <p className="text-sm text-stone-600">{t('requests.member.noBooks')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {r.memberLoans.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2">
              <span>{l.title}</span>
              <span className="text-stone-600 tabular-nums">
                {t('loans.due')} {l.dueDate}
              </span>
              <LoanStatusBadge loan={l} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** What can be done next, by whom: only the step that belongs to the viewer's branch. */
function NextStep({
  request: r,
  onDone,
}: {
  request: BookRequestDetail;
  onDone: (text: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useMe();
  const isSuper = user.userType === 'super_admin';
  const at = (branchId: number) => isSuper || user.branchId === branchId;
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [copyId, setCopyId] = useState('');
  const [lostReason, setLostReason] = useState('');
  const title = useTitle(r.titleId);
  const { step, error } = useRequestStep(async (done) => {
    const s = done[0]!;
    onDone(t(`requests.done.${s.status}`, { title: s.title }));
    if (s.status === 'in_transit' || (s.status === 'returning' && s.returnDispatchedAt)) {
      await downloadTransitSlip([s.id]).catch(() => undefined);
    }
  });
  const onShelf = (title.data?.copies ?? []).filter(
    (c) => c.branchId === r.from.id && c.state === 'on_shelf',
  );
  const onTheRoad =
    r.status === 'in_transit' || (r.status === 'returning' && r.returnDispatchedAt !== null);

  let body: ReactNode = null;
  if (r.status === 'requested' && at(r.from.id)) {
    body = declining ? (
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (reason.trim()) step.mutate({ path: `/requests/${r.id}/decline`, body: { reason } });
        }}
      >
        <Field label={t('requests.declineReason')} hint={t('requests.declineHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              autoFocus
              aria-describedby={describedBy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="danger" disabled={!reason.trim() || step.isPending}>
            {t('requests.confirmDecline')}
          </Button>
          <Button variant="ghost" onClick={() => setDeclining(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    ) : (
      <div className="space-y-3">
        <Field label={t('requests.chooseCopy')} hint={t('requests.chooseCopyHint')}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={copyId}
              onChange={(e) => setCopyId(e.target.value)}
            >
              <option value="">{t('requests.pickCopy', { count: onShelf.length })}</option>
              {onShelf.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.accessionNo}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!copyId || step.isPending}
            onClick={() =>
              step.mutate({ path: `/requests/${r.id}/accept`, body: { copyId: Number(copyId) } })
            }
          >
            {t('requests.accept')}
          </Button>
          <Button variant="secondary" onClick={() => setDeclining(true)}>
            {t('requests.decline')}
          </Button>
        </div>
      </div>
    );
  } else if (r.status === 'accepted' && at(r.from.id)) {
    body = (
      <Button
        disabled={step.isPending}
        onClick={() => step.mutate({ path: '/requests/dispatch', body: { requestIds: [r.id] } })}
      >
        {t('requests.sendNow')}
      </Button>
    );
  } else if (r.status === 'in_transit' && at(r.to.id)) {
    body = (
      <Button
        disabled={step.isPending}
        onClick={() => step.mutate({ path: `/requests/${r.id}/arrive` })}
      >
        {t('requests.recordArrival')}
      </Button>
    );
  } else if (r.status === 'held' && at(r.to.id)) {
    body = (
      <p className="text-sm text-stone-700">
        {t('requests.issueAtCounter', { date: r.holdUntil })}{' '}
        <Link to={`/counter?member=${r.memberId}`} className="font-medium underline">
          {t('counter.issueBook')}
        </Link>
      </p>
    );
  } else if (
    (r.status === 'lapsed' || (r.status === 'returning' && !r.returnDispatchedAt)) &&
    at(r.to.id)
  ) {
    body = (
      <Button
        disabled={step.isPending}
        onClick={() => step.mutate({ path: '/requests/dispatch', body: { requestIds: [r.id] } })}
      >
        {t('requests.sendHome')}
      </Button>
    );
  } else if (r.status === 'returning' && r.returnDispatchedAt && at(r.from.id)) {
    body = (
      <Button
        disabled={step.isPending}
        onClick={() => step.mutate({ path: `/requests/${r.id}/arrive` })}
      >
        {t('requests.recordHome')}
      </Button>
    );
  }

  if (!body && !(onTheRoad && isSuper)) return null;
  return (
    <Card>
      <h2 className="mb-3 font-semibold">{t('requests.nextStep')}</h2>
      {body}
      {onTheRoad && isSuper && (
        <form
          className="mt-5 space-y-3 border-t border-stone-200 pt-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (lostReason.trim()) {
              step.mutate({ path: `/requests/${r.id}/lost`, body: { reason: lostReason } });
            }
          }}
        >
          <p className="text-sm text-stone-600">{t('requests.lostLead')}</p>
          <Field label={t('requests.lostReason')}>
            {({ id }) => (
              <Input id={id} value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
            )}
          </Field>
          <Button type="submit" variant="danger" disabled={!lostReason.trim() || step.isPending}>
            {t('requests.markLost')}
          </Button>
        </form>
      )}
      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </Card>
  );
}
