import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { downloadFile } from '../api/client';
import { errorMessage } from '../api/errors';
import { Button } from './ui';

/** FR-MEM-07: the receipt for one payment, as a PDF to print or hand over. */
export function ReceiptButton({
  kind,
  paymentId,
}: {
  kind: 'membership' | 'settlement';
  paymentId: number;
}) {
  const { t } = useTranslation();
  const download = useMutation({
    mutationFn: () => downloadFile(`/receipts/${kind}/${paymentId}`, `receipt-${paymentId}.pdf`),
  });
  return (
    <span className="inline-flex flex-col">
      <Button
        variant="ghost"
        className="min-h-8 px-2 py-1 text-xs"
        disabled={download.isPending}
        onClick={() => download.mutate()}
      >
        {t('receipts.print')}
      </Button>
      {download.error && (
        <span className="text-xs text-red-800">{errorMessage(t, download.error)}</span>
      )}
    </span>
  );
}
