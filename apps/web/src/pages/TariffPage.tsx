import { EXPORT_FORMATS, type ExportFormat, formatRupees, parseRupees } from '@pothgula/shared';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { errorMessage } from '../api/errors';
import { downloadTariff, useSaveTariff, useTariff } from '../api/settlements';
import { Alert, Button, Card, Input, PageTitle } from '../components/ui';

/**
 * FR-LST-16: a branch's lost-book tariff — an amount per category, kept by the
 * branch's admins and super admins, every change logged, printable for the counter.
 */
export function TariffPage() {
  const { t } = useTranslation();
  const branchId = Number(useParams().branchId);
  const tariff = useTariff(branchId);
  // What staff have typed; a category not typed in shows its saved amount.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const save = useSaveTariff(branchId, () => {
    setEdits({});
    setNotice(t('tariff.saved'));
  });
  const download = useMutation({
    mutationFn: (format: ExportFormat) => downloadTariff(branchId, format),
    onError: (err) => setError(errorMessage(t, err)),
  });

  if (tariff.isError) return <Alert tone="error">{errorMessage(t, tariff.error)}</Alert>;
  if (!tariff.data) return <p className="text-stone-600">{t('common.loading')}</p>;
  const { branch, rows } = tariff.data;
  const valueOf = (code: string, cents: number | null) =>
    edits[code] ?? (cents === null ? '' : formatRupees(cents));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const amounts = [];
    for (const r of rows) {
      const text = valueOf(r.categoryCode, r.amountCents).trim();
      const cents = text === '' ? null : parseRupees(text);
      if (text !== '' && cents === null) {
        return setError(t('tariff.badAmount', { category: r.categoryCode }));
      }
      if (cents !== r.amountCents)
        amounts.push({ categoryCode: r.categoryCode, amountCents: cents });
    }
    if (amounts.length === 0) return setError(t('errors.nothing_to_change'));
    save.mutate({ amounts }, { onError: (err) => setError(errorMessage(t, err)) });
  }

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/lost-books" className="text-emerald-800 underline">
          ← {t('settlements.boardTitle')}
        </Link>
      </p>
      <PageTitle lead={t('tariff.lead')}>
        {t('tariff.title', { branch: `${branch.code} — ${branch.name}` })}
      </PageTitle>
      <div className="mb-5 flex flex-wrap gap-2">
        {EXPORT_FORMATS.map((f) => (
          <Button
            key={f}
            variant="secondary"
            disabled={download.isPending}
            onClick={() => download.mutate(f)}
          >
            {t(`log.export.${f}`)}
          </Button>
        ))}
      </div>
      <form onSubmit={submit} className="max-w-2xl space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-600">
                <th className="px-4 py-2 font-medium">{t('tariff.category')}</th>
                <th className="px-4 py-2 font-medium">{t('tariff.amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.categoryCode}>
                  <td className="px-4 py-2">
                    <span className="font-mono">{r.categoryCode}</span>{' '}
                    <label htmlFor={`tariff-${r.categoryCode}`}>{r.categoryName}</label>
                    {!r.categoryActive && (
                      <span className="ml-2 text-xs text-stone-500">{t('tariff.retired')}</span>
                    )}
                    {r.updatedByName && (
                      <p className="text-xs text-stone-500">
                        {t('tariff.changed', {
                          name: r.updatedByName,
                          date: r.updatedAt?.slice(0, 10),
                        })}
                      </p>
                    )}
                  </td>
                  <td className="w-40 px-4 py-2">
                    <Input
                      id={`tariff-${r.categoryCode}`}
                      inputMode="decimal"
                      placeholder={t('tariff.none')}
                      value={valueOf(r.categoryCode, r.amountCents)}
                      onChange={(e) =>
                        setEdits((v) => ({ ...v, [r.categoryCode]: e.target.value }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="text-sm text-stone-600">{t('tariff.blankHint')}</p>
        <Button type="submit" disabled={save.isPending}>
          {t('tariff.save')}
        </Button>
      </form>
    </>
  );
}
