import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../src/db/migrate';

export const TEMPLATE_DB = 'pothgula_template';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection URL of the container's maintenance database (`postgres`). */
    pgAdminUrl: string;
  }
}

/**
 * Starts one PostgreSQL 17 container for the whole run and migrates a template
 * database. Each test file then clones the template (see `test/db.ts`), so files
 * are isolated without re-running migrations.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase(TEMPLATE_DB)
    .start();

  await runMigrations(container.getConnectionUri());

  const admin = new URL(container.getConnectionUri());
  admin.pathname = '/postgres';
  project.provide('pgAdminUrl', admin.toString());

  return async () => {
    await container.stop();
  };
}
