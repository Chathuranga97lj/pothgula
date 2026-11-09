import {
  type ImportDecision,
  type ImportGroup,
  type ImportPreview,
  importPreviewSchema,
  type ImportResult,
  importResultSchema,
  IMPORT_COLUMNS,
  IMPORT_TEMPLATE,
} from '@pothgula/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CATALOGUE_KEY } from '../api/catalogue';
import { api, downloadFile, saveBlob } from '../api/client';
import { errorMessage } from '../api/errors';
import { useBranches } from '../api/queries';
import { useMe } from '../auth/auth';
import { Alert, Button, Card, Field, PageTitle, Select } from '../components/ui';

/** Excel opens a UTF-8 file correctly only with the byte-order mark. */
const BOM = '﻿';

function csvCell(value: string | number | null): string {
  const s = value === null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const needsReview = (g: ImportGroup) => g.candidates.length > 0 || g.similarKeys.length > 0;

/**
 * FR-CAT-13: bringing in the books already on the shelves. Check the file, decide
 * each probable duplicate, then import: every copy gets a new number, its old
 * number is kept, and the new spine labels are printed.
 */
export function ImportPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const queryClient = useQueryClient();
  const branches = useBranches(user.userType === 'super_admin');
  const [branchId, setBranchId] = useState<number | null>(user.branchId);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = (extra: Record<string, string> = {}) => {
    const body = new FormData();
    body.append('branchId', String(branchId));
    for (const [k, v] of Object.entries(extra)) body.append(k, v);
    body.append('file', file!);
    return body;
  };

  const check = useMutation({
    mutationFn: () =>
      api('/imports/preview', { method: 'POST', body: form(), schema: importPreviewSchema }),
    onMutate: () => {
      setError(null);
      setPreview(null);
      setDecisions({});
    },
    onSuccess: setPreview,
    onError: (err) => setError(errorMessage(t, err)),
  });
  const commit = useMutation({
    mutationFn: () =>
      api('/imports', {
        method: 'POST',
        body: form({ decisions: JSON.stringify(Object.values(decisions)) }),
        schema: importResultSchema,
      }),
    onMutate: () => setError(null),
    onSuccess: async (r) => {
      setResult(r);
      await queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY });
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || branchId === null) return setError(t('import.chooseFile'));
    check.mutate();
  }

  if (result) return <Done result={result} />;

  return (
    <div className="max-w-4xl">
      <p className="mb-2 text-sm">
        <Link to="/catalogue" className="text-emerald-800 underline">
          ← {t('catalogue.title')}
        </Link>
      </p>
      <PageTitle lead={t('import.lead')}>{t('import.title')}</PageTitle>

      <Card className="mb-6">
        <h2 className="mb-2 font-semibold">{t('import.howTitle')}</h2>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-stone-800">
          <li>{t('import.how1')}</li>
          <li>{t('import.how2', { columns: IMPORT_COLUMNS.join(', ') })}</li>
          <li>{t('import.how3')}</li>
        </ol>
        <Button
          variant="ghost"
          className="-ml-4"
          onClick={() =>
            saveBlob(
              new Blob([BOM + IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' }),
              'pothgula-import-template.csv',
            )
          }
        >
          {t('import.template')}
        </Button>
      </Card>

      <Card className="mb-6">
        <form onSubmit={submit} className="space-y-4" noValidate>
          {user.userType === 'super_admin' && (
            <Field label={t('import.branch')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={branchId ?? ''}
                  onChange={(e) => {
                    setBranchId(e.target.value ? Number(e.target.value) : null);
                    setPreview(null);
                  }}
                >
                  <option value="">{t('import.chooseBranch')}</option>
                  {(branches.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label={t('import.file')} hint={t('import.fileHint')}>
            {({ id, describedBy }) => (
              <input
                id={id}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                aria-describedby={describedBy}
                className="block w-full text-sm"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                }}
              />
            )}
          </Field>
          <Button type="submit" variant="secondary" disabled={check.isPending}>
            {check.isPending ? t('import.checking') : t('import.check')}
          </Button>
        </form>
      </Card>

      {error && (
        <div className="mb-6">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {preview && (
        <Review
          preview={preview}
          decisions={decisions}
          setDecisions={setDecisions}
          importing={commit.isPending}
          onImport={() => commit.mutate()}
        />
      )}
    </div>
  );
}

function Review({
  preview,
  decisions,
  setDecisions,
  importing,
  onImport,
}: {
  preview: ImportPreview;
  decisions: Record<string, ImportDecision>;
  setDecisions: (d: Record<string, ImportDecision>) => void;
  importing: boolean;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  if (preview.fileErrors.length > 0) {
    return (
      <Alert tone="error" title={t('import.fileProblem')}>
        <ul className="list-disc space-y-1 pl-5">
          {preview.fileErrors.map((code) => (
            <li key={code}>
              {t(`import.fileErrors.${code}`, { columns: preview.missingColumns.join(', ') })}
            </li>
          ))}
        </ul>
      </Alert>
    );
  }

  const byKey = new Map(preview.groups.map((g) => [g.key, g]));
  const review = preview.groups.filter(needsReview);
  const decided = review.filter((g) => decisions[g.key]).length;
  const copies = preview.groups.reduce((n, g) => n + g.lines.length, 0);
  const ready = preview.errors.length === 0 && decided === review.length && copies > 0;
  const decide = (d: ImportDecision) => setDecisions({ ...decisions, [d.key]: d });

  return (
    <div className="space-y-6">
      <Alert
        tone="info"
        title={t('import.summary', { rows: preview.rows, titles: preview.groups.length })}
      >
        {preview.ignoredColumns.length > 0 &&
          t('import.ignored', { columns: preview.ignoredColumns.join(', ') })}
      </Alert>

      {preview.errors.length > 0 && (
        <Card>
          <h2 className="mb-1 font-semibold text-red-900">
            {t('import.errorsTitle', { count: preview.errors.length })}
          </h2>
          <p className="mb-3 text-sm text-stone-700">{t('import.errorsLead')}</p>
          <div className="-mx-5 max-h-96 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-200 text-stone-600">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('import.line')}</th>
                  <th className="px-3 py-2 font-medium">{t('import.problem')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {preview.errors.map((e, n) => (
                  <tr key={n}>
                    <td className="px-3 py-2 tabular-nums">{e.line}</td>
                    <td className="px-3 py-2">
                      {t(`import.errors.${e.code}`, { value: e.value })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {review.length > 0 && (
        <section className="space-y-4" aria-label={t('import.reviewTitle')}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{t('import.reviewTitle')}</h2>
              <p className="text-sm text-stone-700">{t('import.reviewLead')}</p>
            </div>
            <p className="text-sm font-medium tabular-nums" data-testid="decided">
              {t('import.decided', { done: decided, total: review.length })}
            </p>
          </div>
          {review.map((g) => (
            <ReviewCard
              key={g.key}
              group={g}
              byKey={byKey}
              value={decisions[g.key]}
              onChange={decide}
            />
          ))}
          {decided < review.length && (
            <Button
              variant="ghost"
              className="-ml-4"
              onClick={() =>
                setDecisions({
                  ...Object.fromEntries(
                    review.map((g) => [g.key, { key: g.key, action: 'new' as const }]),
                  ),
                  ...decisions,
                })
              }
            >
              {t('import.restAreNew', { count: review.length - decided })}
            </Button>
          )}
        </section>
      )}

      <Card>
        <p className="mb-3 text-stone-800">
          {t('import.ready', { copies, titles: preview.groups.length - review.length })}
        </p>
        <Button disabled={!ready || importing} onClick={onImport}>
          {importing ? t('import.importing') : t('import.import', { count: copies })}
        </Button>
        {!ready && preview.errors.length === 0 && (
          <p className="mt-2 text-sm text-stone-600">{t('import.decideFirst')}</p>
        )}
      </Card>
    </div>
  );
}

function ReviewCard({
  group: g,
  byKey,
  value,
  onChange,
}: {
  group: ImportGroup;
  byKey: Map<string, ImportGroup>;
  value: ImportDecision | undefined;
  onChange: (d: ImportDecision) => void;
}) {
  const { t } = useTranslation();
  const name = `decision-${g.key}`;
  const option = (id: string, label: ReactNode, d: ImportDecision) => (
    <label key={id} className="flex gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-stone-50">
      <input
        type="radio"
        name={name}
        className="mt-1"
        checked={JSON.stringify(value) === JSON.stringify(d)}
        onChange={() => onChange(d)}
      />
      <span>{label}</span>
    </label>
  );
  return (
    <Card>
      <fieldset>
        <legend className="mb-2">
          <span className="font-semibold">{g.title}</span>
          {g.writer && <span className="text-stone-700"> · {g.writer}</span>}
          <span className="block text-sm text-stone-600">
            {t('import.lines', { lines: g.lines.join(', '), count: g.lines.length })}
            {g.isbn && ` · ISBN ${g.isbn}`} · {g.categoryCode}
          </span>
        </legend>
        <div className="space-y-1">
          {option('new', t('import.asNew'), { key: g.key, action: 'new' })}
          {g.candidates.map((c) =>
            option(
              `t${c.titleId}`,
              <>
                {t('import.asExisting')}{' '}
                <Link to={`/titles/${c.titleId}`} target="_blank" className="font-medium underline">
                  {c.title}
                </Link>
                {c.writer && ` · ${c.writer}`} · {t('import.copiesHeld', { count: c.copies })} ·{' '}
                <span className="text-stone-600">{t(`import.reason.${c.reason}`)}</span>
              </>,
              { key: g.key, action: 'existing', titleId: c.titleId },
            ),
          )}
          {g.similarKeys.map((k) => {
            const other = byKey.get(k)!;
            return option(
              k,
              <>
                {t('import.asSameAs')} <span className="font-medium">{other.title}</span>
                {other.writer && ` · ${other.writer}`} ·{' '}
                <span className="text-stone-600">
                  {t('import.lines', { lines: other.lines.join(', '), count: other.lines.length })}
                </span>
              </>,
              { key: g.key, action: 'merge', intoKey: k },
            );
          })}
        </div>
      </fieldset>
    </Card>
  );
}

function Done({ result }: { result: ImportResult }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const labels = useMutation({
    mutationFn: () =>
      downloadFile('/labels', 'spine-labels.pdf', {
        accessionNumbers: result.copies.map((c) => c.accessionNo),
      }),
    onMutate: () => setError(null),
    onError: (err) => setError(errorMessage(t, err)),
  });
  const mapping = () => {
    const lines = [
      ['line', 'old_number', 'accession_no', 'title'].join(','),
      ...result.copies.map((c) =>
        [c.line, c.oldNumber, c.accessionNo, c.title].map(csvCell).join(','),
      ),
    ];
    saveBlob(
      new Blob([BOM + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }),
      'old-and-new-numbers.csv',
    );
  };
  return (
    <div className="max-w-3xl space-y-6">
      <PageTitle>{t('import.doneTitle')}</PageTitle>
      <Alert tone="success" title={t('import.done', { count: result.copies.length })}>
        {t('import.doneBody', { created: result.titlesCreated, added: result.titlesAddedTo })}
      </Alert>
      <Card>
        <p className="mb-4 text-stone-800">{t('import.nextSteps')}</p>
        <div className="flex flex-wrap gap-3">
          <Button disabled={labels.isPending} onClick={() => labels.mutate()}>
            {t('import.labels')}
          </Button>
          <Button variant="secondary" onClick={mapping}>
            {t('import.mapping')}
          </Button>
          <Link
            to="/catalogue"
            className="inline-flex min-h-10 items-center px-2 text-sm font-medium text-emerald-900 underline"
          >
            {t('import.toCatalogue')}
          </Link>
        </div>
        {error && (
          <div className="mt-3">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
      </Card>
      <Card>
        <div className="-mx-5 max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 text-stone-600">
              <tr>
                <th className="px-3 py-2 font-medium">{t('import.oldNumber')}</th>
                <th className="px-3 py-2 font-medium">{t('import.newNumber')}</th>
                <th className="px-3 py-2 font-medium">{t('loans.book')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {result.copies.slice(0, 200).map((c) => (
                <tr key={c.accessionNo}>
                  <td className="px-3 py-2 font-mono text-xs">{c.oldNumber ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.accessionNo}</td>
                  <td className="px-3 py-2">
                    <Link to={`/titles/${c.titleId}`} className="underline">
                      {c.title}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.copies.length > 200 && (
          <p className="mt-3 text-sm text-stone-600">
            {t('import.more', { count: result.copies.length - 200 })}
          </p>
        )}
      </Card>
    </div>
  );
}
