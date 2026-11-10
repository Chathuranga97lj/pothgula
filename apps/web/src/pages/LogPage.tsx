import {
  addDays,
  EXPORT_FORMATS,
  type ExportFormat,
  LOG_ACTION_GROUPS,
  LOG_ENTITIES,
  LOG_ROLES,
  type LogFilter,
  logFilterSchema,
  todayColombo,
} from '@pothgula/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { errorMessage } from '../api/errors';
import { downloadLog, useLog } from '../api/log';
import { useBranches } from '../api/queries';
import { useMe } from '../auth/auth';
import { LogList } from '../components/log';
import { Alert, Button, Card, Field, Input, PageTitle, Select } from '../components/ui';

type Form = Record<keyof LogFilter, string>;

const KEYS = ['from', 'to', 'actorId', 'role', 'branchId', 'action', 'entity', 'entityId'] as const;

const toForm = (f: LogFilter): Form =>
  Object.fromEntries(KEYS.map((k) => [k, f[k] === undefined ? '' : String(f[k])])) as Form;

/** The filter in the address: what is shown, and what a history tab links to. */
function useAppliedFilter() {
  const [params, setParams] = useSearchParams();
  const raw = Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? '']));
  const any = KEYS.some((k) => params.get(k));
  const parsed = logFilterSchema.safeParse(raw);
  // With nothing chosen, the last seven days.
  const filter: LogFilter = !any
    ? { from: addDays(todayColombo(), -6) }
    : parsed.success
      ? parsed.data
      : {};
  const apply = (f: LogFilter) =>
    setParams(
      Object.fromEntries(
        Object.entries(f)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ),
    );
  return { filter, apply, invalid: any && !parsed.success };
}

/** §14: the activity log, filtered (FR-LOG-07) and taken away as a file (FR-LOG-08). */
export function LogPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const isSuper = user.userType === 'super_admin';
  const branches = useBranches(isSuper);
  const { filter, apply, invalid } = useAppliedFilter();
  const [form, setForm] = useState<Form>(() => toForm(filter));
  const [formError, setFormError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const log = useLog(invalid ? null : filter);

  const set = (key: keyof Form) => (value: string) =>
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === 'entity' && !value ? { entityId: '' } : {}),
    }));

  const show = (next: Form) => {
    const parsed = logFilterSchema.safeParse(next);
    if (!parsed.success) {
      const where = parsed.error.issues[0]?.path[0];
      setFormError(
        where === 'to'
          ? t('log.badRange')
          : where === 'entityId'
            ? t('log.needKind')
            : t('log.badFilter'),
      );
      return;
    }
    setFormError(null);
    setExportError(null);
    setForm(toForm(parsed.data));
    apply(parsed.data);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    show(form);
  };

  const exportAs = async (format: ExportFormat) => {
    setExportError(null);
    setExporting(format);
    try {
      await downloadLog(filter, format);
    } catch (err) {
      setExportError(errorMessage(t, err));
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <PageTitle lead={isSuper ? t('log.leadSuper') : t('log.leadAdmin')}>
        {t('log.title')}
      </PageTitle>

      <Card className="mb-6">
        <form onSubmit={submit} className="space-y-4" aria-label={t('log.filter')}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('log.from')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={form.from}
                  onChange={(e) => set('from')(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('log.to')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={form.to}
                  onChange={(e) => set('to')(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('log.role')}>
              {({ id }) => (
                <Select id={id} value={form.role} onChange={(e) => set('role')(e.target.value)}>
                  <option value="">{t('log.anyone')}</option>
                  {LOG_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r === 'system' ? t('log.system') : t(`roles.${r}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {isSuper && (
              <Field label={t('log.branch')}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.branchId}
                    onChange={(e) => set('branchId')(e.target.value)}
                  >
                    <option value="">{t('log.everyBranch')}</option>
                    {(branches.data ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label={t('log.action')}>
              {({ id }) => (
                <Select id={id} value={form.action} onChange={(e) => set('action')(e.target.value)}>
                  <option value="">{t('log.anyAction')}</option>
                  {/* An exact action, reached from a link, stays choosable. */}
                  {form.action.includes('.') && (
                    <option value={form.action}>
                      {t(`logActions.${form.action}`, { defaultValue: form.action })}
                    </option>
                  )}
                  {LOG_ACTION_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {t(`log.groups.${g}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('log.recordKind')}>
              {({ id }) => (
                <Select id={id} value={form.entity} onChange={(e) => set('entity')(e.target.value)}>
                  <option value="">{t('log.anyRecord')}</option>
                  {LOG_ENTITIES.map((en) => (
                    <option key={en} value={en}>
                      {t(`log.entities.${en}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('log.recordNo')}>
              {({ id }) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  disabled={!form.entity}
                  value={form.entityId}
                  onChange={(e) => set('entityId')(e.target.value.trim())}
                />
              )}
            </Field>
            <Field label={t('log.person')} hint={t('log.personHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  aria-describedby={describedBy}
                  value={form.actorId}
                  onChange={(e) => set('actorId')(e.target.value.replace(/\D/g, ''))}
                />
              )}
            </Field>
          </div>
          {(formError || invalid) && <Alert tone="error">{formError ?? t('log.badFilter')}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit">{t('log.show')}</Button>
            <Button variant="ghost" onClick={() => show(toForm({}))}>
              {t('log.clear')}
            </Button>
          </div>
          <p className="text-xs text-stone-600">{t('log.readNote')}</p>
        </form>
      </Card>

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <h2 className="font-semibold">{t('log.entries')}</h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('log.exportAs')}>
            {EXPORT_FORMATS.map((f) => (
              <Button
                key={f}
                variant="secondary"
                disabled={exporting !== null || invalid}
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
        <LogList
          log={log}
          onPerson={(actorId) => show({ ...toForm(filter), actorId: String(actorId) })}
          onRecord={(entity, entityId) => show({ ...toForm(filter), entity, entityId })}
        />
      </Card>
    </>
  );
}
