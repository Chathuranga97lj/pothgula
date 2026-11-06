import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, types } from 'pg';
import * as schema from './schema';

// Return `date` columns as 'YYYY-MM-DD' strings, never JS Dates shifted by the
// server's time zone (NFR-05). OID 1082 is `date`.
types.setTypeParser(1082, (value: string) => value);

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything queries can run on: the database itself or an open transaction. */
export type Queryable = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: Pool;
  close(): Promise<void>;
}

export function createDb(connectionString: string): DbHandle {
  const pool = new Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
