import { type BranchHours, type DayHours, todayColombo, WEEKDAYS } from '@pothgula/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors';
import { useHours, useHoursChange } from '../api/schedule';
import { Alert, Button, Card, Field, Input } from './ui';

/** "9.00 am" / "5.30 pm" in English; the language's own way elsewhere. */
export function useTimeFormat() {
  const { i18n } = useTranslation();
  return (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const text = new Intl.DateTimeFormat(i18n.language === 'si' ? 'si-LK' : 'en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
    return i18n.language === 'si' ? text : text.replace(':', '.').toLowerCase();
  };
}

/** FR-SCH-04: open until …, opens at …, or closed today and why. */
export function TodayStatus({ hours }: { hours: BranchHours }) {
  const { t } = useTranslation();
  const time = useTimeFormat();
  const s = hours.status;
  switch (s.kind) {
    case 'unknown':
      return <p className="text-stone-600">{t('hours.unknown')}</p>;
    case 'open':
      return (
        <p className="font-medium text-emerald-900">
          {t('hours.openUntil', { time: time(s.until) })}
        </p>
      );
    case 'opens_later':
      return <p className="font-medium">{t('hours.opensAt', { time: time(s.at) })}</p>;
    case 'closed':
      return (
        <p className="font-medium text-red-900">
          {s.reason ? t('hours.closedBecause', { reason: s.reason }) : t('hours.closedToday')}
          {s.next && (
            <span className="block font-normal text-stone-700">
              {t('hours.nextOpen', { date: s.next.date, time: time(s.next.at) })}
            </span>
          )}
        </p>
      );
  }
}

/** FR-SCH-01, FR-SCH-03: a branch's week and coming closures, for anyone signed in. */
export function HoursCard({ branchId, title }: { branchId: number; title?: string }) {
  const { t } = useTranslation();
  const time = useTimeFormat();
  const hours = useHours(branchId);
  if (hours.isError) return <Alert tone="error">{errorMessage(t, hours.error)}</Alert>;
  if (!hours.data) return null;
  const h = hours.data;
  return (
    <Card>
      <h2 className="mb-2 font-semibold">{title ?? t('hours.title', { branch: h.branch.name })}</h2>
      <TodayStatus hours={h} />
      {h.configured && (
        <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
          {h.week.map((d) => (
            <div key={d.weekday} className="contents">
              <dt className="text-stone-600">{t(`hours.days.${d.weekday}`)}</dt>
              <dd className="tabular-nums">
                {d.open && d.close ? `${time(d.open)} – ${time(d.close)}` : t('hours.closed')}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {h.closures.length > 0 && (
        <>
          <h3 className="mt-4 mb-1 text-sm font-semibold">{t('hours.closures')}</h3>
          <ul className="space-y-1 text-sm">
            {h.closures.map((c) => (
              <li key={c.id}>
                <span className="tabular-nums">{c.date}</span> — {c.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** FR-SCH-01, FR-SCH-02, FR-SCH-05: the branch's own staff set the week and closures. */
export function HoursEditor({ hours }: { hours: BranchHours }) {
  const { t } = useTranslation();
  const change = useHoursChange(hours.branch.id);
  const [week, setWeek] = useState<DayHours[]>(() =>
    WEEKDAYS.map(
      (weekday) =>
        hours.week.find((d) => d.weekday === weekday) ?? { weekday, open: null, close: null },
    ),
  );
  const [from, setFrom] = useState(todayColombo());
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const error = change.error ? errorMessage(t, change.error) : null;
  const set = (weekday: number, patch: Partial<DayHours>) =>
    setWeek((w) => w.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));

  function saveWeek(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    change.mutate(
      { kind: 'week', body: { week } },
      { onSuccess: () => setNotice(t('hours.saved')) },
    );
  }

  function close(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    change.mutate(
      {
        kind: 'close',
        body: { from, ...(to && to !== from ? { to } : {}), reason: reason.trim() },
      },
      {
        onSuccess: () => {
          setReason('');
          setTo('');
          setNotice(t('hours.closureAdded'));
        },
      },
    );
  }

  return (
    <Card className="mt-6">
      <h2 className="mb-1 font-semibold">{t('hours.editTitle')}</h2>
      <p className="mb-4 text-sm text-stone-600">{t('hours.editLead')}</p>
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <div className="grid gap-8 lg:grid-cols-2">
        <form onSubmit={saveWeek} className="space-y-3" noValidate>
          <h3 className="text-sm font-semibold">{t('hours.weekly')}</h3>
          {week.map((d) => {
            const open = d.open !== null;
            return (
              <fieldset key={d.weekday} className="flex flex-wrap items-center gap-3 text-sm">
                <legend className="sr-only">{t(`hours.days.${d.weekday}`)}</legend>
                <label className="flex w-28 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={open}
                    onChange={(e) =>
                      set(
                        d.weekday,
                        e.target.checked
                          ? { open: '09:00', close: '17:00' }
                          : { open: null, close: null },
                      )
                    }
                  />
                  {t(`hours.days.${d.weekday}`)}
                </label>
                {open ? (
                  <>
                    <Input
                      type="time"
                      className="w-32"
                      aria-label={t('hours.opens', { day: t(`hours.days.${d.weekday}`) })}
                      value={d.open ?? ''}
                      onChange={(e) => set(d.weekday, { open: e.target.value })}
                    />
                    <span>–</span>
                    <Input
                      type="time"
                      className="w-32"
                      aria-label={t('hours.closes', { day: t(`hours.days.${d.weekday}`) })}
                      value={d.close ?? ''}
                      onChange={(e) => set(d.weekday, { close: e.target.value })}
                    />
                  </>
                ) : (
                  <span className="text-stone-600">{t('hours.closed')}</span>
                )}
              </fieldset>
            );
          })}
          <Button type="submit" disabled={change.isPending}>
            {t('hours.saveWeek')}
          </Button>
        </form>

        <div className="space-y-4">
          <form onSubmit={close} className="space-y-3" noValidate>
            <h3 className="text-sm font-semibold">{t('hours.addClosure')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('hours.from')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('hours.to')} hint={t('hours.toHint')}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    type="date"
                    aria-describedby={describedBy}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label={t('hours.reason')} hint={t('hours.reasonHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" variant="secondary" disabled={!reason.trim() || change.isPending}>
              {t('hours.close')}
            </Button>
          </form>
          {hours.closures.length > 0 && (
            <ul className="divide-y divide-stone-100 rounded-md border border-stone-200 text-sm">
              {hours.closures.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <span>
                    <span className="tabular-nums">{c.date}</span> — {c.reason}
                  </span>
                  <Button
                    variant="ghost"
                    className="min-h-8 px-2 py-1 text-xs"
                    disabled={change.isPending}
                    onClick={() => change.mutate({ kind: 'reopen', closureId: c.id })}
                  >
                    {t('hours.reopen')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
