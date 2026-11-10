import { formatRupees, type MemberDetail, memberDetailSchema } from '@pothgula/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { memberKey } from '../api/members';
import { useMe } from '../auth/auth';
import { ReceiptButton } from './receipts';
import { Alert, Button, Card, Field, Input } from './ui';

/**
 * FR-MEM-05, FR-MEM-07: every membership payment, never edited — a mistake shows
 * as a reversing entry beside the payment it reverses. A receipt for each one
 * that took money; a super admin may reverse a renewal from the staff side.
 */
export function PaymentList({ member, staff }: { member: MemberDetail; staff: boolean }) {
  const { t } = useTranslation();
  const { user } = useMe();
  const client = useQueryClient();
  const [reversing, setReversing] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const reverse = useMutation({
    mutationFn: (paymentId: number) =>
      api(`/members/${member.id}/payments/${paymentId}/reverse`, {
        method: 'POST',
        body: { reason: reason.trim() },
        schema: memberDetailSchema,
      }),
    onSuccess: async (detail) => {
      client.setQueryData(memberKey(member.id), detail);
      await client.invalidateQueries({ queryKey: ['members'] });
      await client.invalidateQueries({ queryKey: ['log'] });
      setReversing(null);
      setReason('');
    },
  });
  const reversed = new Set(member.payments.map((p) => p.reversesPaymentId).filter(Boolean));
  const mayReverse = staff && user.userType === 'super_admin';

  return (
    <Card className="mt-6 overflow-x-auto p-0">
      <h2 className="px-5 pt-5 font-semibold">{t('members.payments')}</h2>
      {member.payments.length === 0 ? (
        <p className="p-5 text-stone-600">{t('members.noPayments')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-200 text-sm">
          {member.payments.map((p) => (
            <li key={p.id} className="space-y-2 px-5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div
                  className={`min-w-0 ${reversed.has(p.id) ? 'text-stone-500 line-through' : ''}`}
                >
                  <p className="font-medium">
                    {t(`members.paymentKind.${p.kind}`)} ·{' '}
                    <span className="tabular-nums">Rs {formatRupees(p.amountCents)}</span>
                  </p>
                  <p className="text-stone-600 tabular-nums">
                    {p.paidOn}
                    {p.receiptNo && ` · ${t('settlements.receipt', { no: p.receiptNo })}`}
                    {p.extendsTo && ` · ${t('payments.validTo', { date: p.extendsTo })}`}
                  </p>
                  {p.reason && <p className="text-stone-700 no-underline">{p.reason}</p>}
                </div>
                <div className="flex items-center gap-1">
                  {p.kind !== 'waiver' && <ReceiptButton kind="membership" paymentId={p.id} />}
                  {mayReverse && p.kind === 'fee' && !reversed.has(p.id) && reversing === null && (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 py-1 text-xs"
                      onClick={() => setReversing(p.id)}
                    >
                      {t('payments.reverse')}
                    </Button>
                  )}
                </div>
              </div>
              {reversing === p.id && (
                <form
                  className="space-y-2"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    reverse.mutate(p.id);
                  }}
                >
                  <p className="text-stone-700">{t('payments.reverseLead')}</p>
                  <Field label={t('payments.reverseReason')}>
                    {({ id }) => (
                      <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />
                    )}
                  </Field>
                  {reverse.error && <Alert tone="error">{errorMessage(t, reverse.error)}</Alert>}
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      variant="danger"
                      disabled={!reason.trim() || reverse.isPending}
                    >
                      {t('payments.reverse')}
                    </Button>
                    <Button variant="ghost" onClick={() => setReversing(null)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
