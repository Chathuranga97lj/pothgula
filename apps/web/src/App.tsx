import { healthResponseSchema, type HealthResponse } from '@pothgula/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from './i18n';

type Health = { state: 'checking' } | { state: 'ok'; data: HealthResponse } | { state: 'down' };

export function App() {
  const { t, i18n } = useTranslation();
  const [health, setHealth] = useState<Health>({ state: 'checking' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((body: unknown) => {
        if (!cancelled) setHealth({ state: 'ok', data: healthResponseSchema.parse(body) });
      })
      .catch(() => {
        if (!cancelled) setHealth({ state: 'down' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <h1 className="text-2xl font-semibold text-emerald-900">{t('app.name')}</h1>
            <p className="text-sm text-stone-600">{t('app.tagline')}</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span>{t('language')}</span>
            <select
              className="rounded border border-stone-300 bg-white px-2 py-1"
              value={i18n.language}
              onChange={(e) => void i18n.changeLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <p role="status" className="text-stone-700">
          {health.state === 'checking' && t('health.checking')}
          {health.state === 'ok' && t('health.ok', { date: health.data.libraryDate })}
          {health.state === 'down' && t('health.down')}
        </p>
      </main>
    </div>
  );
}
