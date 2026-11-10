import type { BookRequest, BranchRequests } from '@pothgula/shared';
import { addDays, HOLD_LAPSING_DAYS } from '@pothgula/shared';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { errorMessage } from '../api/errors';
import { useBranches } from '../api/queries';
import { downloadTransitSlip, useRequestBoard, useRequestStep } from '../api/requests';
import { useMe } from '../auth/auth';
import { ExtensionNote } from '../components/extensions';
import { RequestStatus } from '../components/requests';
import { Alert, Button, Card, Field, PageTitle, Select } from '../components/ui';

/** FR-REQ-09: books travelling between branches, by what needs doing at each. */
export function RequestsPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const isSuper = user.userType === 'super_admin';
  const [params, setParams] = useSearchParams();
  const branchId = Number(params.get('branch')) || null;
  const branches = useBranches(isSuper);
  const board = useRequestBoard(branchId);

  return (
    <>
      <PageTitle lead={t('requests.boardLead')}>{t('requests.boardTitle')}</PageTitle>
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
      {board.isError && <Alert tone="error">{errorMessage(t, board.error)}</Alert>}
      {board.data && (
        <div className="space-y-10">
          {board.data.branches.map((b) => (
            <BranchBoard
              key={b.branchId}
              b={b}
              today={board.data.today}
              many={board.data.branches.length > 1}
            />
          ))}
        </div>
      )}
    </>
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
  const { t } = useTranslation();
  return (
    <Card className="min-w-0 p-0">
      <h3 className="px-5 pt-4 font-semibold">
        {title} <span className="text-stone-600 tabular-nums">({count})</span>
      </h3>
      {count === 0 ? (
        <p className="px-5 py-3 text-sm text-stone-600">{t('requests.nothingHere')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100 border-t border-stone-200">{children}</ul>
      )}
    </Card>
  );
}

/** One request in a list: what, for whom, between which branches, and where it stands. */
function RequestLine({ r, children }: { r: BookRequest; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
      <div className="min-w-0">
        <p>
          <Link to={`/requests/${r.id}`} className="font-medium text-emerald-900 underline">
            {r.title}
          </Link>{' '}
          {r.accessionNo && (
            <span className="font-mono text-xs text-stone-600">{r.accessionNo}</span>
          )}
        </p>
        <p className="text-stone-700">
          {r.memberName} · {r.from.code} → {r.to.code}
        </p>
        {r.daysInTransit !== null && (
          <p className={r.transitOverdue ? 'font-medium text-red-800' : 'text-stone-600'}>
            {t('requests.daysOnRoad', { count: r.daysInTransit })}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        <RequestStatus request={r} />
        {children}
      </div>
    </li>
  );
}

function BranchBoard({ b, today, many }: { b: BranchRequests; today: string; many: boolean }) {
  const { t } = useTranslation();
  const [ticked, setTicked] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [slipError, setSlipError] = useState<string | null>(null);
  const send = useRequestStep(async (sent) => {
    setTicked([]);
    setNotice(t('requests.sent', { count: sent.length }));
    try {
      await downloadTransitSlip(sent.map((r) => r.id));
    } catch (err) {
      setSlipError(errorMessage(t, err));
    }
  });
  const arrive = useRequestStep((r) => setNotice(t('requests.arrived', { title: r[0]?.title })));
  const lapsingBy = addDays(today, HOLD_LAPSING_DAYS);
  const toggle = (id: number) =>
    setTicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  return (
    <section className="space-y-5" aria-label={`${b.branchCode} — ${b.branchName}`}>
      {many && (
        <h2 className="text-lg font-semibold">
          {b.branchCode} — {b.branchName}
        </h2>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      {slipError && <Alert tone="error">{slipError}</Alert>}
      {(send.error || arrive.error) && <Alert tone="error">{send.error ?? arrive.error}</Alert>}

      {b.transitOverdue.length > 0 && (
        <Alert
          tone="error"
          title={t('requests.transitOverdue', { count: b.transitOverdue.length })}
        >
          <ul className="mt-1 list-disc pl-5">
            {b.transitOverdue.map((r) => (
              <li key={r.id}>
                <Link to={`/requests/${r.id}`} className="underline">
                  {r.title}
                </Link>{' '}
                ({r.accessionNo}) · {t('requests.daysOnRoad', { count: r.daysInTransit ?? 0 })}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t('requests.toDecide')} count={b.toDecide.length}>
          {b.toDecide.map((r) => (
            <RequestLine key={r.id} r={r}>
              <Link
                to={`/requests/${r.id}`}
                className="rounded-md bg-emerald-800 px-3 py-1 text-xs font-medium text-white"
              >
                {t('requests.decide')}
              </Link>
            </RequestLine>
          ))}
        </Section>

        <Section title={t('requests.toSend')} count={b.toSend.length}>
          {b.toSend.map((r) => (
            <RequestLine key={r.id} r={r}>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={ticked.includes(r.id)}
                  onChange={() => toggle(r.id)}
                  aria-label={t('requests.tick', { title: r.title })}
                />
                {r.status === 'accepted' ? t('requests.toMember') : t('requests.goingHome')}
              </label>
            </RequestLine>
          ))}
          <li className="px-5 py-3">
            <Button
              disabled={ticked.length === 0 || send.step.isPending}
              onClick={() =>
                send.step.mutate({ path: '/requests/dispatch', body: { requestIds: ticked } })
              }
            >
              {t('requests.sendTicked', { count: ticked.length })}
            </Button>
            <p className="mt-2 text-xs text-stone-600">{t('requests.slipHint')}</p>
          </li>
        </Section>

        <Section title={t('requests.arriving')} count={b.arriving.length}>
          {b.arriving.map((r) => (
            <RequestLine key={r.id} r={r}>
              <Button
                variant="secondary"
                className="min-h-8 px-3 py-1 text-xs"
                disabled={arrive.step.isPending}
                onClick={() => arrive.step.mutate({ path: `/requests/${r.id}/arrive` })}
              >
                {t('requests.recordArrival')}
              </Button>
            </RequestLine>
          ))}
        </Section>

        <Section title={t('requests.held')} count={b.held.length}>
          {b.held.map((r) => (
            <RequestLine key={r.id} r={r}>
              <span
                className={`text-xs ${(r.holdUntil ?? today) <= lapsingBy ? 'font-medium text-amber-800' : 'text-stone-600'}`}
              >
                {t('requests.heldUntil', { date: r.holdUntil })}
              </span>
            </RequestLine>
          ))}
        </Section>

        <Section title={t('requests.ourMembers')} count={b.ourMembers.length}>
          {b.ourMembers.map((r) => (
            <RequestLine key={r.id} r={r} />
          ))}
        </Section>

        <Section title={t('requests.outElsewhere')} count={b.outElsewhere.length}>
          {b.outElsewhere.map((l) => (
            <li key={l.id} className="px-5 py-3 text-sm">
              <Link to={`/loans/${l.id}`} className="font-medium text-emerald-900 underline">
                {l.title}
              </Link>{' '}
              <span className="font-mono text-xs text-stone-600">{l.accessionNo}</span>
              <p className="text-stone-700">
                {l.memberName} · {t('loans.due')} {l.dueDate}
              </p>
              <ExtensionNote loan={l} />
            </li>
          ))}
        </Section>
      </div>
    </section>
  );
}
