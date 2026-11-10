import {
  type BranchDetail,
  branchDetailSchema,
  type BranchSettings,
  formatRupees,
  parseRupees,
  updateBranchRequestSchema,
} from '@pothgula/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { BRANCHES_KEY, branchKey } from '../api/queries';
import { useMe } from '../auth/auth';
import { useHours } from '../api/schedule';
import { HoursCard, HoursEditor } from '../components/hours';
import { ImageUploadButton, imageForm, Logo } from '../components/images';
import { Alert, Button, Card, Field, Input, PageTitle } from '../components/ui';

/** FR-BRN-02 – FR-BRN-04, FR-MEM-06 and the branch settings of §17. */
export function BranchPage() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const { user } = useMe();
  const canEdit = user.userType === 'super_admin';
  const queryClient = useQueryClient();

  const branch = useQuery({
    queryKey: branchKey(id),
    queryFn: () => api(`/branches/${id}`, { schema: branchDetailSchema }),
    enabled: Number.isInteger(id) && id > 0,
  });

  const saved = async (detail: BranchDetail) => {
    queryClient.setQueryData(branchKey(id), detail);
    await queryClient.invalidateQueries({ queryKey: BRANCHES_KEY, exact: true });
  };

  if (branch.isError) return <Alert tone="error">{errorMessage(t, branch.error)}</Alert>;
  if (!branch.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  const b = branch.data;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/branches" className="text-emerald-800 underline">
          ← {t('branches.title')}
        </Link>
      </p>
      <PageTitle lead={canEdit ? undefined : t('branches.readOnly')}>
        <span className="font-mono text-stone-500">{b.code}</span> {b.name}
      </PageTitle>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Details branch={b} canEdit={canEdit} onSaved={saved} />
        <Card>
          <h2 className="mb-3 font-semibold">{t('branches.logo')}</h2>
          <div className="flex items-start gap-4">
            <Logo imageId={b.logoImageId} name={b.name} size="lg" />
            {canEdit && (
              <ImageUploadButton
                label={b.logoImageId ? t('branches.replaceLogo') : t('branches.addLogo')}
                onUpload={async (file) => {
                  await saved(
                    await api(`/branches/${id}/logo`, {
                      method: 'POST',
                      body: imageForm(file),
                      schema: branchDetailSchema,
                    }),
                  );
                }}
              />
            )}
          </div>
          <p className="mt-3 text-sm text-stone-600">{t('branches.logoUse')}</p>
        </Card>
      </div>

      <Settings branch={b} canEdit={canEdit} onSaved={saved} />
      <BranchHoursSection branchId={b.id} />
    </>
  );
}

/** FR-SCH-01, FR-SCH-02: the branch's own staff (and super admins) set its hours. */
function BranchHoursSection({ branchId }: { branchId: number }) {
  const { user } = useMe();
  const hours = useHours(branchId);
  const mayEdit = user.userType === 'super_admin' || user.branchId === branchId;
  if (!hours.data) return null;
  return mayEdit ? (
    <HoursEditor key={hours.data.branch.id} hours={hours.data} />
  ) : (
    <div className="mt-6 max-w-md">
      <HoursCard branchId={branchId} />
    </div>
  );
}

