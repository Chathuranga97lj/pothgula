import {
  memberDetailSchema,
  updateApplicationRequestSchema,
  updateProfileRequestSchema,
} from '@pothgula/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { useOwnLoans } from '../api/loans';
import { OWN_MEMBERSHIP_KEY, useOwnMembership } from '../api/members';
import { useBranches } from '../api/queries';
import { LoanTable } from '../components/loans';
import { MyRequests } from '../components/requests';
import { PersonFields, personBody, type PersonForm } from '../components/PersonFields';
import { Alert, Button, Card, Field, Input, PageTitle } from '../components/ui';
import { StateBadge } from './MembersPage';

/** FR-MEM-09, FR-AUT-21: a member's own record; an applicant corrects their application. */
export function MyMembershipPage() {
  const { t } = useTranslation();
  const own = useOwnMembership(true);
  const branches = useBranches();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PersonForm | null>(null);
  const [profile, setProfile] = useState<{
    address: string;
    otherPhone: string;
    organisation: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      api(path, { method: 'PATCH', body, schema: memberDetailSchema }),
    onSuccess: (d) => {
      queryClient.setQueryData(OWN_MEMBERSHIP_KEY, d);
      setSaved(true);
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  if (own.isError) return <Alert tone="error">{errorMessage(t, own.error)}</Alert>;
  if (!own.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  const m = own.data;
  const pending = m.status === 'pending';

  const application: PersonForm = form ?? {
    fullName: m.fullName,
    address: m.address ?? '',
    whatsappPhone: m.whatsappPhone ?? '',
    otherPhone: m.otherPhone ?? '',
    dateOfBirth: m.dateOfBirth ?? '',
    organisation: m.organisation ?? '',
    introducedByName: m.introducedByName ?? '',
    introducedByPhone: m.introducedByPhone ?? '',
    homeBranchId: m.branchId ? String(m.branchId) : '',
  };
  const details = profile ?? {
    address: m.address ?? '',
    otherPhone: m.otherPhone ?? '',
    organisation: m.organisation ?? '',
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (pending) {
      const { whatsappPhone: _p, ...body } = personBody(application);
      const parsed = updateApplicationRequestSchema.safeParse(body);
      if (!parsed.success) return setError(t('apply.incomplete'));
      save.mutate({ path: '/me/application', body: parsed.data });
    } else {
      const parsed = updateProfileRequestSchema.safeParse(details);
      if (!parsed.success) return setError(t('apply.incomplete'));
      save.mutate({ path: '/me/profile', body: parsed.data });
    }
  }

  return (
    <div className="max-w-3xl">
      <PageTitle lead={pending ? t('my.pendingLead') : t('my.lead')}>
        {t('my.title')} <StateBadge state={m.state} />
      </PageTitle>
      {m.expireAt && <p className="mb-4 text-stone-700">{t('my.expires', { date: m.expireAt })}</p>}
      {!pending && <MyBooks />}
      {!pending && <MyRequests />}
      <Card>
        <form onSubmit={submit} className="space-y-5" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          {saved && <Alert tone="success">{t('common.saved')}</Alert>}
          {pending ? (
            <PersonFields
              value={application}
              onChange={setForm}
              branches={branches.data ?? []}
              phoneLocked
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label={t('person.address')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      value={details.address}
                      onChange={(e) => setProfile({ ...details, address: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <Field label={t('person.otherPhone')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="tel"
                    value={details.otherPhone}
                    onChange={(e) => setProfile({ ...details, otherPhone: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('person.organisation')}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={details.organisation}
                    onChange={(e) => setProfile({ ...details, organisation: e.target.value })}
                  />
                )}
              </Field>
              <p className="text-sm text-stone-600 sm:col-span-2">{t('my.otherChanges')}</p>
            </div>
          )}
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </Card>
    </div>
  );
}

/** FR-CIR-04: the member's books, due dates and late returns. No acknowledgement is asked. */
function MyBooks() {
  const { t } = useTranslation();
  const loans = useOwnLoans(true);
  if (loans.isError) return <Alert tone="error">{errorMessage(t, loans.error)}</Alert>;
  if (!loans.data) return null;
  const { standing } = loans.data;
  return (
    <Card className="mb-6 p-0">
      <h2 className="px-5 pt-5 font-semibold">{t('my.books')}</h2>
      {standing.overdueLoans > 0 && (
        <div className="px-5 pt-3">
          <Alert tone="error" title={t('loans.overdueTitle', { count: standing.overdueLoans })}>
            {t('my.overdueBody')}
          </Alert>
        </div>
      )}
      {standing.lateReturns > 0 && (
        <p className="px-5 pt-3 text-sm text-stone-700">
          {t('my.lateReturns', { count: standing.lateReturns, months: standing.lateReturnMonths })}
        </p>
      )}
      <LoanTable loans={loans.data.loans} staff={false} />
    </Card>
  );
}
