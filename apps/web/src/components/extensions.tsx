import {
  EXTENSION_URGENT_DAYS,
  addDays,
  type Loan,
  loanSchema,
  todayColombo,
} from '@pothgula/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { LOANS_KEY } from '../api/loans';
import { LOG_KEY } from '../api/log';
import { Alert, Button, Card, Field, Input } from './ui';

/** Waiting, and due within two days or already past: decide it first (FR-CIR-13). */
export function isUrgent(loan: Loan, today = todayColombo()): boolean {
  return (
    loan.extensionStatus === 'requested' && loan.dueDate <= addDays(today, EXTENSION_URGENT_DAYS)
  );
}

/** A loan's extension in a few words, under its due date (FR-CIR-09). */
export function ExtensionNote({ loan }: { loan: Loan }) {
  const { t } = useTranslation();
  switch (loan.extensionStatus) {
    case 'none':
      return null;
    case 'requested':
      return <span className="block text-xs text-amber-800">{t('extensions.note.requested')}</span>;
    case 'approved':
      return (
        <span className="block text-xs text-stone-600">
          {t('extensions.note.approved', { date: loan.originalDueDate })}
        </span>
      );
    case 'declined':
      return <span className="block text-xs text-stone-600">{t('extensions.note.declined')}</span>;
  }
}

/** Every change to an extension refreshes the loans, the panels and the log views. */
function useExtensionChange(onDone?: (loan: Loan) => void) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api(path, { method: 'POST', body: body ?? {}, schema: loanSchema }),
    onSuccess: async (loan) => {
      setError(null);
      await client.invalidateQueries({ queryKey: LOANS_KEY });
      await client.invalidateQueries({ queryKey: LOG_KEY });
      onDone?.(loan);
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  return { change, error };
}

/** FR-CIR-10: on the member's own list — ask, withdraw, or see the decision. */
export function OwnExtension({ loan }: { loan: Loan }) {
  const { t } = useTranslation();
  const { change, error } = useExtensionChange();
  if (loan.status !== 'open') return null;
  const ask = loan.extensionStatus === 'none' && !loan.overdue && loan.dueDate >= todayColombo();
  return (
    <div className="mt-2 space-y-1">
      {ask && (
        <Button
          variant="secondary"
          className="min-h-8 px-3 py-1 text-xs"
          disabled={change.isPending}
          onClick={() => change.mutate({ path: `/me/loans/${loan.id}/extension` })}
        >
          {t('extensions.ask')}
        </Button>
      )}
      {loan.extensionStatus === 'requested' && (
        <Button
          variant="ghost"
          className="min-h-8 px-2 py-1 text-xs"
          disabled={change.isPending}
          onClick={() => change.mutate({ path: `/me/loans/${loan.id}/extension/cancel` })}
        >
          {t('extensions.withdraw')}
        </Button>
      )}
      {loan.extensionStatus === 'declined' && loan.extensionReason && (
        <p className="text-xs text-stone-700">
          {t('extensions.declinedBecause', { reason: loan.extensionReason })}
        </p>
      )}
      {error && <p className="text-xs text-red-800">{error}</p>}
    </div>
  );
}

/** Approve, or decline with the reason the member will see. */
export function DecideExtension({
  loan,
  onDone,
}: {
  loan: Loan;
  onDone?: (loan: Loan, approved: boolean) => void;
}) {
  const { t } = useTranslation();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const { change, error } = useExtensionChange((l) =>
    onDone?.(l, l.extensionStatus === 'approved'),
  );

  function decline(e: FormEvent) {
    e.preventDefault();
    if (reason.trim()) {
      change.mutate({ path: `/loans/${loan.id}/extension/decline`, body: { reason } });
    }
  }

  return (
    <div className="space-y-2">
      {!declining ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={change.isPending}
            onClick={() => change.mutate({ path: `/loans/${loan.id}/extension/approve` })}
          >
            {t('extensions.approve')}
          </Button>
          <Button variant="secondary" onClick={() => setDeclining(true)}>
            {t('extensions.decline')}
          </Button>
        </div>
      ) : (
        <form onSubmit={decline} className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Field label={t('extensions.reason')} hint={t('extensions.reasonHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  autoFocus
                  aria-describedby={describedBy}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Button type="submit" variant="danger" disabled={!reason.trim() || change.isPending}>
            {t('extensions.confirmDecline')}
          </Button>
          <Button variant="ghost" onClick={() => setDeclining(false)}>
            {t('common.cancel')}
          </Button>
        </form>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/** FR-CIR-10, FR-CIR-11: the extension on the loan record. */
export function ExtensionCard({ loan, onDone }: { loan: Loan; onDone: (text: string) => void }) {
  const { t } = useTranslation();
  const grant = useExtensionChange(() => onDone(t('extensions.granted')));
  if (loan.status !== 'open' && loan.extensionStatus === 'none') return null;

  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('extensions.title')}</h2>
      {loan.extensionStatus === 'requested' && (
        <>
          <p className="mb-3 text-sm text-stone-700">
            {t('extensions.waitingSince', { date: loan.extensionRequestedAt?.slice(0, 10) })}
            {isUrgent(loan) && (
              <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-900">
                {t('extensions.urgent')}
              </span>
            )}
          </p>
          {loan.status === 'open' && (
            <DecideExtension
              loan={loan}
              onDone={(_, approved) =>
                onDone(approved ? t('extensions.approvedNotice') : t('extensions.declinedNotice'))
              }
            />
          )}
        </>
      )}
      {loan.extensionStatus === 'approved' && (
        <p className="text-sm text-stone-700">
          {t('extensions.approvedOn', {
            date: loan.extensionDecidedAt?.slice(0, 10),
            from: loan.originalDueDate,
            to: loan.dueDate,
          })}
          {loan.extensionRequestedAt === null && ` ${t('extensions.grantedAtCounter')}`}
        </p>
      )}
      {loan.extensionStatus === 'declined' && (
        <p className="mb-3 text-sm text-stone-700">
          {t('extensions.declinedOn', {
            date: loan.extensionDecidedAt?.slice(0, 10),
            reason: loan.extensionReason,
          })}
        </p>
      )}
      {loan.status === 'open' &&
        (loan.extensionStatus === 'none' || loan.extensionStatus === 'declined') && (
          <>
            <p className="mb-3 text-sm text-stone-600">{t('extensions.grantLead')}</p>
            <Button
              variant="secondary"
              disabled={grant.change.isPending}
              onClick={() => grant.change.mutate({ path: `/loans/${loan.id}/extension` })}
            >
              {t('extensions.grant')}
            </Button>
            {grant.error && (
              <div className="mt-3">
                <Alert tone="error">{grant.error}</Alert>
              </div>
            )}
          </>
        )}
    </Card>
  );
}
