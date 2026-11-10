import {
  formatRupees,
  type Loan,
  type LossKind,
  parseRupees,
  type Settlement,
} from '@pothgula/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  useLostQuote,
  useMemberSettlements,
  useOwnSettlements,
  useSettlementStep,
} from '../api/settlements';
import { Alert, Button, Card, Field, Input, Select } from './ui';

export const rupees = (cents: number) => `Rs.\u00a0${formatRupees(cents)}`;

export function SettlementStatus({ settlement: s }: { settlement: Settlement }) {
  const { t } = useTranslation();
  const [key, tone] = s.windowPassed
    ? ['passed', 'bg-red-50 text-red-900']
    : s.status === 'open'
      ? ['open', 'bg-amber-50 text-amber-950']
      : s.status === 'found'
        ? ['found', 'bg-sky-50 text-sky-950']
        : s.status === 'waived'
          ? ['waived', 'bg-stone-100 text-stone-700']
          : [s.status, 'bg-emerald-50 text-emerald-900'];
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tone}`}>
      {t(`settlements.status.${key}`)}
    </span>
  );
}

/** "Rs. 1,500.00 · 12 days left" — or how and when it was cleared. */
export function SettlementLine({ settlement: s }: { settlement: Settlement }) {
  const { t } = useTranslation();
  if (s.status !== 'open') {
    return (
      <span>
        {t(`settlements.cleared.${s.status}`, { date: s.settledOn, count: s.daysToSettle ?? 0 })}
      </span>
    );
  }
  return (
    <span className={s.daysLeft < 0 ? 'font-medium text-red-800' : undefined}>
      {rupees(s.amountDueCents)} ·{' '}
      {s.daysLeft < 0
        ? t('settlements.passedSince', { date: s.windowEnds, count: -s.daysLeft })
        : t('settlements.daysLeft', { count: s.daysLeft, date: s.windowEnds })}
    </span>
  );
}

/**
 * FR-NOT-11, FR-LST-03: what staff see at the top of a member's record — each
 * open settlement with the amount and the days left, and what it means.
 */
export function SettlementBanner({ memberId }: { memberId: number }) {
  const { t } = useTranslation();
  const list = useMemberSettlements(memberId);
  const open = (list.data ?? []).filter((s) => s.status === 'open');
  if (open.length === 0) return null;
  const passed = open.some((s) => s.windowPassed);
  return (
    <Alert
      tone={passed ? 'error' : 'warning'}
      title={t('settlements.bannerTitle', { count: open.length })}
    >
      <ul className="space-y-1">
        {open.map((s) => (
          <li key={s.id}>
            <Link to={`/lost-books/${s.id}`} className="font-medium underline">
              {s.title} ({s.accessionNo})
            </Link>{' '}
            — <SettlementLine settlement={s} />
          </li>
        ))}
      </ul>
      <p className="mt-2">{passed ? t('settlements.bannerPassed') : t('settlements.bannerOpen')}</p>
    </Alert>
  );
}

/** FR-LST-13: every settlement, open and cleared, with how and how long. */
function SettlementList({ list, staff }: { list: Settlement[]; staff: boolean }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-200">
      {list.map((s) => (
        <li
          key={s.id}
          className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm"
        >
          <div className="min-w-0">
            <p className="font-medium">
              {staff ? (
                <Link to={`/lost-books/${s.id}`} className="text-emerald-900 underline">
                  {s.title}
                </Link>
              ) : (
                s.title
              )}{' '}
              <span className="font-mono text-xs text-stone-600">{s.accessionNo}</span>
            </p>
            <p className="text-stone-600">
              {t(`settlements.kind.${s.kind}`)} ·{' '}
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
  );
}

export function MemberSettlements({ memberId }: { memberId: number }) {
  const { t } = useTranslation();
  const list = useMemberSettlements(memberId);
  if (!list.data || list.data.length === 0) return null;
  return (
    <Card className="p-0">
      <h2 className="px-5 pt-5 font-semibold">{t('settlements.historyTitle')}</h2>
      <SettlementList list={list.data} staff />
    </Card>
  );
}

/** FR-LST-03, FR-LST-13: the member's own, with what to do about an open one. */
export function OwnSettlements() {
  const { t } = useTranslation();
  const list = useOwnSettlements(true);
  if (!list.data || list.data.length === 0) return null;
  const open = list.data.some((s) => s.status === 'open');
  return (
    <Card className="mb-6 p-0">
      <h2 className="px-5 pt-5 font-semibold">{t('settlements.mineTitle')}</h2>
      {open && <p className="px-5 pt-2 text-sm text-stone-700">{t('settlements.mineLead')}</p>}
      <SettlementList list={list.data} staff={false} />
    </Card>
  );
}

/**
 * FR-LST-01, FR-LST-02, FR-LST-11: declare the copy on an open loan lost or
 * ruined. The amount comes from the owning branch's tariff; changing it, or
 * entering one where the tariff has none, is the declarer's to do with a reason.
 */
export function DeclareLost({ loan, onDone }: { loan: Loan; onDone: (s: Settlement) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LossKind>('lost');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [amountReason, setAmountReason] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const quote = useLostQuote(loan.id, open);
  const { step, error } = useSettlementStep(onDone);
  const tariff = quote.data?.tariffCents ?? null;
  const typed = amount.trim() ? parseRupees(amount) : null;
  const differs = typed !== null && tariff !== null && typed !== tariff;

  function submit(e: FormEvent) {
    e.preventDefault();
    setLocal(null);
    if (amount.trim() && typed === null) return setLocal(t('settlements.badAmount'));
    if (tariff === null && typed === null) return setLocal(t('errors.amount_required'));
    step.mutate({
      path: `/loans/${loan.id}/lost`,
      body: {
        kind,
        reason: reason.trim(),
        ...(typed !== null ? { amountCents: typed } : {}),
        ...(amountReason.trim() ? { amountReason: amountReason.trim() } : {}),
      },
    });
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold" id="lost">
        {t('settlements.declareTitle')}
      </h2>
      <p className="mb-4 text-sm text-stone-600">{t('settlements.declareLead')}</p>
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t('settlements.declareStart')}
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {(local ?? error) && <Alert tone="error">{local ?? error}</Alert>}
          {quote.data && (
            <p className="text-sm text-stone-700">
              {tariff !== null
                ? t('settlements.quote', {
                    amount: rupees(tariff),
                    branch: quote.data.copyBranch.code,
                    category: quote.data.categoryCode,
                  })
                : t('settlements.quoteNone', {
                    branch: quote.data.copyBranch.code,
                    category: quote.data.categoryCode,
                  })}{' '}
              {t('settlements.quoteWindow', {
                count: quote.data.windowDays,
                date: quote.data.windowEnds,
              })}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settlements.kindLabel')}>
              {({ id }) => (
                <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as LossKind)}>
                  <option value="lost">{t('settlements.kind.lost')}</option>
                  <option value="damaged">{t('settlements.kind.damaged')}</option>
                </Select>
              )}
            </Field>
            <Field
              label={t('settlements.amountLabel')}
              hint={tariff !== null ? t('settlements.amountHint') : undefined}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  aria-describedby={describedBy}
                  placeholder={tariff !== null ? formatRupees(tariff) : ''}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label={t('settlements.reasonLabel')} hint={t('settlements.reasonHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
          {(differs || (tariff === null && typed !== null)) && (
            <Field
              label={t('settlements.amountReasonLabel')}
              hint={differs ? t('settlements.amountReasonNeeded') : undefined}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={amountReason}
                  onChange={(e) => setAmountReason(e.target.value)}
                />
              )}
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="danger"
              disabled={!reason.trim() || (differs && !amountReason.trim()) || step.isPending}
            >
              {t('settlements.declareConfirm')}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
