/** Runs the housekeeping jobs once: `pnpm --filter @pothgula/api jobs`. */
import { UnitOfWork } from '../audit/unit-of-work';
import { databaseUrl } from '../config';
import { createDb } from '../db/client';
import { anonymiseUnsuccessfulApplications } from '../members/anonymise';

async function main(): Promise<void> {
  const handle = createDb(databaseUrl());
  try {
    const ids = await anonymiseUnsuccessfulApplications(handle.db, new UnitOfWork(handle.db));
    console.log(`Anonymised ${ids.length} unsuccessful application(s).`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
