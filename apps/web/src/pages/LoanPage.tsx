import { type Loan, loanSchema, type MemberSummary, normalizeAccession } from '@pothgula/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { LOANS_KEY, loanKey, useLoan } from '../api/loans';
import { useMe } from '../auth/auth';
import { LoanStatusBadge, MemberPicker } from '../components/loans';
import { History } from '../components/log';
import { Alert, Button, Card, Field, Input, PageTitle } from '../components/ui';

/** FR-CIR-05: one loan, its corrections, and (super admin) voiding it. */
export function LoanPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const id = Number(useParams().id);
  const loan = useLoan(id);
  const [notice, setNotice] = useState<string | null>(null);

  if (loan.isError) return <Alert tone="error">{errorMessage(t, loan.error)}</Alert>;
  if (!loan.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  const l = loan.data;

  const rows: [string, ReactNode][] = [
    [t('loans.copy'), <span className="font-mono">{l.accessionNo}</span>],
    [
      t('loans.member'),
      <Link to={`/members/${l.memberId}`} className="underline">
        {l.memberName}
      </Link>,
    ],
    [t('loans.borrowed'), withPaper(l.borrowDate, l.isBackdated, t('loans.paper'))],
    [t('loans.due'), l.dueDate],
    [t('loans.returned'), withPaper(l.returnedOn ?? '—', l.returnBackdated, t('loans.paper'))],
    ...(l.daysLate > 0
      ? ([[t('loans.lateness'), t('loans.daysLate', { count: l.daysLate })]] as [
          string,
          ReactNode,
        ][])
      : []),
    ...(l.voidReason ? ([[t('loans.voidReason'), l.voidReason]] as [string, ReactNode][]) : []),
  ];

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to={`/members/${l.memberId}`} className="text-emerald-800 underline">
          ← {l.memberName}
        </Link>
      </p>
      <PageTitle>
        {l.title} <LoanStatusBadge loan={l} />
      </PageTitle>
      {notice && (
        <div className="mb-5">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        <Card>
          <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-stone-600">{k}</dt>
                <dd className="font-medium tabular-nums break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        {l.status !== 'void' && (
          <div className="space-y-6">
            <Correct loan={l} onDone={() => setNotice(t('loans.corrected'))} />
            {user.userType === 'super_admin' && (
              <Void loan={l} onDone={() => setNotice(t('loans.voided'))} />
            )}
          </div>
        )}
      </div>
      <div className="mt-6">
        <History entity="borrow" entityId={l.id} />
      </div>
    </>
  );
}

function withPaper(value: string, paper: boolean, label: string): ReactNode {
  return (
    <>
      {value}
      {paper && <span className="ml-2 rounded bg-stone-100 px-1 text-xs">{label}</span>}
    </>
  );
}

function useLoanChange(
  id: number,
  path: string,
  method: 'POST' | 'PATCH',
  onDone: () => void,
  setError: (e: string | null) => void,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api(path, { method, body, schema: loanSchema }),
    onSuccess: async (saved: Loan) => {
      queryClient.setQueryData(loanKey(id), saved);
      await queryClient.invalidateQueries({ queryKey: LOANS_KEY });
      onDone();
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
}

/** Wrong copy, wrong member, wrong date — or a take-back recorded by mistake. */
function Correct({ loan, onDone }: { loan: Loan; onDone: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [accession, setAccession] = useState(loan.accessionNo);
  const [borrowDate, setBorrowDate] = useState(loan.borrowDate);
  const [returnedOn, setReturnedOn] = useState(loan.returnedOn ?? '');
  const [undoReturn, setUndoReturn] = useState(false);
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [reason, setReason] = useState('');
  const save = useLoanChange(
    loan.id,
    `/loans/${loan.id}`,
    'PATCH',
    () => {
      setReason('');
      setMember(null);
      setUndoReturn(false);
      onDone();
    },
    setError,
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = { reason: reason.trim() };
    const no = normalizeAccession(accession);
    if (!no) return setError(t('counter.badAccession'));
    if (no !== loan.accessionNo) body.accessionNo = no;
    if (member && member.id !== loan.memberId) body.memberId = member.id;
    if (borrowDate && borrowDate !== loan.borrowDate) body.borrowDate = borrowDate;
    if (undoReturn) body.returnedOn = null;
    else if (loan.returnedOn && returnedOn && returnedOn !== loan.returnedOn) {
      body.returnedOn = returnedOn;
    }
    if (Object.keys(body).length === 1) return setError(t('errors.nothing_to_change'));
    save.mutate(body);
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('loans.correctTitle')}</h2>
      <p className="mb-4 text-sm text-stone-600">{t('loans.correctLead')}</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('loans.copy')}>
            {({ id }) => (
              <Input
                id={id}
                className="font-mono uppercase"
                value={accession}
                onChange={(e) => setAccession(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('loans.borrowed')} hint={t('loans.borrowedHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="date"
                aria-describedby={describedBy}
                value={borrowDate}
                onChange={(e) => setBorrowDate(e.target.value)}
              />
            )}
          </Field>
          {loan.returnedOn && (
            <>
              <Field label={t('loans.returned')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    disabled={undoReturn}
                    value={returnedOn}
                    onChange={(e) => setReturnedOn(e.target.value)}
                  />
                )}
              </Field>
              <label className="flex gap-3 self-end text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={undoReturn}
                  onChange={(e) => setUndoReturn(e.target.checked)}
                />
                <span>{t('loans.undoReturn')}</span>
              </label>
            </>
          )}
        </div>
        {member ? (
          <p className="text-sm">
            {t('loans.newMember')} <strong>{member.fullName}</strong>{' '}
            <Button variant="ghost" onClick={() => setMember(null)}>
              {t('common.cancel')}
            </Button>
          </p>
        ) : (
          <MemberPicker label={t('loans.changeMember')} onPick={setMember} />
        )}
        <Field label={t('loans.reason')}>
          {({ id }) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <Button type="submit" disabled={!reason.trim() || save.isPending}>
          {t('loans.saveCorrection')}
        </Button>
      </form>
    </Card>
  );
}

/** A loan entered entirely by mistake: kept on the record, marked void, counted nowhere. */
function Void({ loan, onDone }: { loan: Loan; onDone: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const save = useLoanChange(loan.id, `/loans/${loan.id}/void`, 'POST', onDone, setError);
  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('loans.voidTitle')}</h2>
      <p className="mb-4 text-sm text-stone-600">{t('loans.voidLead')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate({ reason: reason.trim() });
        }}
        className="space-y-4"
      >
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t('loans.voidReason')}>
          {({ id }) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <Button type="submit" variant="danger" disabled={!reason.trim() || save.isPending}>
          {t('loans.void')}
        </Button>
      </form>
    </Card>
  );
}
