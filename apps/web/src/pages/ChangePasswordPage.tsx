import { passwordProblems } from '@pothgula/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { errorMessage, passwordProblemsOf } from '../api/errors';
import { useAuth, useMe } from '../auth/auth';
import { Alert, Button, Card, Field, Input, PageTitle } from '../components/ui';

/** FR-AUT-10, FR-AUT-12, FR-AUT-15. */
export function ChangePasswordPage() {
  const { t } = useTranslation();
  const { user } = useMe();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const problems = next ? passwordProblems(next, user.whatsappPhone) : [];
  const mismatch = repeat.length > 0 && repeat !== next;
  const ready = current && next && repeat === next && problems.length === 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setServerProblems([]);
    setBusy(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      setDone(true);
      setCurrent('');
      setNext('');
      setRepeat('');
      await refresh();
      if (user.mustChangePassword) navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(t, err));
      setServerProblems(passwordProblemsOf(err));
    } finally {
      setBusy(false);
    }
  }

  const shownProblems = [...new Set([...problems, ...serverProblems])];

  return (
    <div className="max-w-lg">
      <PageTitle lead={t('changePassword.lead')}>{t('changePassword.title')}</PageTitle>
      {user.mustChangePassword && (
        <div className="mb-5">
          <Alert tone="warning" title={t('changePassword.mustTitle')}>
            {t('changePassword.mustBody')}
          </Alert>
        </div>
      )}
      {done && !user.mustChangePassword && (
        <div className="mb-5">
          <Alert tone="success">{t('changePassword.done')}</Alert>
        </div>
      )}
      <Card>
        <form onSubmit={submit} className="space-y-5" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label={t('changePassword.current')}>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('changePassword.new')}
            hint={
              <ul className="list-disc space-y-0.5 pl-5">
                <li className={shownProblems.includes('too_short') ? 'text-red-700' : undefined}>
                  {t('passwordRules.too_short')}
                </li>
                <li className={shownProblems.includes('too_common') ? 'text-red-700' : undefined}>
                  {t('passwordRules.too_common')}
                </li>
                <li
                  className={shownProblems.includes('same_as_phone') ? 'text-red-700' : undefined}
                >
                  {t('passwordRules.same_as_phone')}
                </li>
              </ul>
            }
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={shownProblems.length > 0}
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => {
                  setNext(e.target.value);
                  setServerProblems([]);
                }}
              />
            )}
          </Field>
          <Field
            label={t('changePassword.repeat')}
            error={mismatch ? t('changePassword.mismatch') : null}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" disabled={!ready || busy}>
            {t('changePassword.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
