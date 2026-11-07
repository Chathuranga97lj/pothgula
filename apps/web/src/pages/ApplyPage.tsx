import { applicationRequestSchema, passwordProblems } from '@pothgula/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { useBranches, useLibrary } from '../api/queries';
import { useAuth } from '../auth/auth';
import { Logo } from '../components/images';
import { LanguageSelect } from '../components/LanguageSelect';
import { emptyPerson, PersonFields, personBody, type PersonForm } from '../components/PersonFields';
import { Alert, Button, Field, Input } from '../components/ui';

/** FR-AUT-03, NFR-09: the public application form. Applying is not yet membership. */
export function ApplyPage() {
  const { t } = useTranslation();
  const { me, signIn } = useAuth();
  const navigate = useNavigate();
  const library = useLibrary();
  const branches = useBranches();
  const [person, setPerson] = useState<PersonForm>(emptyPerson);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [consent, setConsent] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to="/" replace />;

  const problems = password ? passwordProblems(password, person.whatsappPhone) : [];
  const libraryName = library.data?.name ?? t('app.name');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== repeat) {
      setError(t('changePassword.mismatch'));
      return;
    }
    const parsed = applicationRequestSchema.safeParse({
      ...personBody(person),
      password,
      introducerConsent: consent,
      privacyAccepted: privacy,
    });
    if (!parsed.success) {
      setError(t('apply.incomplete'));
      return;
    }
    setBusy(true);
    try {
      await api('/applications', { method: 'POST', body: parsed.data });
      // Signed straight in: the applicant can browse while they wait (FR-AUT-16).
      await signIn(parsed.data.whatsappPhone, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="flex items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <Logo imageId={library.data?.logoImageId} name={libraryName} size="sm" />
          <span className="font-semibold text-emerald-900">{libraryName}</span>
        </div>
        <LanguageSelect />
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-4 pb-16">
        <h1 className="text-2xl font-semibold">{t('apply.title')}</h1>
        <p className="mt-1 mb-6 text-stone-600">{t('apply.lead')}</p>

        <form
          onSubmit={submit}
          className="space-y-6 rounded-lg border border-stone-200 bg-white p-6 shadow-sm"
          noValidate
        >
          {error && <Alert tone="error">{error}</Alert>}
          <PersonFields value={person} onChange={setPerson} branches={branches.data ?? []} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('apply.password')}
              hint={
                problems.length > 0
                  ? problems.map((p) => t(`passwordRules.${p}`)).join(' · ')
                  : t('passwordRules.too_short')
              }
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={problems.length > 0}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('changePassword.repeat')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="space-y-3 rounded-md bg-stone-50 p-4 text-sm">
            <label className="flex gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>{t('apply.consent')}</span>
            </label>
            <div>
              <p className="font-medium">{t('apply.privacyTitle')}</p>
              <p className="mt-1 text-stone-700">{t('apply.privacyBody')}</p>
            </div>
            <label className="flex gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={privacy}
                onChange={(e) => setPrivacy(e.target.checked)}
              />
              <span>{t('apply.privacyAccept')}</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" disabled={busy || !consent || !privacy || problems.length > 0}>
              {busy ? t('apply.sending') : t('apply.submit')}
            </Button>
            <Link to="/sign-in" className="text-sm text-emerald-800 underline">
              {t('apply.haveAccount')}
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
