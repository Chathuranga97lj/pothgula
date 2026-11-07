import {
  branchDetailSchema,
  formatRupees,
  type MemberDetail,
  memberDetailSchema,
  parseRupees,
  temporaryPasswordResponseSchema,
} from '@pothgula/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { downloadMemberExport, MEMBERS_KEY, memberKey, useMember } from '../api/members';
import { branchKey, useBranches } from '../api/queries';
import { useMe } from '../auth/auth';
import { Alert, Button, Card, Field, Input, PageTitle } from '../components/ui';
import { StateBadge } from './MembersPage';

/** FR-AUT-17, FR-AUT-19, FR-MEM-02, FR-MEM-09, FR-MEM-10. */
export function MemberPage() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const member = useMember(id);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: ReactNode } | null>(
    null,
  );

  if (member.isError) return <Alert tone="error">{errorMessage(t, member.error)}</Alert>;
  if (!member.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  const m = member.data;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/members" className="text-emerald-800 underline">
          ← {t('members.title')}
        </Link>
      </p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle>
          {m.fullName} <StateBadge state={m.state} />
        </PageTitle>
        <ExportButtons id={m.id} />
      </div>

      {notice && (
        <div className="mb-5">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Details member={m} />
        <div className="space-y-6">
          {m.status === 'pending' && (
            <Decide member={m} onDone={(text) => setNotice({ tone: 'success', text })} />
          )}
          {m.status === 'rejected' && <Reopen member={m} />}
          {(m.status === 'active' || m.status === 'suspended') && (
            <Renew member={m} onDone={(text) => setNotice({ tone: 'success', text })} />
          )}
          <ResetPassword
            member={m}
            onIssued={(password) =>
              setNotice({
                tone: 'warning',
                text: (
                  <>
                    <strong>{t('staff.tempTitle', { name: m.fullName })}</strong>
                    <span
                      className="mt-2 block font-mono text-2xl tracking-wider"
                      data-testid="temporary-password"
                    >
                      {password}
                    </span>
                    {t('staff.tempBody')}
                  </>
                ),
              })
            }
          />
        </div>
      </div>

      <Payments member={m} />
    </>
  );
}

function Details({ member: m }: { member: MemberDetail }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const home = branches.data?.find((b) => b.id === m.branchId);
  const rows: [string, ReactNode][] = [
    [t('person.whatsappPhone'), m.whatsappPhone],
    [t('person.otherPhone'), m.otherPhone],
    [t('person.address'), m.address],
    [
      t('person.dateOfBirth'),
      m.dateOfBirth && `${m.dateOfBirth} (${t('members.age', { age: m.age })})`,
    ],
    [t('person.organisation'), m.organisation],
    [t('person.introducedByName'), m.introducedByName],
    [t('person.introducedByPhone'), m.introducedByPhone],
    [t('person.homeBranch'), home && `${home.name} (${home.code})`],
    [t('members.applied'), m.appliedAt?.slice(0, 10)],
    [t('members.approved'), m.approvedAt?.slice(0, 10)],
    [t('members.expires'), m.expireAt],
    ...(m.rejectionReason
      ? ([[t('members.rejectionReason'), m.rejectionReason]] as [string, ReactNode][])
      : []),
  ];
  return (
    <Card>
      <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-stone-600">{k}</dt>
            <dd className="font-medium break-words">{v || '—'}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** The branch fee, to pre-fill the amount at the counter. */
function useBranchFee(branchId: number | null): number | null {
  const q = useQuery({
    queryKey: branchKey(branchId ?? 0),
    queryFn: () => api(`/branches/${branchId}`, { schema: branchDetailSchema }),
    enabled: branchId !== null,
  });
  return q.data?.settings.annualFeeCents ?? null;
}

function useRefresh(id: number) {
  const queryClient = useQueryClient();
  return async (detail: MemberDetail) => {
    queryClient.setQueryData(memberKey(id), detail);
    await queryClient.invalidateQueries({ queryKey: MEMBERS_KEY });
  };
}

/** FR-AUT-17, FR-MEM-10, R18: approve at the counter with the person present, or reject. */
function Decide({ member, onDone }: { member: MemberDetail; onDone: (text: string) => void }) {
  const { t } = useTranslation();
  const { user } = useMe();
  const fee = useBranchFee(member.branchId);
  const refresh = useRefresh(member.id);
  const [checked, setChecked] = useState(false);
  const [waive, setWaive] = useState(false);
  const [amount, setAmount] = useState<string | null>(null);
  const [receipt, setReceipt] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownAmount = amount ?? (fee !== null ? formatRupees(fee) : '');

  const approve = useMutation({
    mutationFn: (body: unknown) =>
      api(`/applications/${member.id}/approve`, {
        method: 'POST',
        body,
        schema: memberDetailSchema,
      }),
    onSuccess: async (d) => {
      await refresh(d);
      onDone(t('members.approvedNotice', { date: d.expireAt }));
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  const reject = useMutation({
    mutationFn: (why: string) =>
      api(`/applications/${member.id}/reject`, {
        method: 'POST',
        body: { reason: why },
        schema: memberDetailSchema,
      }),
    onSuccess: async (d) => {
      await refresh(d);
      onDone(t('members.rejectedNotice'));
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (waive) {
      approve.mutate({ identityChecked: true, payment: { kind: 'waiver', reason } });
      return;
    }
    const cents = parseRupees(shownAmount);
    if (!cents || !receipt.trim()) {
      setError(t('members.feeIncomplete'));
      return;
    }
    approve.mutate({
      identityChecked: true,
      payment: { kind: 'first_fee', amountCents: cents, receiptNo: receipt },
    });
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('members.approveTitle')}</h2>
      <p className="mb-4 text-sm text-stone-600">{t('members.approveLead')}</p>
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {!rejecting ? (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <label className="flex gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>{t('members.identityChecked')}</span>
          </label>
          {user.userType === 'super_admin' && (
            <label className="flex gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={waive}
                onChange={(e) => setWaive(e.target.checked)}
              />
              <span>{t('members.waive')}</span>
            </label>
          )}
          {waive ? (
            <Field label={t('members.waiveReason')}>
              {({ id }) => (
                <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
            </Field>
          ) : (
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
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={!checked || approve.isPending || (waive && !reason.trim())}
            >
              {t('members.approve')}
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(true)}>
              {t('members.reject')}
            </Button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) reject.mutate(reason.trim());
          }}
          className="space-y-4"
        >
          <Field label={t('members.rejectReason')}>
            {({ id }) => (
              <Input id={id} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>
          <div className="flex gap-3">
            <Button type="submit" variant="danger" disabled={!reason.trim() || reject.isPending}>
              {t('members.confirmReject')}
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Reopen({ member }: { member: MemberDetail }) {
  const { t } = useTranslation();
  const refresh = useRefresh(member.id);
  const [error, setError] = useState<string | null>(null);
  const reopen = useMutation({
    mutationFn: () =>
      api(`/applications/${member.id}/reopen`, { method: 'POST', schema: memberDetailSchema }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(t, err)),
  });
  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('members.reopenTitle')}</h2>
      <p className="mb-4 text-sm text-stone-600">{t('members.reopenLead')}</p>
      {error && <Alert tone="error">{error}</Alert>}
      <Button variant="secondary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
        {t('members.reopen')}
      </Button>
    </Card>
  );
}

/** FR-MEM-02: the annual fee extends the membership by a year. */
function Renew({ member, onDone }: { member: MemberDetail; onDone: (text: string) => void }) {
  const { t } = useTranslation();
  const fee = useBranchFee(member.branchId);
  const refresh = useRefresh(member.id);
  const [amount, setAmount] = useState<string | null>(null);
  const [receipt, setReceipt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const shownAmount = amount ?? (fee !== null ? formatRupees(fee) : '');

  const renew = useMutation({
    mutationFn: (body: unknown) =>
      api(`/members/${member.id}/renew`, { method: 'POST', body, schema: memberDetailSchema }),
    onSuccess: async (d) => {
      await refresh(d);
      setReceipt('');
      onDone(t('members.renewedNotice', { date: d.expireAt }));
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = parseRupees(shownAmount);
    if (!cents || !receipt.trim()) {
      setError(t('members.feeIncomplete'));
      return;
    }
    renew.mutate({ amountCents: cents, receiptNo: receipt });
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('members.renewTitle')}</h2>
      <p className="mb-4 text-sm text-stone-600">
        {t('members.renewLead', { date: member.expireAt ?? '—' })}
      </p>
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label={t('members.annualFee')}>
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
        <div className="sm:col-span-2">
          <Button type="submit" disabled={renew.isPending}>
            {t('members.recordPayment')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ResetPassword({
  member,
  onIssued,
}: {
  member: MemberDetail;
  onIssued: (p: string) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: () =>
      api(`/users/${member.id}/reset-password`, {
        method: 'POST',
        schema: temporaryPasswordResponseSchema,
      }),
    onSuccess: (r) => onIssued(r.temporaryPassword),
    onError: (err) => setError(errorMessage(t, err)),
  });
  if (member.status === 'rejected') return null;
  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('staff.resetPassword')}</h2>
      <p className="mb-4 text-sm text-stone-600">{t('members.resetLead')}</p>
      {error && <Alert tone="error">{error}</Alert>}
      <Button variant="secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>
        {t('staff.resetPassword')}
      </Button>
    </Card>
  );
}

function ExportButtons({ id }: { id: number }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (format: 'txt' | 'pdf') => {
    setError(null);
    setBusy(true);
    try {
      await downloadMemberExport(id, format);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void run('pdf')}>
          {t('members.exportPdf')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void run('txt')}>
          {t('members.exportTxt')}
        </Button>
      </div>
      <p className="text-xs text-stone-600">{t('members.exportNote')}</p>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

function Payments({ member }: { member: MemberDetail }) {
  const { t } = useTranslation();
  return (
    <Card className="mt-6 overflow-x-auto p-0">
      <h2 className="px-5 pt-5 font-semibold">{t('members.payments')}</h2>
      {member.payments.length === 0 ? (
        <p className="p-5 text-stone-600">{t('members.noPayments')}</p>
      ) : (
        <table className="mt-3 w-full min-w-[560px] text-left text-sm">
          <thead className="border-y border-stone-200 bg-stone-50 text-xs text-stone-600 uppercase">
            <tr>
              <th className="px-4 py-2 font-medium">{t('members.paidOn')}</th>
              <th className="px-4 py-2 font-medium">{t('members.kind')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('members.amount')}</th>
              <th className="px-4 py-2 font-medium">{t('members.receiptOrReason')}</th>
              <th className="px-4 py-2 font-medium">{t('members.validUntil')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {member.payments.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 tabular-nums">{p.paidOn}</td>
                <td className="px-4 py-2">{t(`members.paymentKind.${p.kind}`)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  Rs {formatRupees(p.amountCents)}
                </td>
                <td className="px-4 py-2">{p.receiptNo ?? p.reason}</td>
                <td className="px-4 py-2 tabular-nums">{p.extendsTo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
