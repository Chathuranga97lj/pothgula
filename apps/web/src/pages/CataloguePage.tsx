import type { BranchSummary, TitleSummary } from '@pothgula/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCatalogue, useDebounced } from '../api/catalogue';
import { errorMessage } from '../api/errors';
import { useBranches, useCategories } from '../api/queries';
import { useMe } from '../auth/auth';
import { Alert, Button, Input, PageTitle, Select } from '../components/ui';

/** FR-CAT-05 – FR-CAT-07: browse and search, home branch first; any branch on request. */
export function CataloguePage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const isStaff = user.userType !== 'member';
  const branches = useBranches();
  const categories = useCategories();
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState<number | null>(user.branchId);
  const [category, setCategory] = useState('');
  const [available, setAvailable] = useState(false);
  const [page, setPage] = useState(0);
  const query = useDebounced(q);
  const result = useCatalogue({ q: query, branchId, category, available, page });
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(0);
    };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle lead={t('catalogue.lead')}>{t('catalogue.title')}</PageTitle>
        {isStaff && (
          <Link
            to="/titles/new"
            className="inline-flex min-h-10 items-center rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900"
          >
            {t('catalogue.addTitle')}
          </Link>
        )}
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Input
          type="search"
          aria-label={t('catalogue.search')}
          placeholder={t('catalogue.searchPlaceholder')}
          value={q}
          onChange={(e) => reset(setQ)(e.target.value)}
        />
        <Select
          aria-label={t('catalogue.branch')}
          value={branchId ?? ''}
          onChange={(e) => reset(setBranchId)(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{t('catalogue.allBranches')}</option>
          {branches.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('catalogue.category')}
          value={category}
          onChange={(e) => reset(setCategory)(e.target.value)}
        >
          <option value="">{t('catalogue.allCategories')}</option>
          {categories.data
            ?.filter((c) => c.isActive || c.inUse)
            .map((c) => (
              <option key={c.code} value={c.code}>
                {isStaff ? `${c.code} — ` : ''}
                {c.name}
              </option>
            ))}
        </Select>
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => reset(setAvailable)(e.target.checked)}
          />
          {t('catalogue.onShelfOnly')}
        </label>
      </div>

      {result.isError && <Alert tone="error">{errorMessage(t, result.error)}</Alert>}
      {result.data?.titles.length === 0 && <p className="text-stone-600">{t('catalogue.none')}</p>}
      <ul className="space-y-3">
        {result.data?.titles.map((title) => (
          <TitleLine key={title.id} title={title} branches={branches.data ?? []} focus={branchId} />
        ))}
      </ul>
      {result.data && (result.data.more || page > 0) && (
        <div className="mt-5 flex gap-3">
          {page > 0 && (
            <Button variant="secondary" onClick={() => setPage((p) => p - 1)}>
              {t('catalogue.previous')}
            </Button>
          )}
          {result.data.more && (
            <Button variant="secondary" onClick={() => setPage((p) => p + 1)}>
              {t('catalogue.next')}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function TitleLine({
  title,
  branches,
  focus,
}: {
  title: TitleSummary;
  branches: BranchSummary[];
  focus: number | null;
}) {
  const { t } = useTranslation();
  const name = (id: number) => branches.find((b) => b.id === id)?.name ?? '';
  const holdings = focus ? title.holdings.filter((h) => h.branchId === focus) : title.holdings;
  const elsewhere = focus
    ? title.holdings.filter((h) => h.branchId !== focus && h.onShelf > 0)
    : [];
  return (
    <li>
      <Link
        to={`/titles/${title.id}`}
        className="block rounded-lg border border-stone-200 bg-white p-4 shadow-sm hover:border-emerald-700"
      >
        <p className="font-semibold text-emerald-900">{title.title}</p>
        <p className="text-sm text-stone-700">
          {[title.writer, title.categoryName].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {holdings.length === 0 && (
            <span className="text-stone-500">{t('catalogue.noCopies')}</span>
          )}
          {holdings.map((h) => (
            <span
              key={h.branchId}
              className={h.onShelf > 0 ? 'text-emerald-800' : 'text-stone-600'}
            >
              {t('catalogue.holding', {
                branch: name(h.branchId),
                onShelf: h.onShelf,
                total: h.total,
              })}
            </span>
          ))}
          {elsewhere.length > 0 && (
            <span className="text-stone-600">
              {t('catalogue.alsoAt', {
                branches: elsewhere.map((h) => name(h.branchId)).join(', '),
              })}
            </span>
          )}
        </p>
      </Link>
    </li>
  );
}
