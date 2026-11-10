import { parseRupees, type Settlement, todayColombo } from '@pothgula/shared';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { errorMessage } from '../api/errors';
import { useCopyFound, useSettlement, useSettlementStep } from '../api/settlements';
import { useMe } from '../auth/auth';
import { History } from '../components/log';
import { ReceiptButton } from '../components/receipts';
import { rupees, SettlementLine, SettlementStatus } from '../components/settlements';
import { Alert, Button, Card, Field, Input, PageTitle } from '../components/ui';

/** FR-LST-02 to FR-LST-13: one settlement, its money, and what can be done next. */
export function SettlementPage() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const settlement = useSettlement(id);
  const [notice, setNotice] = useState<string | null>(null);

  if (settlement.isError) return <Alert tone="error">{errorMessage(t, settlement.error)}</Alert>;
  if (!settlement.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  const s = settlement.data;
  const opt = (cond: unknown, row: [string, ReactNode]): [string, ReactNode][] =>
    cond ? [row] : [];
  const rows: [string, ReactNode][] = [
    [
      t('settlements.fields.member'),
      <Link to={`/members/${s.memberId}`} className="underline">
        {s.memberName}
      </Link>,
    ],
    [
      t('settlements.fields.phones'),
      [s.memberPhone, s.memberOtherPhone].filter(Boolean).join(' · ') || '—',
    ],
    [t('settlements.fields.copy'), <span className="font-mono">{s.accessionNo}</span>],
    [t('settlements.fields.owner'), `${s.copyBranch.code} — ${s.copyBranch.name}`],
    [t('settlements.fields.kind'), t(`settlements.kind.${s.kind}`)],
    [t('settlements.fields.reason'), s.reason],
    [t('settlements.fields.declared'), `${s.declaredOn} · ${s.declaredByName}`],
    [
      t('settlements.fields.tariff'),
      s.tariffCents === null ? t('settlements.noTariff') : rupees(s.tariffCents),
    ],
    [t('settlements.fields.set'), `${rupees(s.setAmountCents)} · ${s.amountSetByName}`],
    ...opt(s.amountReason, [t('settlements.fields.amountReason'), s.amountReason]),
    ...opt(s.amountDueCents !== s.setAmountCents, [
      t('settlements.fields.due'),
      rupees(s.amountDueCents),
    ]),
    ...opt(s.reductionReason, [t('settlements.fields.reductionReason'), s.reductionReason]),
    [t('settlements.fields.window'), <SettlementLine settlement={s} />],
    ...opt(s.windowExtendedDays, [
      t('settlements.fields.extended'),
      t('settlements.extendedBy', {
        count: s.windowExtendedDays ?? 0,
        reason: s.windowExtensionReason,
      }),
    ]),
    ...opt(s.replacementAccessionNo, [
      t('settlements.fields.replacement'),
      <Link to={`/titles/${s.titleId}`} className="font-mono underline">
        {s.replacementAccessionNo}
      </Link>,
    ]),
    ...opt(s.waiverReason, [t('settlements.fields.waiver'), s.waiverReason]),
    ...opt(s.foundOn, [t('settlements.fields.found'), `${s.foundOn} · ${s.foundReason}`]),
    ...opt(s.handledByName, [t('settlements.fields.handledBy'), s.handledByName]),
  ];

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/lost-books" className="text-emerald-800 underline">
          ← {t('settlements.boardTitle')}
        </Link>
      </p>
      <PageTitle lead={t('settlements.pageLead', { name: s.memberName })}>
        {s.title} <SettlementStatus settlement={s} />
      </PageTitle>
      {notice && (
        <div className="mb-5">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {s.foundOn && s.status === 'paid' && (
        <div className="mb-5">
          <Alert tone="warning" title={t('settlements.foundPaidTitle')}>
            {t('settlements.foundPaidBody', { amount: rupees(s.paidCents) })}
          </Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <Card>
            <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-stone-600">{k}</dt>
                  <dd className="font-medium break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Payments settlement={s} onDone={setNotice} />
        </div>
        <div className="min-w-0 space-y-6">
          {s.status === 'open' && <Clear settlement={s} onDone={setNotice} />}
          <Decisions settlement={s} onDone={setNotice} />
        </div>
      </div>
      <div className="mt-6">
        <History entity="book_settlement" entityId={s.id} />
      </div>
    </>
  );
}

/** FR-LST-07: the money, kept apart from fees; a super admin reverses a payment, never edits it. */
function Payments({
  settlement: s,
  onDone,
}: {
  settlement: Settlement;
  onDone: (t: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useMe();
  const [reversing, setReversing] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const { step, error } = useSettlementStep(() => {
    setReversing(null);
    setReason('');
    onDone(t('settlements.done.reversed'));
  });
  if (s.payments.length === 0) return null;
  return (
    <Card className="p-0">
      <h2 className="px-5 pt-5 font-semibold">{t('settlements.paymentsTitle')}</h2>
      <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-200 text-sm">
        {s.payments.map((p) => (
          <li key={p.id} className="space-y-2 px-5 py-3">
            <div className="flex flex-wrap justify-between gap-2">
              <span className={p.reversed ? 'line-through' : undefined}>
                {p.paidOn} · {rupees(p.amountCents)}
                {p.receiptNo && ` · ${t('settlements.receipt', { no: p.receiptNo })}`}
              </span>
              <span className="flex items-center gap-2 text-stone-600">
                {p.collectedByName}
                <ReceiptButton kind="settlement" paymentId={p.id} />
              </span>
            </div>
            {p.reason && <p className="text-stone-700">{p.reason}</p>}
            {user.userType === 'super_admin' &&
              p.kind === 'payment' &&
              !p.reversed &&
              (reversing === p.id ? (
                <form
                  className="space-y-2"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    step.mutate({
                      path: `/settlements/${s.id}/payments/${p.id}/reverse`,
                      body: { reason: reason.trim() },
                    });
                  }}
                >
                  <Field label={t('settlements.reverseReason')}>
                    {({ id }) => (
                      <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />
                    )}
                  </Field>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      variant="danger"
                      disabled={!reason.trim() || step.isPending}
                    >
                      {t('settlements.reverse')}
                    </Button>
                    <Button variant="ghost" onClick={() => setReversing(null)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              ) : (
                <Button
                  variant="ghost"
                  className="min-h-8 px-2 py-1 text-xs"
                  onClick={() => setReversing(p.id)}
                >
                  {t('settlements.reverse')}
                </Button>
              ))}
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

/** FR-LST-05 to FR-LST-07: a payment of the amount due, or a copy of the same book. */
function Clear({ settlement: s, onDone }: { settlement: Settlement; onDone: (t: string) => void }) {
  const { t } = useTranslation();
  const [receiptNo, setReceiptNo] = useState('');
  const [paidOn, setPaidOn] = useState(todayColombo());
  const [confirming, setConfirming] = useState(false);
  const [source, setSource] = useState('');
  const pay = useSettlementStep(() => onDone(t('settlements.done.paid')));
  const replace = useSettlementStep((r) =>
    onDone(t('settlements.done.replaced', { accession: r.replacementAccessionNo })),
  );
  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('settlements.clearTitle')}</h2>
      <p className="mb-4 text-sm text-stone-600">{t('settlements.clearLead')}</p>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          pay.step.mutate({
            path: `/settlements/${s.id}/pay`,
            body: {
              amountCents: s.amountDueCents,
              receiptNo: receiptNo.trim(),
              ...(paidOn !== todayColombo() ? { paidOn } : {}),
            },
          });
        }}
      >
        <h3 className="text-sm font-semibold">
          {t('settlements.payTitle', { amount: rupees(s.amountDueCents) })}
        </h3>
        {pay.error && <Alert tone="error">{pay.error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settlements.receiptNo')}>
            {({ id }) => (
              <Input id={id} value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
            )}
          </Field>
          <Field label={t('settlements.paidOn')} hint={t('settlements.paidOnHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="date"
                aria-describedby={describedBy}
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Button type="submit" disabled={!receiptNo.trim() || pay.step.isPending}>
          {t('settlements.pay')}
        </Button>
      </form>

      <div className="mt-6 space-y-3 border-t border-stone-200 pt-4">
        <h3 className="text-sm font-semibold">{t('settlements.replaceTitle')}</h3>
        <p className="text-sm text-stone-600">
          {t('settlements.replaceLead', { title: s.title, branch: s.copyBranch.code })}
        </p>
        {replace.error && <Alert tone="error">{replace.error}</Alert>}
        {confirming ? (
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              replace.step.mutate({
                path: `/settlements/${s.id}/replace`,
                body: source.trim() ? { source: source.trim() } : {},
              });
            }}
          >
            <Field label={t('settlements.replaceSource')} hint={t('settlements.replaceSourceHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={replace.step.isPending}>
                {t('settlements.replaceConfirm')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            {t('settlements.replaceStart')}
          </Button>
        )}
      </div>
    </Card>
  );
}

/** FR-LST-09, FR-LST-12: the super admin's decisions, each with a written reason. */
function Decisions({
  settlement: s,
  onDone,
}: {
  settlement: Settlement;
  onDone: (t: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useMe();
  const [mode, setMode] = useState<'reduce' | 'extend' | 'waive' | 'found' | null>(null);
  const [reason, setReason] = useState('');
  const [value, setValue] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const reset = () => {
    setMode(null);
    setReason('');
    setValue('');
    setLocal(null);
  };
  const { step, error } = useSettlementStep(() => {
    onDone(t(`settlements.done.${mode}`));
    reset();
  });
  const copy = useCopyFound(() => {
    onDone(t('settlements.done.found'));
    reset();
  });
  if (user.userType !== 'super_admin') return null;
  const open = s.status === 'open';
  const canFind = s.kind === 'lost' && !s.foundOn;
  if (!open && !canFind) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setLocal(null);
    const r = reason.trim();
    if (mode === 'found') return copy.found.mutate({ copyId: s.copyId, reason: r });
    if (mode === 'waive')
      return step.mutate({ path: `/settlements/${s.id}/waive`, body: { reason: r } });
    if (mode === 'reduce') {
      const cents = parseRupees(value);
      if (cents === null) return setLocal(t('settlements.badAmount'));
      return step.mutate({
        path: `/settlements/${s.id}/reduce`,
        body: { amountCents: cents, reason: r },
      });
    }
    const days = Number(value);
    if (!Number.isInteger(days) || days < 1) return setLocal(t('settlements.badDays'));
    step.mutate({ path: `/settlements/${s.id}/extend`, body: { days, reason: r } });
  }

  const choices = [
    ...(open ? (['reduce', 'waive'] as const) : []),
    ...(open && s.windowExtendedDays === null ? (['extend'] as const) : []),
    ...(canFind ? (['found'] as const) : []),
  ];
  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('settlements.decisionsTitle')}</h2>
      <p className="mb-4 text-sm text-stone-600">{t('settlements.decisionsLead')}</p>
      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <Button key={c} variant="secondary" onClick={() => setMode(c)}>
              {t(`settlements.decide.${c}`)}
            </Button>
          ))}
        </div>
      ) : (
        <form className="space-y-3" onSubmit={submit} noValidate>
          <h3 className="text-sm font-semibold">{t(`settlements.decide.${mode}`)}</h3>
          <p className="text-sm text-stone-600">{t(`settlements.decideLead.${mode}`)}</p>
          {(local ?? error ?? copy.error) && (
            <Alert tone="error">{local ?? error ?? copy.error}</Alert>
          )}
          {(mode === 'reduce' || mode === 'extend') && (
            <Field label={t(mode === 'reduce' ? 'settlements.newAmount' : 'settlements.extraDays')}>
              {({ id }) => (
                <Input
                  id={id}
                  inputMode={mode === 'reduce' ? 'decimal' : 'numeric'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field label={t('settlements.decisionReason')}>
            {({ id }) => (
              <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={mode === 'waive' ? 'danger' : 'primary'}
              disabled={
                !reason.trim() ||
                ((mode === 'reduce' || mode === 'extend') && !value.trim()) ||
                step.isPending ||
                copy.found.isPending
              }
            >
              {t(`settlements.decide.${mode}`)}
            </Button>
            <Button variant="ghost" onClick={reset}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
