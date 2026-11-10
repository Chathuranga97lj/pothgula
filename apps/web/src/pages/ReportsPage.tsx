import {
  EXPORT_FORMATS,
  type ExportFormat,
  PERIOD_REPORTS,
  REPORT_KINDS,
  type Report,
  type ReportCell,
  type ReportKind,
} from '@pothgula/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { errorMessage } from '../api/errors';
import { downloadReport, useReport } from '../api/reports';
import { useBranches, useCategories } from '../api/queries';
import { useMe } from '../auth/auth';
import { Alert, Button, Card, Field, Input, PageTitle, Select } from '../components/ui';

/** §15: the reports there are, each with a line on what it answers. */
export function ReportsPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  return (
    <>
      <PageTitle
        lead={user.userType === 'super_admin' ? t('reports.leadSuper') : t('reports.leadAdmin')}
      >
        {t('reports.title')}
      </PageTitle>
      <ul className="grid gap-4 sm:grid-cols-2">
        {REPORT_KINDS.map((kind) => (
          <li key={kind}>
            <Link
              to={`/reports/${kind}`}
              className="block h-full rounded-lg border border-stone-200 bg-white p-5 shadow-sm hover:border-emerald-700"
            >
              <h2 className="font-semibold text-emerald-900">{t(`reports.names.${kind}`)}</h2>
              <p className="mt-1 text-sm text-stone-600">{t(`reports.leads.${kind}`)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The choices that shape a report, kept in the address so a report can be shared or reopened. */
const CHOICES = ['branchId', 'from', 'to', 'order', 'category', 'by'] as const;

/** One report, its choices, and its downloads (FR-RPT-09, FR-RPT-10). */
export function ReportPage() {
  const { kind } = useParams();
  if (!REPORT_KINDS.includes(kind as ReportKind)) return <Navigate to="/reports" replace />;
  return <ReportView kind={kind as ReportKind} />;
}

function ReportView({ kind }: { kind: ReportKind }) {
  const { t } = useTranslation();
  const { user } = useMe();
  const isSuper = user.userType === 'super_admin';
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams(
    CHOICES.flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : [])),
  ).toString();
  const report = useReport(kind, query);
  const branches = useBranches(isSuper);
  const categories = useCategories();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const choose = (key: (typeof CHOICES)[number], value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const r = report.data;
  const wholeLibrary = isSuper && !params.get('branchId');

  const exportAs = async (format: ExportFormat) => {
    setExportError(null);
    setExporting(true);
    try {
      await downloadReport(kind, query, format);
    } catch (err) {
      setExportError(errorMessage(t, err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/reports" className="text-emerald-800 underline">
          ← {t('reports.title')}
        </Link>
      </p>
      <PageTitle lead={t(`reports.leads.${kind}`)}>{t(`reports.names.${kind}`)}</PageTitle>

      <Card className="mb-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {isSuper && (
            <Field label={t('reports.branch')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={params.get('branchId') ?? ''}
                  onChange={(e) => choose('branchId', e.target.value)}
                >
                  <option value="">{t('reports.wholeLibrary')}</option>
                  {(branches.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {PERIOD_REPORTS.includes(kind) && (
            <>
              <Field label={t('reports.from')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={params.get('from') ?? r?.from ?? ''}
                    onChange={(e) => choose('from', e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('reports.to')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={params.get('to') ?? r?.to ?? ''}
                    onChange={(e) => choose('to', e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
          {kind === 'popular' && (
            <>
              <Field label={t('reports.order')}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={params.get('order') ?? 'most'}
                    onChange={(e) =>
                      choose('order', e.target.value === 'most' ? '' : e.target.value)
                    }
                  >
                    <option value="most">{t('reports.most')}</option>
                    <option value="least">{t('reports.least')}</option>
                  </Select>
                )}
              </Field>
              <Field label={t('reports.category')}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={params.get('category') ?? ''}
                    onChange={(e) => choose('category', e.target.value)}
                  >
                    <option value="">{t('reports.allCategories')}</option>
                    {(categories.data ?? []).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
          {kind === 'stock' && wholeLibrary && (
            <Field label={t('reports.by')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={params.get('by') ?? 'category'}
                  onChange={(e) =>
                    choose('by', e.target.value === 'category' ? '' : e.target.value)
                  }
                >
                  <option value="category">{t('reports.byCategory')}</option>
                  <option value="branch">{t('reports.byBranch')}</option>
                </Select>
              )}
            </Field>
          )}
        </div>
      </Card>

      <Card className="min-w-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-stone-600">
            {r &&
              (r.from
                ? t('reports.period', { from: r.from, to: r.to })
                : t('reports.asAt', { date: r.today }))}
            {r &&
              ` · ${r.branch ? `${r.branch.branchCode} — ${r.branch.branchName}` : t('reports.wholeLibrary')}`}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('reports.exportAs')}>
            {EXPORT_FORMATS.map((f) => (
              <Button
                key={f}
                variant="secondary"
                disabled={exporting || !r}
                onClick={() => void exportAs(f)}
              >
                {t(`log.export.${f}`)}
              </Button>
            ))}
          </div>
        </div>
        {exportError && (
          <div className="px-5 pb-4">
            <Alert tone="error">{exportError}</Alert>
          </div>
        )}
        {report.isError && (
          <div className="px-5 pb-4">
            <Alert tone="error">{errorMessage(t, report.error)}</Alert>
          </div>
        )}
        {!r && !report.isError && <p className="px-5 pb-5 text-stone-600">{t('common.loading')}</p>}
        {r && <ReportTable report={r} />}
      </Card>
    </>
  );
}

/** Columns whose cell opens the row's record. */
const LINK_COLUMNS = ['title', 'member'];

function ReportTable({ report: r }: { report: Report }) {
  const { t } = useTranslation();
  if (r.rows.length === 0) return <p className="px-5 pb-5 text-stone-600">{t('reports.none')}</p>;
  // Branch and category codes are headings of their own; the rest are worded.
  const heading = (key: string, label: string) =>
    key.includes(':') ? label : t(`reports.columns.${key}`, { defaultValue: label });
  const linkAt = Math.max(
    0,
    r.columns.findIndex((c) => LINK_COLUMNS.includes(c.key)),
  );
  const show = (v: ReportCell) => (v === null || v === '' ? '—' : String(v));
  const cell = 'px-4 py-2';
  return (
    <div className="overflow-x-auto border-t border-stone-200">
      <table
        className="w-full text-left text-sm"
        // Room for each column; on a phone the table scrolls inside its card.
        style={{ minWidth: `${Math.min(r.columns.length * 110, 960)}px` }}
      >
        <thead className="bg-stone-50 text-xs text-stone-600 uppercase">
          <tr>
            {r.columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`${cell} font-medium ${c.numeric ? 'text-right' : ''}`}
              >
                {heading(c.key, c.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {r.rows.map((row, i) => (
            <tr key={i}>
              {row.cells.map((v, j) => {
                const numeric = r.columns[j]?.numeric;
                const text =
                  j === 0 && row.key
                    ? t(`reports.rows.${row.key}`, { defaultValue: show(v) })
                    : show(v);
                return (
                  <td
                    key={j}
                    className={`${cell} ${numeric ? 'text-right tabular-nums' : ''} ${j === 0 && row.key ? 'text-stone-700' : ''}`}
                  >
                    {row.link && j === linkAt ? (
                      <Link to={row.link} className="text-emerald-800 underline">
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {r.total && (
          <tfoot className="border-t-2 border-stone-200 font-semibold">
            <tr>
              {r.total.map((v, j) => (
                <td
                  key={j}
                  className={`${cell} ${r.columns[j]?.numeric ? 'text-right tabular-nums' : ''}`}
                >
                  {j === 0 ? t('reports.total') : show(v)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
