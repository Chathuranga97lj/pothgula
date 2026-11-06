import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { errorMessage } from '../api/errors';
import { useAuth } from '../auth/auth';
import { LanguageSelect } from '../components/LanguageSelect';
import { Alert, Button, Field, Input } from '../components/ui';

/** FR-AUT-01, FR-AUT-02: WhatsApp number and password; no role to choose. */
export function SignInPage() {
  const { t } = useTranslation();
  const { me, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/sign-in' ? from : '/'} replace />;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(phone, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(t, err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <header className="flex justify-end p-4">
        <LanguageSelect />
      </header>
      <main className="mx-auto w-full max-w-sm flex-1 px-4 pt-8 pb-16">
        <h1 className="text-3xl font-semibold text-emerald-900">{t('app.name')}</h1>
        <p className="mb-8 text-stone-600">{t('app.tagline')}</p>

        <form
          onSubmit={submit}
          className="space-y-5 rounded-lg border border-stone-200 bg-white p-6 shadow-sm"
          noValidate
        >
          <h2 className="text-lg font-semibold">{t('signIn.title')}</h2>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label={t('signIn.phone')} hint={t('signIn.phoneHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="tel"
                inputMode="tel"
                autoComplete="username"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('signIn.password')}>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" disabled={busy || !phone || !password}>
            {busy ? t('signIn.submitting') : t('signIn.submit')}
          </Button>
          <p className="text-sm text-stone-600">{t('signIn.forgotten')}</p>
        </form>
      </main>
    </div>
  );
}
