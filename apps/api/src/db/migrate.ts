import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

/** `apps/api/drizzle`, from both `src/db` (tsx, tests) and `dist/db` (built). */
export const MIGRATIONS_FOLDER = resolve(__dirname, '../../drizzle');

export async function runMigrations(connectionString: string): Promise<void> {
  const handle = createDb(connectionString);
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await handle.close();
  }
}
