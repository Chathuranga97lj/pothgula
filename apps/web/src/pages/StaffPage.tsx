import {
  branchSummarySchema,
  type CreateStaffRequest,
  createStaffRequestSchema,
  type StaffMember,
  staffMemberSchema,
  temporaryPasswordResponseSchema,
} from '@pothgula/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { ME_KEY, useMe } from '../auth/auth';
import { Alert, Button, Card, Field, Input, PageTitle, Select } from '../components/ui';

const STAFF_KEY = ['staff'] as const;
const BRANCHES_KEY = ['branches'] as const;

interface Issued {
  name: string;
  password: string;
}

/** FR-AUT-04, FR-AUT-05, FR-AUT-09, FR-AUT-11, FR-AUT-12, FR-AUT-14. */
export function StaffPage() {
  const { t } = useTranslation();
  const { user: me } = useMe();
  const isSuper = me.userType === 'super_admin';
  const [issued, setIssued] = useState<Issued | null>(null);

  const staff = useQuery({
    queryKey: STAFF_KEY,
    queryFn: () => api('/staff', { schema: z.array(staffMemberSchema) }),
  });
  const branches = useQuery({
    queryKey: BRANCHES_KEY,
    queryFn: () => api('/branches', { schema: z.array(branchSummarySchema) }),
  });
  const branchCode = (id: number | null) =>
    id === null ? t('staff.allBranches') : (branches.data?.find((b) => b.id === id)?.code ?? '—');

  return (
    <>
      <PageTitle lead={isSuper ? t('staff.leadSuper') : t('staff.leadAdmin')}>
        {t('staff.title')}
      </PageTitle>

      {issued && <TemporaryPassword issued={issued} onDone={() => setIssued(null)} />}

      {isSuper && (
        <AddStaff
          branches={branches.data ?? []}
          onCreated={(name, password) => setIssued({ name, password })}
        />
      )}

      <Card className="mt-6 overflow-x-auto p-0">
        {staff.isError && (
          <div className="p-5">
            <Alert tone="error">{errorMessage(t, staff.error)}</Alert>
          </div>
        )}
        {staff.isPending && <p className="p-5 text-stone-600">{t('common.loading')}</p>}
        {staff.data && (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-600 uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">{t('staff.name')}</th>
                <th className="px-4 py-3 font-medium">{t('staff.phone')}</th>
                <th className="px-4 py-3 font-medium">{t('staff.role')}</th>
                <th className="px-4 py-3 font-medium">{t('staff.branch')}</th>
                <th className="px-4 py-3 font-medium">{t('staff.status')}</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">{t('staff.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {staff.data.map((s) => (
                <StaffRow
                  key={s.id}
                  staff={s}
                  branchCode={branchCode(s.branchId)}
                  onIssued={(password) => setIssued({ name: s.fullName, password })}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function StatusBadges({ staff }: { staff: StaffMember }) {
  const { t } = useTranslation();
  const locked = staff.lockedUntil !== null && new Date(staff.lockedUntil) > new Date();
  return (
    <div className="flex flex-wrap gap-1">
      <span
        className={`rounded px-2 py-0.5 text-xs font-medium ${
          staff.status === 'active'
            ? 'bg-emerald-50 text-emerald-900'
            : 'bg-stone-200 text-stone-700'
        }`}
      >
        {t(`status.${staff.status}`)}
      </span>
      {locked && (
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">
          {t('staff.locked')}
        </span>
      )}
      {staff.mustChangePassword && staff.status === 'active' && (
        <span className="rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-950">
          {t('staff.awaitingFirstSignIn')}
        </span>
      )}
    </div>
  );
}

function StaffRow({
  staff,
  branchCode,
  onIssued,
}: {
  staff: StaffMember;
  branchCode: string;
  onIssued: (password: string) => void;
}) {
  const { t } = useTranslation();
  const { user: me } = useMe();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSelf = staff.id === me.id;
  const isSuper = me.userType === 'super_admin';
  const mayReset = !isSelf && (isSuper || staff.userType === 'admin');
  const mayDeactivate = isSuper && !isSelf;

  const done = async () => {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: STAFF_KEY });
    await queryClient.invalidateQueries({ queryKey: ME_KEY }); // super admin count may change
  };

  const reset = useMutation({
    mutationFn: () =>
      api(`/users/${staff.id}/reset-password`, {
        method: 'POST',
        schema: temporaryPasswordResponseSchema,
      }),
    onSuccess: async (r) => {
      onIssued(r.temporaryPassword);
      await done();
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  const deactivate = useMutation({
    mutationFn: (why: string) =>
      api(`/users/${staff.id}/deactivate`, { method: 'POST', body: { reason: why } }),
    onSuccess: async () => {
      setReason(null);
      await done();
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  const reactivate = useMutation({
    mutationFn: () => api(`/users/${staff.id}/reactivate`, { method: 'POST' }),
    onSuccess: done,
    onError: (err) => setError(errorMessage(t, err)),
  });

  function confirmDeactivate(e: FormEvent) {
    e.preventDefault();
    if (reason?.trim()) deactivate.mutate(reason.trim());
  }

  return (
    <>
      <tr>
        <td className="px-4 py-3 font-medium">
          {staff.fullName}
          {isSelf && <span className="ml-1 text-stone-500">({t('staff.you')})</span>}
        </td>
        <td className="px-4 py-3 tabular-nums">{staff.whatsappPhone}</td>
        <td className="px-4 py-3">{t(`roles.${staff.userType}`)}</td>
        <td className="px-4 py-3">{branchCode}</td>
        <td className="px-4 py-3">
          <StatusBadges staff={staff} />
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap justify-end gap-2">
            {mayReset && staff.status === 'active' && (
              <Button variant="secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>
                {t('staff.resetPassword')}
              </Button>
            )}
            {mayDeactivate && staff.status === 'active' && reason === null && (
              <Button variant="ghost" onClick={() => setReason('')}>
                {t('staff.deactivate')}
              </Button>
            )}
            {mayDeactivate && staff.status === 'deactivated' && (
              <Button
                variant="secondary"
                disabled={reactivate.isPending}
                onClick={() => reactivate.mutate()}
              >
                {t('staff.reactivate')}
              </Button>
            )}
          </div>
        </td>
      </tr>
      {(reason !== null || error) && (
        <tr>
          <td colSpan={6} className="bg-stone-50 px-4 py-3">
            {error && <Alert tone="error">{error}</Alert>}
            {reason !== null && (
              <form onSubmit={confirmDeactivate} className="mt-2 flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1">
                  <Field label={t('staff.deactivateReason', { name: staff.fullName })}>
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
                <Button
                  type="submit"
                  variant="danger"
                  disabled={!reason.trim() || deactivate.isPending}
                >
                  {t('staff.confirmDeactivate')}
                </Button>
                <Button variant="ghost" onClick={() => setReason(null)}>
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

function AddStaff({
  branches,
  onCreated,
}: {
  branches: { id: number; code: string; name: string }[];
  onCreated: (name: string, password: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [userType, setUserType] = useState<CreateStaffRequest['userType']>('admin');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: CreateStaffRequest) =>
      api('/staff', {
        method: 'POST',
        body,
        schema: z.object({ user: staffMemberSchema, temporaryPassword: z.string() }),
      }),
    onSuccess: async (r) => {
      onCreated(r.user.fullName, r.temporaryPassword);
      setOpen(false);
      setFullName('');
      setPhone('');
      setBranchId('');
      await queryClient.invalidateQueries({ queryKey: STAFF_KEY });
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createStaffRequestSchema.safeParse({
      fullName,
      whatsappPhone: phone,
      userType,
      branchId: userType === 'admin' ? Number(branchId) || null : null,
    });
    if (!parsed.success) {
      setError(t('staff.formIncomplete'));
      return;
    }
    create.mutate(parsed.data);
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>{t('staff.add')}</Button>;
  }
  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <h2 className="font-semibold sm:col-span-2">{t('staff.addTitle')}</h2>
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <Field label={t('staff.name')}>
          {({ id }) => (
            <Input id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          )}
        </Field>
        <Field label={t('staff.phone')}>
          {({ id }) => (
            <Input
              id={id}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('staff.role')}>
          {({ id }) => (
            <Select
              id={id}
              value={userType}
              onChange={(e) => setUserType(e.target.value as CreateStaffRequest['userType'])}
            >
              <option value="admin">{t('roles.admin')}</option>
              <option value="super_admin">{t('roles.super_admin')}</option>
            </Select>
          )}
        </Field>
        {userType === 'admin' ? (
          <Field label={t('staff.branch')}>
            {({ id }) => (
              <Select id={id} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">{t('staff.chooseBranch')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <p className="self-end text-sm text-stone-600">{t('staff.superAdminNoBranch')}</p>
        )}
        <div className="flex gap-3 sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            {t('staff.create')}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** FR-AUT-12: shown once, for the staff member to hand over; never retrievable again. */
function TemporaryPassword({ issued, onDone }: { issued: Issued; onDone: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="mb-6">
      <Alert tone="warning" title={t('staff.tempTitle', { name: issued.name })}>
        <p className="my-2 font-mono text-2xl tracking-wider" data-testid="temporary-password">
          {issued.password}
        </p>
        <p>{t('staff.tempBody')}</p>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? t('staff.copied') : t('staff.copy')}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {t('staff.tempDone')}
          </Button>
        </div>
      </Alert>
    </div>
  );
}
