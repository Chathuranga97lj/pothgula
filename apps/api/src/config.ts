const DEV_DATABASE_URL = 'postgres://pothgula:pothgula-dev-only@localhost:5433/pothgula';

/** The database URL. Outside production a local development default is allowed. */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (url) return url;
  if (env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL must be set in production');
  }
  return DEV_DATABASE_URL;
}

/** FR-AUT-07: a staff session ends after 30 minutes without activity. */
export const STAFF_IDLE_MS = 30 * 60_000;
/** Members stay signed in on their own phone for up to 30 days of inactivity. */
export const MEMBER_IDLE_MS = 30 * 24 * 60 * 60_000;
/** FR-AUT-06: five failed attempts lock the account for 15 minutes. */
export const MAX_FAILED_SIGNINS = 5;
export const LOCKOUT_MS = 15 * 60_000;
