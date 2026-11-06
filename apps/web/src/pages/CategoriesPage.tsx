import {
  type Category,
  categorySchema,
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
} from '@pothgula/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { CATEGORIES_KEY, useCategories } from '../api/queries';
import { useMe } from '../auth/auth';
import { Alert, Button, Card, Field, Input, PageTitle } from '../components/ui';

/** FR-BRN-05 – FR-BRN-07, FR-CAT-09. */
export function CategoriesPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const canEdit = user.userType === 'super_admin';
  const categories = useCategories();

  return (
    <>
      <PageTitle lead={t('categories.lead')}>{t('categories.title')}</PageTitle>
      {canEdit && <AddCategory />}
      <Card className="mt-6 overflow-x-auto p-0">
        {categories.isError && (
          <div className="p-5">
            <Alert tone="error">{errorMessage(t, categories.error)}</Alert>
          </div>
        )}
        {categories.data && (
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-600 uppercase">
              <tr>
                <th className="w-20 px-4 py-3 font-medium">{t('categories.code')}</th>
                <th className="px-4 py-3 font-medium">{t('categories.name')}</th>
                <th className="px-4 py-3 font-medium">{t('categories.status')}</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">{t('staff.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {categories.data.map((c) => (
                <CategoryRow key={c.code} category={c} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function CategoryRow({ category, canEdit }: { category: Category; canEdit: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(category.code);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
  const update = useMutation({
    mutationFn: (body: unknown) =>
      api(`/categories/${category.code}`, { method: 'PATCH', body, schema: categorySchema }),
    onSuccess: async () => {
      setEditing(false);
      setError(null);
      await refresh();
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  const toggle = useMutation({
    mutationFn: () =>
      api(`/categories/${category.code}/${category.isActive ? 'retire' : 'reinstate'}`, {
        method: 'POST',
        schema: categorySchema,
      }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(t, err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const changes: Record<string, string> = {};
    if (code.trim().toUpperCase() !== category.code) changes.code = code;
    if (name.trim() !== category.name) changes.name = name;
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    const parsed = updateCategoryRequestSchema.safeParse(changes);
    if (!parsed.success) {
      setError(t('categories.formIncomplete'));
      return;
    }
    update.mutate(parsed.data);
  }

  return (
    <>
      <tr className={category.isActive ? undefined : 'text-stone-500'}>
        <td className="px-4 py-3 font-mono font-medium">{category.code}</td>
        <td className="px-4 py-3">{category.name}</td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {!category.isActive && (
              <span className="rounded bg-stone-200 px-2 py-0.5 text-xs font-medium">
                {t('categories.retired')}
              </span>
            )}
            {category.inUse && (
              <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900">
                {t('categories.inUse')}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          {canEdit && !editing && (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(true)}>
                {t('categories.edit')}
              </Button>
              <Button
                variant="secondary"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate()}
              >
                {category.isActive ? t('categories.retire') : t('categories.reinstate')}
              </Button>
            </div>
          )}
        </td>
      </tr>
      {(editing || error) && (
        <tr>
          <td colSpan={4} className="bg-stone-50 px-4 py-3">
            {error && <Alert tone="error">{error}</Alert>}
            {editing && (
              <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-3">
                <div className="w-24">
                  <Field label={t('categories.code')}>
                    {({ id }) => (
                      <Input
                        id={id}
                        className="font-mono uppercase"
                        maxLength={2}
                        disabled={category.inUse}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                      />
                    )}
                  </Field>
                </div>
                <div className="min-w-60 flex-1">
                  <Field label={t('categories.name')}>
                    {({ id }) => (
                      <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />
                    )}
                  </Field>
                </div>
                <Button type="submit" disabled={update.isPending}>
                  {t('common.save')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setCode(category.code);
                    setName(category.name);
                  }}
                >
                  {t('common.cancel')}
                </Button>
                {category.inUse && (
                  <p className="w-full text-sm text-stone-600">{t('categories.codeLocked')}</p>
                )}
              </form>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function AddCategory() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: unknown) =>
      api('/categories', { method: 'POST', body, schema: categorySchema }),
    onSuccess: async () => {
      setCode('');
      setName('');
      await queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createCategoryRequestSchema.safeParse({ code, name });
    if (!parsed.success) {
      setError(t('categories.formIncomplete'));
      return;
    }
    create.mutate(parsed.data);
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3" noValidate>
        <div className="w-28">
          <Field label={t('categories.code')}>
            {({ id }) => (
              <Input
                id={id}
                className="font-mono uppercase"
                maxLength={2}
                placeholder="A1"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="min-w-60 flex-1">
          <Field label={t('categories.name')}>
            {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
        </div>
        <Button type="submit" disabled={create.isPending}>
          {t('categories.add')}
        </Button>
        {error && (
          <div className="w-full">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
      </form>
    </Card>
  );
}
