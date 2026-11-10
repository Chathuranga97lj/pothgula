import type { Notice, NoticeInput } from '@pothgula/shared';
import { type FormEvent, Fragment, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { errorMessage } from '../api/errors';
import { imageUrl, useBranches } from '../api/queries';
import { useNoticeBoard, useNoticeChange } from '../api/schedule';
import { useMe } from '../auth/auth';
import { useTimeFormat } from './hours';
import { Alert, Button, Card, Field, Input, Select } from './ui';

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

/** FR-PUB-01: the paragraph, with any web address in it shown as a link that opens elsewhere. */
export function NoticeBody({ text }: { text: string }) {
  return (
    <p className="text-sm whitespace-pre-line break-words">
      {text.split(URL_RE).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

/** When an event happens: its date, time and place. */
export function EventWhen({ notice: n }: { notice: Notice }) {
  const { t } = useTranslation();
  const time = useTimeFormat();
  if (n.kind !== 'event' || !n.eventDate || !n.startTime) return null;
  return (
    <p className={`text-sm font-medium ${n.past ? 'text-stone-500' : 'text-emerald-900'}`}>
      {n.eventDate} · {time(n.startTime)}
      {n.endTime && ` – ${time(n.endTime)}`}
      {n.venue && ` · ${n.venue}`}
      {n.past && ` · ${t('notices.past')}`}
    </p>
  );
}

function NoticeItem({ notice: n }: { notice: Notice }) {
  const { t } = useTranslation();
  return (
    <li className="flex gap-4 px-5 py-4">
      {n.imageId && (
        <img
          src={imageUrl(n.imageId, 'thumb')}
          alt=""
          className="h-20 w-28 shrink-0 rounded-md object-cover"
        />
      )}
      <div className="min-w-0 space-y-1">
        <p>
          <Link to={`/notices/${n.id}`} className="font-medium text-emerald-900 underline">
            {n.title}
          </Link>
          {n.isImportant && (
            <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-950">
              {t('notices.important')}
            </span>
          )}
        </p>
        <EventWhen notice={n} />
        <p className="line-clamp-2 text-sm text-stone-700">{n.body}</p>
        <p className="text-xs text-stone-500">
          {n.branch ? n.branch.name : t('notices.everyBranch')}
        </p>
      </div>
    </li>
  );
}

function Section({ title, list }: { title: string; list: Notice[] }) {
  const { t } = useTranslation();
  return (
    <Card className="p-0">
      <h2 className="px-5 pt-5 font-semibold">{title}</h2>
      {list.length === 0 ? (
        <p className="px-5 py-4 text-sm text-stone-600">{t('notices.none')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-200">
          {list.map((n) => (
            <NoticeItem key={n.id} notice={n} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** FR-PUB-04: a branch's events (soonest first) and notices (newest first). */
export function NoticeBoardView({ branchId }: { branchId: number | null }) {
  const { t } = useTranslation();
  const board = useNoticeBoard(branchId);
  if (board.isError) return <Alert tone="error">{errorMessage(t, board.error)}</Alert>;
  if (!board.data) return null;
  return (
    <div className="space-y-6">
      <Section title={t('notices.events')} list={board.data.events} />
      <Section title={t('notices.notices')} list={board.data.notices} />
    </div>
  );
}

const empty = (branchId: number | null): NoticeInput => ({
  kind: 'notice',
  branchId,
  title: '',
  body: '',
  eventDate: null,
  startTime: null,
  endTime: null,
  venue: null,
  showFrom: null,
  showUntil: null,
  isImportant: false,
});

/** FR-PUB-01 to FR-PUB-03, FR-PUB-07: writing or editing one. */
export function NoticeForm({
  notice,
  onDone,
}: {
  notice: Notice | null;
  onDone: (n: Notice) => void;
}) {
  const { t } = useTranslation();
  const { user } = useMe();
  const isSuper = user.userType === 'super_admin';
  const branches = useBranches(isSuper);
  const [v, setV] = useState<NoticeInput>(() =>
    notice
      ? {
          kind: notice.kind,
          branchId: notice.branch?.id ?? null,
          title: notice.title,
          body: notice.body,
          eventDate: notice.eventDate,
          startTime: notice.startTime,
          endTime: notice.endTime,
          venue: notice.venue,
          showFrom: notice.showFrom,
          showUntil: notice.showUntil,
          isImportant: notice.isImportant,
        }
      : empty(isSuper ? null : user.branchId),
  );
  const save = useNoticeChange(onDone);
  const set = (patch: Partial<NoticeInput>) => setV((x) => ({ ...x, ...patch }));
  const event = v.kind === 'event';
  const text = (key: keyof NoticeInput) => (v[key] as string | null | undefined) ?? '';

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(notice ? { kind: 'update', id: notice.id, body: v } : { kind: 'create', body: v });
  }

  const field = (key: keyof NoticeInput, label: string, type: string, hint?: ReactNode) => (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) => (
        <Input
          id={id}
          type={type}
          aria-describedby={describedBy}
          value={text(key)}
          onChange={(e) => set({ [key]: e.target.value || null })}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {save.error && <Alert tone="error">{errorMessage(t, save.error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('notices.kindLabel')}>
          {({ id }) => (
            <Select
              id={id}
              value={v.kind}
              onChange={(e) => set({ kind: e.target.value as NoticeInput['kind'] })}
            >
              <option value="notice">{t('notices.kind.notice')}</option>
              <option value="event">{t('notices.kind.event')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('notices.forBranch')}>
          {({ id }) =>
            isSuper ? (
              <Select
                id={id}
                value={v.branchId ?? ''}
                onChange={(e) => set({ branchId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">{t('notices.everyBranch')}</option>
                {(branches.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={id} value={t('notices.ownBranch')} disabled />
            )
          }
        </Field>
      </div>
      <Field label={t('notices.titleLabel')}>
        {({ id }) => (
          <Input id={id} value={v.title} onChange={(e) => set({ title: e.target.value })} />
        )}
      </Field>
      <Field label={t('notices.bodyLabel')} hint={t('notices.bodyHint')}>
        {({ id, describedBy }) => (
          <textarea
            id={id}
            aria-describedby={describedBy}
            rows={6}
            className="block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base"
            value={v.body}
            onChange={(e) => set({ body: e.target.value })}
          />
        )}
      </Field>
      {event && (
        <div className="grid gap-4 sm:grid-cols-2">
          {field('eventDate', t('notices.eventDate'), 'date')}
          {field('venue', t('notices.venue'), 'text')}
          {field('startTime', t('notices.startTime'), 'time')}
          {field('endTime', t('notices.endTime'), 'time')}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('showFrom', t('notices.showFrom'), 'date', t('notices.showFromHint'))}
        {field('showUntil', t('notices.showUntil'), 'date', t('notices.showUntilHint'))}
      </div>
      <label className="flex gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={v.isImportant ?? false}
          onChange={(e) => set({ isImportant: e.target.checked })}
        />
        <span>{t('notices.importantHint')}</span>
      </label>
      <Button type="submit" disabled={!v.title.trim() || !v.body.trim() || save.isPending}>
        {notice ? t('notices.save') : t('notices.publish')}
      </Button>
    </form>
  );
}
