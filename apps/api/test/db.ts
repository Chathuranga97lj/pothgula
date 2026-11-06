import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { inject } from 'vitest';
import { createDb, type DbHandle } from '../src/db/client';
import { TEMPLATE_DB } from './postgres.global-setup';

/** A new, migrated, empty database cloned from the template, for one test file. */
export async function freshDb(): Promise<DbHandle & { url: string }> {
  const adminUrl = inject('pgAdminUrl');
  const name = `t_${randomBytes(6).toString('hex')}`;

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const handle = createDb(url.toString());
  return { ...handle, url: url.toString() };
}

/** The PostgreSQL error behind a failed Drizzle query. */
export function pgError(error: unknown): { code?: string; constraint?: string; message: string } {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return cause as { code?: string; constraint?: string; message: string };
}

/** Runs `fn`, expects it to fail, and returns the PostgreSQL error. */
export async function expectPgError(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    return pgError(error);
  }
  throw new Error('Expected the database to refuse this, but it succeeded');
}
