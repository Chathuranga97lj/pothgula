import {
  type Copy,
  createdCopiesResponseSchema,
  formatRupees,
  parseRupees,
  type TitleDetail,
  titleDetailSchema,
  updateTitleRequestSchema,
} from '@pothgula/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { CATALOGUE_KEY, titleKey, useCatalogue, useDebounced, useTitle } from '../api/catalogue';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { useCopyFound } from '../api/settlements';
import { useBranches, useCategories } from '../api/queries';
import { useMe } from '../auth/auth';
import { History } from '../components/log';
import { AskAnotherBranch } from '../components/requests';
import { Alert, Button, Card, Field, Input, PageTitle, Select } from '../components/ui';

/** FR-CAT-01, FR-CAT-03, FR-CAT-04, FR-CAT-08, FR-CAT-11, FR-CAT-14, FR-CAT-18. */
export function TitlePage() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const { user } = useMe();
  const isStaff = user.userType !== 'member';
  const title = useTitle(id);
  const [notice, setNotice] = useState<string | null>(null);

  if (title.isError) return <Alert tone="error">{errorMessage(t, title.error)}</Alert>;
  if (!title.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  const d = title.data;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/catalogue" className="text-emerald-800 underline">
          ← {t('catalogue.title')}
        </Link>
      </p>
      <PageTitle lead={[d.writer, d.publisher, d.edition].filter(Boolean).join(' · ')}>
        {d.title}
      </PageTitle>
      {d.mergedIntoId && (
        <div className="mb-5">
          <Alert tone="info">
            {t('titles.mergedInto')}{' '}
            <Link className="underline" to={`/titles/${d.mergedIntoId}`}>
              {t('titles.openThatTitle')}
            </Link>
          </Alert>
        </div>
      )}
      {notice && (
        <div className="mb-5">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0 space-y-6">
          {isStaff ? <EditTitle title={d} /> : <Facts title={d} />}
          <Copies title={d} />
          {user.userType === 'member' && user.status === 'active' && <AskAnotherBranch title={d} />}
          {isStaff && <History entity="title" entityId={d.id} />}
        </div>
        {isStaff && !d.mergedIntoId && (
          <div className="min-w-0 space-y-6">
            <AddCopies
              title={d}
              onAdded={(numbers) =>
                setNotice(t('titles.addedCopies', { numbers: numbers.join(', ') }))
              }
            />
            {user.userType === 'super_admin' && <Merge title={d} />}
          </div>
        )}
      </div>
    </>
  );
}

function Facts({ title: d }: { title: TitleDetail }) {
  const { t } = useTranslation();
  return (
    <Card>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-stone-600">{t('titles.category')}</dt>
        <dd>{d.categoryName}</dd>
        <dt className="text-stone-600">ISBN</dt>
        <dd className="tabular-nums">{d.isbn ?? '—'}</dd>
      </dl>
    </Card>
  );
}

function useSaved(id: number) {
  const queryClient = useQueryClient();
  return async (detail: TitleDetail) => {
    queryClient.setQueryData(titleKey(id), detail);
    await queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY });
  };
}

