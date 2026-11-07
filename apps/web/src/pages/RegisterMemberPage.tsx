import {
  branchDetailSchema,
  formatRupees,
  parseRupees,
  registeredMemberResponseSchema,
  registerMemberRequestSchema,
} from '@pothgula/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { MEMBERS_KEY } from '../api/members';
import { branchKey, useBranches } from '../api/queries';
import { useMe } from '../auth/auth';
import { emptyPerson, PersonFields, personBody, type PersonForm } from '../components/PersonFields';
import { Alert, Button, Card, Field, Input, PageTitle } from '../components/ui';

/** FR-AUT-05: a member registered at the counter — identity checked, first fee taken. */
export function RegisterMemberPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const queryClient = useQueryClient();
  const branches = useBranches();
  const allowed = (branches.data ?? []).filter(
    (b) => user.userType === 'super_admin' || b.id === user.branchId,
  );
  const [person, setPerson] = useState<PersonForm>({
    ...emptyPerson,
    homeBranchId: user.branchId ? String(user.branchId) : '',
  });
  const branchId = Number(person.homeBranchId) || null;
  const fee = useQuery({
    queryKey: branchKey(branchId ?? 0),
    queryFn: () => api(`/branches/${branchId}`, { schema: branchDetailSchema }),
    enabled: branchId !== null,
  }).data?.settings.annualFeeCents;
  const [consent, setConsent] = useState(false);
  const [checked, setChecked] = useState(false);
  const [amount, setAmount] = useState<string | null>(null);
  const [receipt, setReceipt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: number; name: string; password: string } | null>(null);
  const shownAmount = amount ?? (fee !== undefined ? formatRupees(fee) : '');

  const register = useMutation({
    mutationFn: (body: unknown) =>
      api('/members', { method: 'POST', body, schema: registeredMemberResponseSchema }),
    onSuccess: async (r) => {
      setDone({ id: r.member.id, name: r.member.fullName, password: r.temporaryPassword });
      await queryClient.invalidateQueries({ queryKey: MEMBERS_KEY });
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = parseRupees(shownAmount);
    const parsed = registerMemberRequestSchema.safeParse({
      ...personBody(person),
      introducerConsent: consent,
      identityChecked: checked,
      payment: { kind: 'first_fee', amountCents: cents ?? 0, receiptNo: receipt },
    });
    if (!parsed.success) {
      setError(t('members.registerIncomplete'));
      return;
    }
    register.mutate(parsed.data);
  }

  if (done) {
    return (
      <div className="max-w-2xl">
        <PageTitle>{t('members.registeredTitle')}</PageTitle>
        <Alert tone="warning" title={t('staff.tempTitle', { name: done.name })}>
          <p className="my-2 font-mono text-2xl tracking-wider" data-testid="temporary-password">
            {done.password}
          </p>
          <p>{t('staff.tempBody')}</p>
        </Alert>
        <p className="mt-4">
          <Link to={`/members/${done.id}`} className="text-emerald-800 underline">
            {t('members.openRecord')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageTitle lead={t('members.registerLead')}>{t('members.register')}</PageTitle>
      <Card>
        <form onSubmit={submit} className="space-y-6" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <PersonFields
            value={person}
            onChange={setPerson}
            branches={allowed}
            branchLocked={allowed.length === 1}
          />
          <div className="space-y-3 rounded-md bg-stone-50 p-4 text-sm">
            <label className="flex gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>{t('members.consentAsked')}</span>
            </label>
            <label className="flex gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <span>{t('members.identityChecked')}</span>
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('members.firstFee')}>
              {({ id }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={shownAmount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('members.receiptNo')}>
              {({ id }) => (
                <Input id={id} value={receipt} onChange={(e) => setReceipt(e.target.value)} />
              )}
            </Field>
          </div>
          <Button type="submit" disabled={!consent || !checked || register.isPending}>
            {t('members.registerSubmit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
