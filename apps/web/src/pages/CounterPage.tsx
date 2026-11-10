import {
  daysLate,
  type IssueCheck,
  issueCheckSchema,
  type Loan,
  loanSchema,
  normalizeAccession,
  todayColombo,
} from '@pothgula/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { LOANS_KEY, useMemberLoans } from '../api/loans';
import { useMember } from '../api/members';
import { MemberPicker, PaperDate, RefusalList, StandingBanner } from '../components/loans';
import { Alert, Button, Card, Field, Input, PageTitle } from '../components/ui';
import { StateBadge } from './MembersPage';

type Tab = 'issue' | 'return';

/** §7: the counter — lending a book, and taking one back. */
export function CounterPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'return' ? 'return' : 'issue';
  const initialMember = Number(params.get('member')) || null;

  return (
    <>
      <PageTitle lead={t('counter.lead')}>{t('counter.title')}</PageTitle>
      <div role="tablist" className="mb-5 flex flex-wrap gap-1 border-b border-stone-200">
        {(['issue', 'return'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setParams(id === 'return' ? { tab: 'return' } : {})}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === id
                ? 'border-emerald-800 text-emerald-900'
                : 'border-transparent text-stone-600'
            }`}
          >
            {t(`counter.tabs.${id}`)}
          </button>
        ))}
      </div>
      {tab === 'issue' ? <IssuePanel initialMember={initialMember} /> : <ReturnPanel />}
    </>
  );
}

// ─── Issuing (FR-CIR-01, FR-CIR-02, FR-CIR-14) ───────────────────────────────

function IssuePanel({ initialMember }: { initialMember: number | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [memberId, setMemberId] = useState<number | null>(initialMember);
  const member = useMember(memberId ?? 0);
  const loans = useMemberLoans(memberId);
  const [accession, setAccession] = useState('');
  const [paper, setPaper] = useState<string | null>(null);
  const [check, setCheck] = useState<IssueCheck | null>(null);
  const [issued, setIssued] = useState<Loan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accessionRef = useRef<HTMLInputElement>(null);

  const body = () => ({
    memberId,
    accessionNo: accession,
    ...(paper ? { borrowDate: paper } : {}),
  });
  const checkCopy = useMutation({
    mutationFn: () =>
      api('/loans/check', { method: 'POST', body: body(), schema: issueCheckSchema }),
    onSuccess: setCheck,
    onError: (err) => setError(errorMessage(t, err)),
  });
  const issue = useMutation({
    mutationFn: () => api('/loans', { method: 'POST', body: body(), schema: loanSchema }),
    onSuccess: async (loan) => {
      setIssued(loan);
      setCheck(null);
      setAccession('');
      await queryClient.invalidateQueries({ queryKey: LOANS_KEY });
      accessionRef.current?.focus();
    },
    onError: (err) => {
      setCheck(null);
      setError(errorMessage(t, err));
    },
  });

  function pick(id: number | null) {
    setMemberId(id);
    setCheck(null);
    setIssued(null);
    setError(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIssued(null);
    setCheck(null);
    if (!normalizeAccession(accession)) {
      setError(t('counter.badAccession'));
      return;
    }
    checkCopy.mutate();
  }

  if (memberId === null) {
    return (
      <Card className="max-w-2xl">
        <MemberPicker label={t('counter.findMember')} onPick={(m) => pick(m.id)} />
      </Card>
    );
  }

  const m = member.data;
  const standing = loans.data?.standing;
  const out = loans.data?.loans.filter((l) => l.status === 'open') ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
      <Card>
        {member.isError && <Alert tone="error">{errorMessage(t, member.error)}</Alert>}
        {m && (
          <>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">
                  <Link to={`/members/${m.id}`} className="underline">
                    {m.fullName}
                  </Link>
                </h2>
                <p className="text-sm text-stone-600 tabular-nums">{m.whatsappPhone}</p>
              </div>
              <StateBadge state={m.state} />
            </div>
            {standing && (
              <>
                <StandingBanner standing={standing} state={m.state} />
                <p className="mt-3 text-sm font-medium" data-testid="holding">
                  {t('counter.holding', { count: standing.openLoans, max: standing.maxBooks })}
                </p>
              </>
            )}
            {out.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {out.map((l) => (
                  <li key={l.id} className={l.overdue ? 'font-medium text-red-800' : undefined}>
                    {l.title} · <span className="font-mono text-xs">{l.accessionNo}</span> ·{' '}
                    {l.overdue
                      ? t('loans.daysLate', { count: l.daysLate })
                      : t('counter.dueOn', { date: l.dueDate })}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="ghost" className="mt-4 -ml-4" onClick={() => pick(null)}>
              {t('counter.otherMember')}
            </Button>
          </>
        )}
      </Card>

      <div className="space-y-5">
        <Card>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <Field label={t('counter.accession')} hint={t('counter.accessionHint')}>
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      ref={accessionRef}
                      aria-describedby={describedBy}
                      className="font-mono uppercase"
                      autoComplete="off"
                      autoFocus
                      value={accession}
                      onChange={(e) => {
                        setAccession(e.target.value);
                        setCheck(null);
                      }}
                    />
                  )}
                </Field>
              </div>
            </div>
            <PaperDate
              value={paper}
              onChange={(d) => {
                setPaper(d);
                setCheck(null);
              }}
            />
            <Button type="submit" variant="secondary" disabled={checkCopy.isPending}>
              {t('counter.check')}
            </Button>
          </form>
        </Card>

        {error && <Alert tone="error">{error}</Alert>}
        {issued && (
          <Alert tone="success" title={t('counter.issued', { accession: issued.accessionNo })}>
            {t('counter.issuedBody', { title: issued.title, date: issued.dueDate })}
          </Alert>
        )}

        {check && (
          <Card>
            <p className="font-semibold">{check.copy.title}</p>
            <p className="text-sm text-stone-600">
              {check.copy.writer && `${check.copy.writer} · `}
              <span className="font-mono">{check.copy.accessionNo}</span>
            </p>
            <div className="mt-4">
              {check.refusals.length > 0 ? (
                <RefusalList refusals={check.refusals} />
              ) : (
                <div className="space-y-4">
                  <p className="text-stone-800">
                    {check.isBackdated
                      ? t('counter.willBePaper', { from: check.borrowDate, date: check.dueDate })
                      : t('counter.willBeDue', { date: check.dueDate })}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button disabled={issue.isPending} onClick={() => issue.mutate()}>
                      {t('counter.issue')}
                    </Button>
                    <Button variant="ghost" onClick={() => setCheck(null)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Taking back (FR-CIR-03, FR-CIR-04, FR-CIR-08, FR-CIR-14) ────────────────

function ReturnPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [accession, setAccession] = useState('');
  const [paper, setPaper] = useState<string | null>(null);
  const [notUseable, setNotUseable] = useState(false);
  const [loan, setLoan] = useState<Loan | null>(null);
  const [done, setDone] = useState<{ loan: Loan; setAside: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accessionRef = useRef<HTMLInputElement>(null);

  const find = useMutation({
    mutationFn: (no: string) =>
      api(`/loans/open?accession=${encodeURIComponent(no)}`, { schema: loanSchema }),
    onSuccess: setLoan,
    onError: (err) => setError(errorMessage(t, err)),
  });
  const takeBack = useMutation({
    mutationFn: (l: Loan) =>
      api(`/loans/${l.id}/return`, {
        method: 'POST',
        body: { ...(paper ? { returnedOn: paper } : {}), ...(notUseable ? { notUseable } : {}) },
        schema: loanSchema,
      }),
    onSuccess: async (back) => {
      setDone({ loan: back, setAside: notUseable });
      setLoan(null);
      setAccession('');
      setNotUseable(false);
      await queryClient.invalidateQueries({ queryKey: LOANS_KEY });
      accessionRef.current?.focus();
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    setLoan(null);
    const no = normalizeAccession(accession);
    if (!no) {
      setError(t('counter.badAccession'));
      return;
    }
    find.mutate(no);
  }

  // FR-CIR-04: how late it is on the day it actually came back.
  const late = loan
    ? daysLate(
        {
          dueDate: loan.dueDate,
          returnedOn: paper ?? todayColombo(),
          extensionStatus: loan.extensionStatus,
        },
        todayColombo(),
      )
    : 0;

  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label={t('counter.accession')} hint={t('counter.accessionHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                ref={accessionRef}
                aria-describedby={describedBy}
                className="font-mono uppercase"
                autoComplete="off"
                autoFocus
                value={accession}
                onChange={(e) => {
                  setAccession(e.target.value);
                  setLoan(null);
                }}
              />
            )}
          </Field>
          <PaperDate value={paper} onChange={setPaper} />
          <Button type="submit" variant="secondary" disabled={find.isPending}>
            {t('counter.find')}
          </Button>
        </form>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}
      {done && (
        <Alert tone="success" title={t('counter.returned', { accession: done.loan.accessionNo })}>
          {done.loan.title}
          {done.loan.daysLate > 0 && (
            <> · {t('counter.returnedLate', { count: done.loan.daysLate })}</>
          )}
          {done.setAside && <> · {t('counter.setAside')}</>}
        </Alert>
      )}

      {loan && (
        <Card>
          {late > 0 && (
            <div className="mb-4" data-testid="late-callout">
              <Alert tone="warning" title={t('counter.lateTitle', { count: late })}>
                {t('counter.lateBody', { date: loan.dueDate })}
              </Alert>
            </div>
          )}
          <p className="font-semibold">{loan.title}</p>
          <p className="font-mono text-sm text-stone-600">{loan.accessionNo}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-stone-600">{t('loans.member')}</dt>
            <dd>
              <Link to={`/members/${loan.memberId}`} className="font-medium underline">
                {loan.memberName}
              </Link>{' '}
              <span className="text-stone-600 tabular-nums">{loan.memberPhone}</span>
            </dd>
            <dt className="text-stone-600">{t('loans.borrowed')}</dt>
            <dd className="tabular-nums">{loan.borrowDate}</dd>
            <dt className="text-stone-600">{t('loans.due')}</dt>
            <dd className="tabular-nums">{loan.dueDate}</dd>
          </dl>
          <label className="mt-4 flex gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={notUseable}
              onChange={(e) => setNotUseable(e.target.checked)}
            />
            <span>{t('counter.notUseable')}</span>
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button disabled={takeBack.isPending} onClick={() => takeBack.mutate(loan)}>
              {t('counter.takeBack')}
            </Button>
            <Button variant="ghost" onClick={() => setLoan(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
