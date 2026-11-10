import { type NoticeState } from '@pothgula/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { errorMessage } from '../api/errors';
import { imageForm, ImageUploadButton } from '../components/images';
import { imageUrl, useBranches } from '../api/queries';
import { useManagedNotices, useNotice, useNoticeChange } from '../api/schedule';
import { useMe } from '../auth/auth';
import { HoursCard } from '../components/hours';
import { History } from '../components/log';
import { EventWhen, NoticeBody, NoticeBoardView, NoticeForm } from '../components/notices';
import { Alert, Button, Card, Field, PageTitle, Select } from '../components/ui';

/**
 * FR-SCH-03, FR-PUB-04: a branch's opening hours, events and notices — the
 * person's own branch first, any other on request. Applicants see them too.
 */
export function NoticesPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const staff = user.userType !== 'member';
  const [params, setParams] = useSearchParams();
  const branches = useBranches();
  const chosen = Number(params.get('branch')) || user.branchId || branches.data?.[0]?.id || null;

  return (
    <>
      <PageTitle lead={t('notices.lead')}>{t('notices.title')}</PageTitle>
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="w-full max-w-xs">
          <Field label={t('notices.branch')}>
            {({ id }) => (
              <Select
                id={id}
                value={chosen ?? ''}
                onChange={(e) => setParams(e.target.value ? { branch: e.target.value } : {})}
              >
                {(branches.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {staff && (
          <Link
            to="/notices/manage"
            className="inline-flex min-h-10 items-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50"
          >
            {t('notices.manage')}
          </Link>
        )}
      </div>
      {chosen !== null && (
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <div className="min-w-0">
            <HoursCard branchId={chosen} />
          </div>
          <div className="min-w-0">
            <NoticeBoardView branchId={chosen} />
          </div>
        </div>
      )}
    </>
  );
}

const STATE_TONE: Record<NoticeState, string> = {
  shown: 'bg-emerald-50 text-emerald-900',
  scheduled: 'bg-sky-50 text-sky-950',
  ended: 'bg-stone-100 text-stone-700',
  withdrawn: 'bg-stone-200 text-stone-700 line-through',
};

function StateBadge({ state }: { state: NoticeState }) {
  const { t } = useTranslation();
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATE_TONE[state]}`}
    >
      {t(`notices.state.${state}`)}
    </span>
  );
}

/** One notice or event in full; staff of its branch manage it from here (FR-PUB-06). */
export function NoticePage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const id = Number(useParams().id);
  const notice = useNotice(id);
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const change = useNoticeChange((n) =>
    setMessage(t(n.withdrawnAt ? 'notices.withdrawn' : 'notices.saved')),
  );
  const opened = notice.data?.opened;
  // Opening an important one takes it off the member's panel (FR-PUB-07).
  useEffect(() => {
    if (opened) void client.invalidateQueries({ queryKey: ['loans', 'me-dashboard'] });
  }, [opened, client]);

  if (notice.isError) return <Alert tone="error">{errorMessage(t, notice.error)}</Alert>;
  if (!notice.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  const n = notice.data;
  const mayEdit =
    user.userType === 'super_admin' ||
    (user.userType === 'admin' && n.branch?.id === user.branchId);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/notices" className="text-emerald-800 underline">
          ← {t('notices.title')}
        </Link>
      </p>
      <PageTitle>
        {n.title} {user.userType !== 'member' && <StateBadge state={n.state} />}
      </PageTitle>
      {message && (
        <div className="mb-5">
          <Alert tone="success">{message}</Alert>
        </div>
      )}
      {change.error && (
        <div className="mb-5">
          <Alert tone="error">{errorMessage(t, change.error)}</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="min-w-0 space-y-3">
          {n.imageId && (
            <img
              src={imageUrl(n.imageId)}
              alt=""
              className="max-h-96 w-full rounded-md object-contain"
            />
          )}
          <EventWhen notice={n} />
          <NoticeBody text={n.body} />
          <p className="text-xs text-stone-500">
            {n.branch ? n.branch.name : t('notices.everyBranch')} ·{' '}
            {t('notices.byOn', { name: n.createdByName, date: n.createdAt.slice(0, 10) })}
          </p>
        </Card>
        {mayEdit && (
          <Card className="space-y-4">
            <h2 className="font-semibold">{t('notices.manageOne')}</h2>
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/notices/${n.id}/edit`}
                className="inline-flex min-h-10 items-center rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white"
              >
                {t('notices.edit')}
              </Link>
              <Button
                variant={n.withdrawnAt ? 'secondary' : 'danger'}
                disabled={change.isPending}
                onClick={() =>
                  change.mutate({ kind: n.withdrawnAt ? 'restore' : 'withdraw', id: n.id })
                }
              >
                {n.withdrawnAt ? t('notices.restore') : t('notices.withdraw')}
              </Button>
            </div>
            <ImageUploadButton
              label={n.imageId ? t('notices.replaceImage') : t('notices.addImage')}
              onUpload={async (file) => {
                await change.mutateAsync({ kind: 'image', id: n.id, form: imageForm(file) });
              }}
            />
            {n.imageId && (
              <Button
                variant="ghost"
                disabled={change.isPending}
                onClick={() => change.mutate({ kind: 'removeImage', id: n.id })}
              >
                {t('notices.removeImage')}
              </Button>
            )}
          </Card>
        )}
      </div>
      {user.userType !== 'member' && (
        <div className="mt-6">
          <History entity="notice" entityId={n.id} />
        </div>
      )}
    </>
  );
}

