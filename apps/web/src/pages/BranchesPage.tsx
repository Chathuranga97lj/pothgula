import { branchDetailSchema, createBranchRequestSchema, libraryInfoSchema } from '@pothgula/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { BRANCHES_KEY, LIBRARY_KEY, useBranches, useLibrary } from '../api/queries';
import { useMe } from '../auth/auth';
import { ImageUploadButton, imageForm, Logo } from '../components/images';
import { Alert, Button, Card, Field, Input, PageTitle } from '../components/ui';

/** FR-BRN-01, FR-BRN-03, FR-BRN-04. */
export function BranchesPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const isSuper = user.userType === 'super_admin';
  const branches = useBranches();

  return (
    <>
      <PageTitle lead={t('branches.lead')}>{t('branches.title')}</PageTitle>
      {isSuper && <LibraryCard />}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {branches.data?.map((b) => (
          <Link
            key={b.id}
            to={`/branches/${b.id}`}
            className="flex items-center gap-4 rounded-lg border border-stone-200 bg-white p-4 shadow-sm hover:border-emerald-700"
          >
            <Logo imageId={b.logoImageId} name={b.name} />
            <div>
              <p className="font-semibold">{b.name}</p>
              <p className="font-mono text-sm text-stone-600">{b.code}</p>
            </div>
          </Link>
        ))}
      </div>
      {branches.isError && <Alert tone="error">{errorMessage(t, branches.error)}</Alert>}
      {branches.data?.length === 0 && <p className="text-stone-600">{t('branches.none')}</p>}

      {isSuper && <AddBranch />}
    </>
  );
}

/** The library-wide name and logo (FR-BRN-03, FR-BRN-04); super admin only. */
function LibraryCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const library = useLibrary();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: (newName: string) =>
      api('/library', { method: 'PATCH', body: { name: newName }, schema: libraryInfoSchema }),
    onSuccess: (info) => {
      queryClient.setQueryData(LIBRARY_KEY, info);
      setName(null);
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  if (!library.data) return null;
  const current = library.data;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (name?.trim()) rename.mutate(name.trim());
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-5">
        <Logo imageId={current.logoImageId} name={current.name} size="lg" />
        <div className="min-w-60 flex-1 space-y-3">
          <h2 className="text-sm font-medium tracking-wide text-stone-600 uppercase">
            {t('branches.library')}
          </h2>
          {name === null ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-lg font-semibold">{current.name}</p>
              <Button variant="ghost" onClick={() => setName(current.name)}>
                {t('branches.renameLibrary')}
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
              <div className="min-w-60 flex-1">
                <Field label={t('branches.libraryName')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                    />
                  )}
                </Field>
              </div>
              <Button type="submit" disabled={!name.trim() || rename.isPending}>
                {t('common.save')}
              </Button>
              <Button variant="ghost" onClick={() => setName(null)}>
                {t('common.cancel')}
              </Button>
            </form>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <ImageUploadButton
            label={
              current.logoImageId ? t('branches.replaceLibraryLogo') : t('branches.addLibraryLogo')
            }
            onUpload={async (file) => {
              const info = await api('/library/logo', {
                method: 'POST',
                body: imageForm(file),
                schema: libraryInfoSchema,
              });
              queryClient.setQueryData(LIBRARY_KEY, info);
            }}
          />
        </div>
      </div>
    </Card>
  );
}

function AddBranch() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ branchName: '', branchCode: '', address: '', phone: '' });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: unknown) =>
      api('/branches', { method: 'POST', body, schema: branchDetailSchema }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: BRANCHES_KEY });
      navigate(`/branches/${created.id}`);
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createBranchRequestSchema.safeParse(form);
    if (!parsed.success) {
      setError(t('branches.formIncomplete'));
      return;
    }
    create.mutate(parsed.data);
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  if (!open) {
    return (
      <div className="mt-6">
        <Button onClick={() => setOpen(true)}>{t('branches.add')}</Button>
      </div>
    );
  }
  return (
    <Card className="mt-6">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <h2 className="font-semibold sm:col-span-2">{t('branches.addTitle')}</h2>
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <Field label={t('branches.name')}>
          {({ id }) => <Input id={id} value={form.branchName} onChange={set('branchName')} />}
        </Field>
        <Field label={t('branches.code')} hint={t('branches.codeHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              className="font-mono uppercase"
              maxLength={2}
              value={form.branchCode}
              onChange={set('branchCode')}
            />
          )}
        </Field>
        <Field label={t('branches.address')}>
          {({ id }) => <Input id={id} value={form.address} onChange={set('address')} />}
        </Field>
        <Field label={t('branches.phone')}>
          {({ id }) => (
            <Input id={id} type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} />
          )}
        </Field>
        <div className="flex gap-3 sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            {t('branches.create')}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
