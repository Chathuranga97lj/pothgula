import type { BranchSummary } from '@pothgula/shared';
import { useTranslation } from 'react-i18next';
import { Field, Input, Select } from './ui';

/** The details a person gives about themselves (FR-AUT-03). */
export interface PersonForm {
  fullName: string;
  address: string;
  whatsappPhone: string;
  otherPhone: string;
  dateOfBirth: string;
  organisation: string;
  introducedByName: string;
  introducedByPhone: string;
  homeBranchId: string;
}

export const emptyPerson: PersonForm = {
  fullName: '',
  address: '',
  whatsappPhone: '',
  otherPhone: '',
  dateOfBirth: '',
  organisation: '',
  introducedByName: '',
  introducedByPhone: '',
  homeBranchId: '',
};

/** The form values as the API expects them; the shared schema does the checking. */
export function personBody(f: PersonForm) {
  return {
    fullName: f.fullName,
    address: f.address,
    whatsappPhone: f.whatsappPhone,
    otherPhone: f.otherPhone,
    dateOfBirth: f.dateOfBirth,
    organisation: f.organisation,
    introducedByName: f.introducedByName,
    introducedByPhone: f.introducedByPhone,
    homeBranchId: Number(f.homeBranchId) || 0,
  };
}

export function PersonFields({
  value,
  onChange,
  branches,
  phoneLocked = false,
  branchLocked = false,
}: {
  value: PersonForm;
  onChange: (next: PersonForm) => void;
  branches: BranchSummary[];
  /** The WhatsApp number is the sign-in name; once given, staff change it (FR-AUT-21). */
  phoneLocked?: boolean;
  branchLocked?: boolean;
}) {
  const { t } = useTranslation();
  const set = (key: keyof PersonForm) => (e: { target: { value: string } }) =>
    onChange({ ...value, [key]: e.target.value });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('person.fullName')}>
        {({ id }) => (
          <Input id={id} autoComplete="name" value={value.fullName} onChange={set('fullName')} />
        )}
      </Field>
      <Field label={t('person.dateOfBirth')}>
        {({ id }) => (
          <Input
            id={id}
            type="date"
            autoComplete="bday"
            value={value.dateOfBirth}
            onChange={set('dateOfBirth')}
          />
        )}
      </Field>
      <div className="sm:col-span-2">
        <Field label={t('person.address')}>
          {({ id }) => (
            <Input
              id={id}
              autoComplete="street-address"
              value={value.address}
              onChange={set('address')}
            />
          )}
        </Field>
      </div>
      <Field label={t('person.whatsappPhone')} hint={t('person.whatsappHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            disabled={phoneLocked}
            value={value.whatsappPhone}
            onChange={set('whatsappPhone')}
          />
        )}
      </Field>
      <Field label={t('person.otherPhone')}>
        {({ id }) => (
          <Input
            id={id}
            type="tel"
            inputMode="tel"
            value={value.otherPhone}
            onChange={set('otherPhone')}
          />
        )}
      </Field>
      <Field label={t('person.organisation')} hint={t('person.organisationHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={value.organisation}
            onChange={set('organisation')}
          />
        )}
      </Field>
      <Field label={t('person.homeBranch')}>
        {({ id }) => (
          <Select
            id={id}
            disabled={branchLocked}
            value={value.homeBranchId}
            onChange={set('homeBranchId')}
          >
            <option value="">{t('person.chooseBranch')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('person.introducedByName')} hint={t('person.introducerHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={value.introducedByName}
            onChange={set('introducedByName')}
          />
        )}
      </Field>
      <Field label={t('person.introducedByPhone')}>
        {({ id }) => (
          <Input
            id={id}
            type="tel"
            inputMode="tel"
            value={value.introducedByPhone}
            onChange={set('introducedByPhone')}
          />
        )}
      </Field>
    </div>
  );
}
