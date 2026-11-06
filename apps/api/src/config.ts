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
