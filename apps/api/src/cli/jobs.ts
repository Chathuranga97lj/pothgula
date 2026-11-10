/** Runs the housekeeping jobs once: `pnpm --filter @pothgula/api jobs`. */
import { UnitOfWork } from '../audit/unit-of-work';
import { databaseUrl, logArchiveDir } from '../config';
import { createDb } from '../db/client';
import { archiveOldEntries } from '../log/archive';
import { anonymiseUnsuccessfulApplications } from '../members/anonymise';
import { lapseExpiredHolds } from '../requests/lapse';
import { syncSuspensions } from '../settlements/suspension';

async function main(): Promise<void> {
  const handle = createDb(databaseUrl());
  try {
    const uow = new UnitOfWork(handle.db);
    const ids = await anonymiseUnsuccessfulApplications(handle.db, uow);
    console.log(`Anonymised ${ids.length} unsuccessful application(s).`);
    const sync = await syncSuspensions(handle.db, uow);
    console.log(
      `Suspended ${sync.suspended.length} member(s); lifted ${sync.lifted.length} suspension(s).`,
    );
    const lapsed = await lapseExpiredHolds(handle.db, uow);
    console.log(`Lapsed ${lapsed.length} uncollected hold(s).`);
    const dir = logArchiveDir();
    const archived = await archiveOldEntries(handle.db, uow, dir);
    console.log(
      `Archived ${archived.entries} log entries to ${archived.files.length} file(s) in ${dir}.`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
