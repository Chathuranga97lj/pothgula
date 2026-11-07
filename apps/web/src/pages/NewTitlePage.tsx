import {
  createdCopiesResponseSchema,
  createTitleRequestSchema,
  parseRupees,
} from '@pothgula/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CATALOGUE_KEY, useSimilarTitles } from '../api/catalogue';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { useBranches, useCategories } from '../api/queries';
import { useMe } from '../auth/auth';
import { Alert, Button, Card, Field, Input, PageTitle, Select } from '../components/ui';

/** FR-CAT-01: a title once, with its copies; possible duplicates are offered first. */
export function NewTitlePage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const branches = useBranches();
  const allowed = (branches.data ?? []).filter(
    (b) => user.userType === 'super_admin' || b.id === user.branchId,
  );
  const [form, setForm] = useState({
    title: '',
    writer: '',
    publisher: '',
    isbn: '',
    edition: '',
    categoryCode: '',
    branchId: user.branchId ? String(user.branchId) : '',
    count: '1',
    source: '',
    price: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: number; numbers: string[] } | null>(null);
  const similar = useSimilarTitles(form.title, form.isbn);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useMutation({
    mutationFn: (body: unknown) =>
      api('/titles', { method: 'POST', body, schema: createdCopiesResponseSchema }),
    onSuccess: async (r) => {
      setCreated({ id: r.title.id, numbers: r.accessionNumbers });
      await queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY });
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const count = Number(form.count);
    const priceCents = form.price.trim() ? parseRupees(form.price) : null;
    if (form.price.trim() && priceCents === null) return setError(t('titles.copiesInvalid'));
    const parsed = createTitleRequestSchema.safeParse({
      title: form.title,
      writer: form.writer,
      publisher: form.publisher,
      isbn: form.isbn,
      edition: form.edition,
      categoryCode: form.categoryCode,
      copies:
        count > 0
          ? { branchId: Number(form.branchId) || 0, count, source: form.source, priceCents }
          : undefined,
    });
    if (!parsed.success) return setError(t('titles.invalid'));
    create.mutate(parsed.data);
  }

  if (created) {
    return (
      <div className="max-w-2xl">
        <PageTitle>{t('titles.createdTitle')}</PageTitle>
        {created.numbers.length > 0 && (
          <Alert tone="success" title={t('titles.writeNumbers')}>
            <p className="mt-2 font-mono text-lg" data-testid="accession-numbers">
              {created.numbers.join('  ')}
            </p>
          </Alert>
        )}
        <div className="mt-4 flex gap-4">
          <Link to={`/titles/${created.id}`} className="text-emerald-800 underline">
            {t('titles.openTitle')}
          </Link>
          <button
            type="button"
            className="text-emerald-800 underline"
            onClick={() => window.location.reload()}
          >
            {t('titles.addAnother')}
          </button>
        </div>
      </div>
    );
  }

  const candidates = similar.data ?? [];
  return (
    <div className="max-w-3xl">
      <PageTitle lead={t('titles.newLead')}>{t('catalogue.addTitle')}</PageTitle>
      {candidates.length > 0 && (
        <div className="mb-5">
          <Alert tone="warning" title={t('titles.maybeDuplicate')}>
            <ul className="mt-2 space-y-1">
              {candidates.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link to={`/titles/${c.id}`} className="font-medium underline">
                    {c.title}
                  </Link>
                  {c.writer && ` · ${c.writer}`}
                  {c.reason === 'same_isbn' && <strong> — {t('titles.sameIsbn')}</strong>}
                </li>
              ))}
            </ul>
            <p className="mt-2">{t('titles.duplicateHint')}</p>
          </Alert>
        </div>
      )}
      <Card>
        <form onSubmit={submit} className="space-y-6" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="sm:col-span-2">
              <Field label={t('titles.category')}>
                {({ id }) => (
                  <Select id={id} value={form.categoryCode} onChange={set('categoryCode')}>
                    <option value="">{t('titles.chooseCategory')}</option>
                    {categories.data
                      ?.filter((c) => c.isActive)
                      .map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            </div>
          </div>
          <fieldset className="grid gap-4 rounded-md bg-stone-50 p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium text-stone-700">
              {t('titles.copiesNow')}
            </legend>
            <Field label={t('titles.branch')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={form.branchId}
                  disabled={allowed.length === 1}
                  onChange={set('branchId')}
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
            <Field label={t('titles.howMany')} hint={t('titles.howManyHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  value={form.count}
                  onChange={set('count')}
                />
              )}
            </Field>
            <Field label={t('titles.source')} hint={t('titles.sourceHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={form.source}
                  onChange={set('source')}
                />
              )}
            </Field>
            <Field label={t('titles.price')}>
              {({ id }) => (
                <Input id={id} inputMode="decimal" value={form.price} onChange={set('price')} />
              )}
            </Field>
          </fieldset>
          <Button type="submit" disabled={create.isPending}>
            {t('titles.create')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