/** FR-PUB-06: every notice the member of staff can see, whatever its state. */
export function ManageNoticesPage() {
  const { t } = useTranslation();
  const list = useManagedNotices(null);
  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/notices" className="text-emerald-800 underline">
          ← {t('notices.title')}
        </Link>
      </p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle lead={t('notices.manageLead')}>{t('notices.manage')}</PageTitle>
        <Link
          to="/notices/new"
          className="inline-flex min-h-10 items-center rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white"
        >
          {t('notices.new')}
        </Link>
      </div>
      {list.isError && <Alert tone="error">{errorMessage(t, list.error)}</Alert>}
      {list.data && (
        <Card className="p-0">
          {list.data.length === 0 ? (
            <p className="p-5 text-stone-600">{t('notices.none')}</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {list.data.map((n) => (
                <li
                  key={n.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/notices/${n.id}`}
                      className="font-medium text-emerald-900 underline"
                    >
                      {n.title}
                    </Link>
                    <p className="text-stone-600">
                      {t(`notices.kind.${n.kind}`)} ·{' '}
                      {n.branch ? n.branch.code : t('notices.everyBranch')} ·{' '}
                      {n.kind === 'event' ? n.eventDate : n.createdAt.slice(0, 10)}
                    </p>
                  </div>
                  <StateBadge state={n.state} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}

/** FR-PUB-01: writing a new one, or editing one (`/notices/:id/edit`). */
export function NoticeEditPage() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const editing = Number.isInteger(id) && id > 0;
  const notice = useNotice(editing ? id : 0);
  const navigate = useNavigate();
  if (editing && notice.isError) return <Alert tone="error">{errorMessage(t, notice.error)}</Alert>;
  if (editing && !notice.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/notices/manage" className="text-emerald-800 underline">
          ← {t('notices.manage')}
        </Link>
      </p>
      <PageTitle lead={editing ? undefined : t('notices.newLead')}>
        {editing ? t('notices.edit') : t('notices.new')}
      </PageTitle>
      <Card className="max-w-3xl">
        <NoticeForm
          notice={editing ? notice.data! : null}
          onDone={(n) => void navigate(`/notices/${n.id}`)}
        />
      </Card>
    </>
  );
}