function Details({
  branch,
  canEdit,
  onSaved,
}: {
  branch: BranchDetail;
  canEdit: boolean;
  onSaved: (b: BranchDetail) => Promise<void>;
}) {
  const { t } = useTranslation();
  const initial = {
    branchName: branch.name,
    branchCode: branch.code,
    address: branch.address,
    phone: branch.phone,
  };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      api(`/branches/${branch.id}`, { method: 'PATCH', body, schema: branchDetailSchema }),
    onSuccess: async (detail) => {
      setDone(true);
      await onSaved(detail);
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
    const parsed = updateBranchRequestSchema.safeParse(changed);
    if (!parsed.success) {
      setError(t('branches.formIncomplete'));
      return;
    }
    save.mutate(parsed.data);
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <h2 className="font-semibold sm:col-span-2">{t('branches.details')}</h2>
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        {done && (
          <div className="sm:col-span-2">
            <Alert tone="success">{t('common.saved')}</Alert>
          </div>
        )}
        <Field label={t('branches.name')}>
          {({ id }) => (
            <Input
              id={id}
              disabled={!canEdit}
              value={form.branchName}
              onChange={set('branchName')}
            />
          )}
        </Field>
        <Field
          label={t('branches.code')}
          hint={branch.codeLocked ? t('branches.codeLocked') : t('branches.codeHint')}
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              className="font-mono uppercase"
              maxLength={2}
              disabled={!canEdit || branch.codeLocked}
              value={form.branchCode}
              onChange={set('branchCode')}
            />
          )}
        </Field>
        <Field label={t('branches.address')}>
          {({ id }) => (
            <Input id={id} disabled={!canEdit} value={form.address} onChange={set('address')} />
          )}
        </Field>
        <Field label={t('branches.phone')}>
          {({ id }) => (
            <Input
              id={id}
              type="tel"
              disabled={!canEdit}
              value={form.phone}
              onChange={set('phone')}
            />
          )}
        </Field>
        {canEdit && (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={Object.keys(changed).length === 0 || save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

type NumberSetting = Exclude<keyof BranchSettings, 'annualFeeCents'>;

/** The settings, grouped as a librarian would think of them. */
const GROUPS: { title: string; keys: (NumberSetting | 'annualFeeCents')[] }[] = [
  {
    title: 'lending',
    keys: ['loanDays', 'maxBooks', 'maxBooksWhileSettling', 'holdDays', 'transitAlertDays'],
  },
  { title: 'reminders', keys: ['staffDueWarningDays', 'memberDueWarningDays', 'declineGraceDays'] },
  {
    title: 'membership',
    keys: [
      'annualFeeCents',
      'renewalGraceDays',
      'applicationStaleDays',
      'applicationAnonymiseDays',
    ],
  },
  {
    title: 'lostAndLate',
    keys: ['settlementWindowDays', 'frequentLateCount', 'frequentLateMonths'],
  },
  { title: 'records', keys: ['logRetentionMonths'] },
];

function toForm(s: BranchSettings): Record<keyof BranchSettings, string> {
  return Object.fromEntries(
    Object.entries(s).map(([k, v]) => [k, k === 'annualFeeCents' ? formatRupees(v) : String(v)]),
  ) as Record<keyof BranchSettings, string>;
}

function Settings({
  branch,
  canEdit,
  onSaved,
}: {
  branch: BranchDetail;
  canEdit: boolean;
  onSaved: (b: BranchDetail) => Promise<void>;
}) {
  const { t } = useTranslation();
  const initial = toForm(branch.settings);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = useMutation({
    mutationFn: (body: Partial<BranchSettings>) =>
      api(`/branches/${branch.id}/settings`, {
        method: 'PATCH',
        body,
        schema: branchDetailSchema,
      }),
    onSuccess: async (detail) => {
      setDone(true);
      setForm(toForm(detail.settings));
      await onSaved(detail);
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  const changedKeys = (Object.keys(form) as (keyof BranchSettings)[]).filter(
    (k) => form[k].trim() !== initial[k],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    const body: Partial<BranchSettings> = {};
    for (const key of changedKeys) {
      const raw = form[key].trim();
      const value =
        key === 'annualFeeCents' ? parseRupees(raw) : /^\d+$/.test(raw) ? Number(raw) : null;
      if (value === null) {
        setError(t('branches.settingInvalid', { name: t(`settings.${key}.label`) }));
        return;
      }
      body[key] = value;
    }
    save.mutate(body);
  }

  return (
    <Card className="mt-6">
      <form onSubmit={submit} noValidate>
        <h2 className="mb-1 font-semibold">{t('branches.settings')}</h2>
        <p className="mb-5 text-sm text-stone-600">
          {canEdit ? t('branches.settingsLead') : t('branches.settingsReadOnly')}
        </p>
        {error && (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        {done && (
          <div className="mb-4">
            <Alert tone="success">{t('common.saved')}</Alert>
          </div>
        )}
        <div className="space-y-6">
          {GROUPS.map((group) => (
            <fieldset key={group.title}>
              <legend className="mb-3 text-sm font-medium tracking-wide text-stone-600 uppercase">
                {t(`settings.groups.${group.title}`)}
              </legend>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {group.keys.map((key) => (
                  <Field
                    key={key}
                    label={t(`settings.${key}.label`)}
                    hint={t(`settings.${key}.hint`)}
                  >
                    {({ id, describedBy }) => (
                      <div className="flex items-center gap-2">
                        {key === 'annualFeeCents' && <span className="text-stone-600">Rs</span>}
                        <Input
                          id={id}
                          aria-describedby={describedBy}
                          inputMode={key === 'annualFeeCents' ? 'decimal' : 'numeric'}
                          disabled={!canEdit}
                          className="tabular-nums"
                          value={form[key]}
                          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        />
                      </div>
                    )}
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        {canEdit && (
          <div className="mt-6">
            <Button type="submit" disabled={changedKeys.length === 0 || save.isPending}>
              {t('branches.saveSettings')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