function EditTitle({ title: d }: { title: TitleDetail }) {
  const { t } = useTranslation();
  const categories = useCategories();
  const saved = useSaved(d.id);
  const initial = {
    title: d.title,
    writer: d.writer ?? '',
    publisher: d.publisher ?? '',
    isbn: d.isbn ?? '',
    edition: d.edition ?? '',
    categoryCode: d.categoryCode,
  };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const save = useMutation({
    mutationFn: (body: unknown) =>
      api(`/titles/${d.id}`, { method: 'PATCH', body, schema: titleDetailSchema }),
    onSuccess: async (detail) => {
      setDone(true);
      await saved(detail);
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  const changed = Object.fromEntries(
    Object.entries(form).filter(([k, v]) => v !== initial[k as keyof typeof initial]),
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    const parsed = updateTitleRequestSchema.safeParse(changed);
    if (!parsed.success) return setError(t('titles.invalid'));
    save.mutate(parsed.data);
  }
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <h2 className="font-semibold sm:col-span-2">{t('titles.details')}</h2>
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        {done && (
          <div className="sm:col-span-2">
            <Alert tone="success">{t('titles.savedEverywhere')}</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label={t('titles.titleField')}>
            {({ id }) => <Input id={id} value={form.title} onChange={set('title')} />}
          </Field>
        </div>
        <Field label={t('titles.writer')}>
          {({ id }) => <Input id={id} value={form.writer} onChange={set('writer')} />}
        </Field>
        <Field label={t('titles.publisher')}>
          {({ id }) => <Input id={id} value={form.publisher} onChange={set('publisher')} />}
        </Field>
        <Field label="ISBN">
          {({ id }) => <Input id={id} value={form.isbn} onChange={set('isbn')} />}
        </Field>
        <Field label={t('titles.edition')}>
          {({ id }) => <Input id={id} value={form.edition} onChange={set('edition')} />}
        </Field>
        <Field label={t('titles.category')} hint={t('titles.categoryHint')}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={form.categoryCode}
              onChange={set('categoryCode')}
            >
              {categories.data
                ?.filter((c) => c.isActive || c.code === d.categoryCode)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={Object.keys(changed).length === 0 || save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Copies({ title: d }: { title: TitleDetail }) {
  const { t } = useTranslation();
  const { user } = useMe();
  const branches = useBranches();
  const isStaff = user.userType !== 'member';
  const name = (id: number) => branches.data?.find((b) => b.id === id)?.name ?? '';
  return (
    <Card className="overflow-x-auto p-0">
      <h2 className="px-5 pt-5 font-semibold">{t('titles.copies')}</h2>
      {d.copies.length === 0 ? (
        <p className="p-5 text-stone-600">{t('catalogue.noCopies')}</p>
      ) : (
        // Three columns fit a phone; only staff, with the actions column, need to scroll.
        <table className={`mt-3 w-full text-left text-sm ${isStaff ? 'min-w-[520px]' : ''}`}>
          <thead className="border-y border-stone-200 bg-stone-50 text-xs text-stone-600 uppercase">
            <tr>
              <th className="px-4 py-2 font-medium">{t('titles.accessionNo')}</th>
              <th className="px-4 py-2 font-medium">{t('titles.branch')}</th>
              <th className="px-4 py-2 font-medium">{t('titles.where')}</th>
              {isStaff && (
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">{t('staff.actions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {d.copies.map((c) => (
              <CopyRow key={c.id} copy={c} titleId={d.id} branchName={name(c.branchId)} />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

const STATE_TONE: Record<Copy['state'], string> = {
  on_shelf: 'bg-emerald-50 text-emerald-900',
  on_loan: 'bg-sky-50 text-sky-950',
  in_transit: 'bg-sky-50 text-sky-950',
  held: 'bg-violet-50 text-violet-950',
  missing: 'bg-red-50 text-red-900',
  not_useable: 'bg-amber-100 text-amber-950',
  withdrawn: 'bg-stone-200 text-stone-700',
};

function CopyRow({
  copy: c,
  titleId,
  branchName,
}: {
  copy: Copy;
  titleId: number;
  branchName: string;
}) {
  const { t } = useTranslation();
  const { user } = useMe();
  const branches = useBranches();
  const saved = useSaved(titleId);
  const isStaff = user.userType !== 'member';
  const isSuper = user.userType === 'super_admin';
  const mine = isSuper || c.branchId === user.branchId;
  const [action, setAction] = useState<'withdraw' | 'move' | 'history' | 'found' | null>(null);
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  // FR-LST-12: a missing copy turned up; a super admin puts it back on the shelf.
  const { found } = useCopyFound(() => {
    setAction(null);
    setReason('');
  });
  const run = useMutation({
    mutationFn: ({
      path,
      method,
      body,
    }: {
      path: string;
      method: 'POST' | 'PATCH';
      body?: unknown;
    }) => api(path, { method, body, schema: titleDetailSchema }),
    onSuccess: async (detail) => {
      setAction(null);
      setError(null);
      await saved(detail);
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  return (
    <>
      <tr className={c.state === 'withdrawn' ? 'text-stone-500' : undefined}>
        <td className="px-4 py-2 font-mono">{c.accessionNo}</td>
        <td className="px-4 py-2">{branchName}</td>
        <td className="px-4 py-2">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_TONE[c.state]}`}>
            {t(`copyState.${c.state}`)}
          </span>
          {isStaff && c.priceCents !== null && (
            <span className="ml-2 text-xs text-stone-600 tabular-nums">
              Rs {formatRupees(c.priceCents)}
            </span>
          )}
          {c.withdrawnReason && <div className="text-xs">{c.withdrawnReason}</div>}
        </td>
        {isStaff && (
          <td className="px-4 py-2">
            <div className="flex flex-wrap justify-end gap-2">
              {mine && c.state !== 'withdrawn' && c.state !== 'on_loan' && (
                <Select
                  aria-label={t('titles.condition', { no: c.accessionNo })}
                  value={c.condition}
                  className="w-auto py-1 text-sm"
                  onChange={(e) =>
                    run.mutate({
                      path: `/copies/${c.id}`,
                      method: 'PATCH',
                      body: { condition: e.target.value },
                    })
                  }
                >
                  <option value="useable">{t('copyCondition.useable')}</option>
                  <option value="not_useable">{t('copyCondition.not_useable')}</option>
                  <option value="missing">{t('copyCondition.missing')}</option>
                </Select>
              )}
              {mine && c.state !== 'withdrawn' && action === null && (
                <Button variant="ghost" onClick={() => setAction('withdraw')}>
                  {t('titles.withdraw')}
                </Button>
              )}
              {isSuper && c.state !== 'withdrawn' && action === null && (
                <Button variant="ghost" onClick={() => setAction('move')}>
                  {t('titles.move')}
                </Button>
              )}
              {action === null && (
                <Button variant="ghost" onClick={() => setAction('history')}>
                  {t('log.history')}
                </Button>
              )}
              {isSuper && c.state === 'missing' && action === null && (
                <Button variant="secondary" onClick={() => setAction('found')}>
                  {t('titles.found')}
                </Button>
              )}
              {isSuper && c.state === 'withdrawn' && (
                <Button
                  variant="secondary"
                  onClick={() => run.mutate({ path: `/copies/${c.id}/reinstate`, method: 'POST' })}
                >
                  {t('titles.reinstate')}
                </Button>
              )}
            </div>
          </td>
        )}
      </tr>
      {(action || error) && (
        <tr>
          <td colSpan={4} className="bg-stone-50 px-4 py-3">
            {error && <Alert tone="error">{error}</Alert>}
            {action === 'history' && (
              <div className="space-y-2">
                <History entity="copy" entityId={c.id} open />
                <Button variant="ghost" onClick={() => setAction(null)}>
                  {t('log.hideHistory')}
                </Button>
              </div>
            )}
            {action === 'found' && (
              <form
                className="mt-2 flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim()) {
                    found.mutate(
                      { copyId: c.id, reason: reason.trim() },
                      { onError: (err) => setError(errorMessage(t, err)) },
                    );
                  }
                }}
              >
                <div className="min-w-60 flex-1">
                  <Field label={t('titles.foundReason', { no: c.accessionNo })}>
                    {({ id }) => (
                      <Input
                        id={id}
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    )}
                  </Field>
                </div>
                <Button type="submit" disabled={!reason.trim() || found.isPending}>
                  {t('titles.confirmFound')}
                </Button>
                <Button variant="ghost" onClick={() => setAction(null)}>
                  {t('common.cancel')}
                </Button>
              </form>
            )}
            {action === 'withdraw' && (
              <form
                className="mt-2 flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim())
                    run.mutate({
                      path: `/copies/${c.id}/withdraw`,
                      method: 'POST',
                      body: { reason },
                    });
                }}
              >
                <div className="min-w-60 flex-1">
                  <Field label={t('titles.withdrawReason', { no: c.accessionNo })}>
                    {({ id }) => (
                      <Input
                        id={id}
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    )}
                  </Field>
                </div>
                <Button type="submit" variant="danger" disabled={!reason.trim() || run.isPending}>
                  {t('titles.confirmWithdraw')}
                </Button>
                <Button variant="ghost" onClick={() => setAction(null)}>
                  {t('common.cancel')}
                </Button>
              </form>
            )}
            {action === 'move' && (
              <form
                className="mt-2 flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (target)
                    run.mutate({
                      path: `/copies/${c.id}/move`,
                      method: 'POST',
                      body: { branchId: Number(target) },
                    });
                }}
              >
                <div className="min-w-60 flex-1">
                  <Field
                    label={t('titles.moveTo', { no: c.accessionNo })}
                    hint={t('titles.moveHint')}
                  >
                    {({ id, describedBy }) => (
                      <Select
                        id={id}
                        aria-describedby={describedBy}
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                      >
                        <option value="">{t('person.chooseBranch')}</option>
                        {branches.data
                          ?.filter((b) => b.id !== c.branchId)
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} ({b.code})
                            </option>
                          ))}
                      </Select>
                    )}
                  </Field>
                </div>
                <Button type="submit" disabled={!target || run.isPending}>
                  {t('titles.confirmMove')}
                </Button>
                <Button variant="ghost" onClick={() => setAction(null)}>
                  {t('common.cancel')}
                </Button>
              </form>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** FR-CAT-01, FR-CAT-02: more copies of this title, each numbered by the system. */
function AddCopies({
  title: d,
  onAdded,
}: {
  title: TitleDetail;
  onAdded: (numbers: string[]) => void;
}) {
  const { t } = useTranslation();
  const { user } = useMe();
  const branches = useBranches();
  const saved = useSaved(d.id);
  const allowed = (branches.data ?? []).filter(
    (b) => user.userType === 'super_admin' || b.id === user.branchId,
  );
  const [branchId, setBranchId] = useState(user.branchId ? String(user.branchId) : '');
  const [count, setCount] = useState('1');
  const [source, setSource] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (body: unknown) =>
      api(`/titles/${d.id}/copies`, { method: 'POST', body, schema: createdCopiesResponseSchema }),
    onSuccess: async (r) => {
      await saved(r.title);
      setCount('1');
      onAdded(r.accessionNumbers);
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(count);
    const cents = price.trim() ? parseRupees(price) : null;
    if (!branchId || !Number.isInteger(n) || n < 1 || n > 50 || (price.trim() && cents === null)) {
      return setError(t('titles.copiesInvalid'));
    }
    add.mutate({ branchId: Number(branchId), count: n, source, priceCents: cents });
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <h2 className="font-semibold">{t('titles.addCopies')}</h2>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('titles.branch')}>
            {({ id }) => (
              <Select
                id={id}
                value={branchId}
                disabled={allowed.length === 1}
                onChange={(e) => setBranchId(e.target.value)}
              >
                <option value="">{t('person.chooseBranch')}</option>
                {allowed.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('titles.howMany')}>
            {({ id }) => (
              <Input
                id={id}
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('titles.source')} hint={t('titles.sourceHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('titles.price')}>
            {({ id }) => (
              <Input
                id={id}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Button type="submit" disabled={add.isPending}>
          {t('titles.addCopiesSubmit')}
        </Button>
      </form>
    </Card>
  );
}

/** FR-CAT-18: this title is a duplicate of another; its copies move there. */
function Merge({ title: d }: { title: TitleDetail }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const searching = query.trim().length >= 2;
  const found = useCatalogue(
    { q: query, branchId: null, category: '', available: false, page: 0 },
    searching,
  );
  const [error, setError] = useState<string | null>(null);
  const [mergedInto, setMergedInto] = useState<number | null>(null);
  const merge = useMutation({
    mutationFn: (intoTitleId: number) =>
      api(`/titles/${d.id}/merge`, {
        method: 'POST',
        body: { intoTitleId },
        schema: titleDetailSchema,
      }),
    onSuccess: async (into) => {
      setMergedInto(into.id);
      await queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY });
      await queryClient.invalidateQueries({ queryKey: titleKey(d.id) });
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  const candidates = searching ? (found.data?.titles ?? []).filter((x) => x.id !== d.id) : [];
  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('titles.mergeTitle')}</h2>
      <p className="mb-3 text-sm text-stone-600">{t('titles.mergeLead')}</p>
      {error && <Alert tone="error">{error}</Alert>}
      {mergedInto ? (
        <Alert tone="success">
          {t('titles.merged')}{' '}
          <Link className="underline" to={`/titles/${mergedInto}`}>
            {t('titles.openThatTitle')}
          </Link>
        </Alert>
      ) : (
        <>
          <Input
            type="search"
            aria-label={t('titles.mergeSearch')}
            placeholder={t('titles.mergeSearch')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="mt-3 space-y-2">
            {candidates.slice(0, 5).map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {x.title}
                  {x.writer && <span className="text-stone-600"> · {x.writer}</span>}
                </span>
                <Button
                  variant="secondary"
                  disabled={merge.isPending}
                  onClick={() => merge.mutate(x.id)}
                >
                  {t('titles.mergeInto')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
