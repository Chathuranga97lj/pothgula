import type { TFunction } from 'i18next';
import { ApiError } from './client';

/** A message for the person at the screen, in their language, for any failed request. */
export function errorMessage(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) return t('errors.internal_error');
  if (error.code === 'account_locked') {
    const seconds = (error.details as { retryAfterSeconds?: number } | undefined)
      ?.retryAfterSeconds;
    return t('errors.account_locked', { minutes: Math.max(1, Math.ceil((seconds ?? 900) / 60)) });
  }
  // A refused issue (FR-CIR-02) carries the values its message needs, such as the limit.
  const refusals = (error.details as { refusals?: { code: string; params?: object }[] } | undefined)
    ?.refusals;
  const params = refusals?.find((r) => r.code === error.code)?.params ?? {};
  const key = `errors.${error.code}`;
  return t(key, { ...params, defaultValue: error.message });
}

/** The password problems the API reported, if that is what went wrong. */
export function passwordProblemsOf(error: unknown): string[] {
  if (error instanceof ApiError && error.code === 'password_not_acceptable') {
    return (error.details as { problems?: string[] } | undefined)?.problems ?? [];
  }
  return [];
}
