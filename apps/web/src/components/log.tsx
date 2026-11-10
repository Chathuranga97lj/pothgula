import {
  describeChange,
  LIBRARY_TIME_ZONE,
  type LogEntryView,
  type LogFilter,
} from '@pothgula/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { errorMessage } from '../api/errors';
import { logQuery, useLog } from '../api/log';
import { Alert, Button, Card } from './ui';

const WHEN = new Intl.DateTimeFormat('en-CA', {
  timeZone: LIBRARY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "2026-11-10 14:05", Sri Lanka time, whatever the browser's own zone. */
export function logWhen(iso: string): string {
  const parts = WHEN.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** A new record lists every field; the first few are enough until asked. */
const FIELDS_SHOWN = 4;

/** Where a record named in the log can be opened, if it has a page of its own. */
const RECORD_PAGE: Record<string, (id: string) => string> = {
  title: (id) => `/titles/${id}`,
  borrow: (id) => `/loans/${id}`,
  branch: (id) => `/branches/${id}`,
};

export function useLogLabels() {
  const { t } = useTranslation();
  return {
    action: (action: string) => t(`logActions.${action}`, { defaultValue: action }),
    entity: (entity: string) => t(`log.entities.${entity}`, { defaultValue: entity }),
    who: (e: LogEntryView) =>
      e.actorRole === 'system'
        ? t('log.system')
        : `${e.actorName ?? '—'} · ${t(`roles.${e.actorRole}`)}`,
  };
}

/**
 * One entry: when, who and where; what was done to which record; and what it
 * changed, field by field. On the log screen, the person and the record are
 * buttons that narrow the filter to them.
 */
export function LogEntryItem({
  entry: e,
  onPerson,
  onRecord,
}: {
  entry: LogEntryView;
  onPerson?: (actorId: number) => void;
  onRecord?: (entity: string, entityId: string) => void;
}) {
  const { t } = useTranslation();
  const label = useLogLabels();
  const changes = describeChange(e.before, e.after);
  const [allShown, setAllShown] = useState(false);
  const record = `${label.entity(e.entity)}${e.entityId ? ` #${e.entityId}` : ''}`;
  const page = e.entityId ? RECORD_PAGE[e.entity]?.(e.entityId) : undefined;
  const link =
    'text-left underline decoration-stone-300 underline-offset-2 hover:decoration-current';

  return (
    <li className="px-5 py-3 text-sm" data-testid="log-entry">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-stone-600">
        <time dateTime={e.at} className="tabular-nums">
          {logWhen(e.at)}
        </time>
        {onPerson && e.actorId !== null ? (
          <button
            type="button"
            className={link}
            title={t('log.onlyThisPerson')}
            onClick={() => onPerson(e.actorId!)}
          >
            {label.who(e)}
          </button>
        ) : (
          <span>{label.who(e)}</span>
        )}
        {e.branchCode && <span className="font-mono text-xs">{e.branchCode}</span>}
        {e.ipAddress && <span className="text-xs break-all">{e.ipAddress}</span>}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-stone-900">{label.action(e.action)}</span>
        <span className="text-stone-500">·</span>
        {onRecord && e.entityId ? (
          <button
            type="button"
            className={link}
            title={t('log.onlyThisRecord')}
            onClick={() => onRecord(e.entity, e.entityId!)}
          >
            {record}
          </button>
        ) : (
          <span>{record}</span>
        )}
        {page && (
          <Link to={page} className="text-xs text-emerald-800 underline">
            {t('log.open')}
          </Link>
        )}
      </div>
      {changes.length > 0 && (
        <ul className="mt-1 space-y-0.5 font-mono text-xs [overflow-wrap:anywhere] text-stone-700">
          {(allShown ? changes : changes.slice(0, FIELDS_SHOWN)).map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      {!allShown && changes.length > FIELDS_SHOWN && (
        <button
          type="button"
          className="mt-1 text-xs text-emerald-800 underline"
          onClick={() => setAllShown(true)}
        >
          {t('log.moreFields', { count: changes.length - FIELDS_SHOWN })}
        </button>
      )}
      {e.redactedAt && (
        <p className="mt-1 text-xs text-stone-600">
          {t('log.redacted', { date: e.redactedAt.slice(0, 10) })}
        </p>
      )}
    </li>
  );
}

/** The entries of one log query, a page at a time. */
export function LogList({
  log,
  onPerson,
  onRecord,
}: {
  log: ReturnType<typeof useLog>;
  onPerson?: (actorId: number) => void;
  onRecord?: (entity: string, entityId: string) => void;
}) {
  const { t } = useTranslation();
  if (log.isError) {
    return (
      <div className="p-5">
        <Alert tone="error">{errorMessage(t, log.error)}</Alert>
      </div>
    );
  }
  if (!log.data) return <p className="p-5 text-stone-600">{t('common.loading')}</p>;
  const entries = log.data.pages.flatMap((p) => p.entries);
  if (entries.length === 0) return <p className="p-5 text-stone-600">{t('log.none')}</p>;
  return (
    <>
      <ul className="divide-y divide-stone-100 border-t border-stone-200">
        {entries.map((e) => (
          <LogEntryItem key={e.id} entry={e} onPerson={onPerson} onRecord={onRecord} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-5 py-3 text-sm text-stone-600">
        <span>{t('log.shown', { count: entries.length })}</span>
        {log.hasNextPage && (
          <Button
            variant="secondary"
            disabled={log.isFetchingNextPage}
            onClick={() => void log.fetchNextPage()}
          >
            {t('log.older')}
          </Button>
        )}
      </div>
    </>
  );
}

/**
 * FR-LOG-09: a record's own entries, newest first. Opening it is a read of
 * the log and is itself recorded (FR-LOG-10), so it opens only when asked.
 */
export function History({
  entity,
  entityId,
  open: openAtFirst = false,
}: {
  entity: NonNullable<LogFilter['entity']>;
  entityId: number | string;
  open?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(openAtFirst);
  const filter: LogFilter = { entity, entityId: String(entityId) };
  const log = useLog(open ? filter : null, 20);

  return (
    <Card className="min-w-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="font-semibold">{t('log.history')}</h2>
        {open ? (
          <Link to={`/log${logQuery(filter)}`} className="text-sm text-emerald-800 underline">
            {t('log.openInLog')}
          </Link>
        ) : (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {t('log.showHistory')}
          </Button>
        )}
      </div>
      {!open && <p className="px-5 pb-4 text-xs text-stone-600">{t('log.historyNote')}</p>}
      {open && <LogList log={log} />}
    </Card>
  );
}
