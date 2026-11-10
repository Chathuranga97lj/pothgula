import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { UnitOfWork } from '../audit/unit-of-work';
import { logArchiveDir } from '../config';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { archiveOldEntries } from '../log/archive';
import { lapseExpiredHolds } from '../requests/lapse';
import { anonymiseUnsuccessfulApplications } from '../members/anonymise';
import { syncSuspensions } from '../settlements/suspension';

const EVERY_MS = 6 * 60 * 60_000;
const FIRST_RUN_MS = 60_000;

/**
 * Housekeeping that runs inside the API on a timer — no external scheduler to
 * install (NFR-13). Every job is safe to run any number of times. Set
 * POTHGULA_JOBS=off to disable (tests do), and run them by hand with
 * `pnpm --filter @pothgula/api jobs`.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly uow: UnitOfWork,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.POTHGULA_JOBS === 'off') return;
    const first = setTimeout(() => void this.runAll(), FIRST_RUN_MS);
    const repeat = setInterval(() => void this.runAll(), EVERY_MS);
    first.unref();
    repeat.unref();
    this.timers = [first, repeat];
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  async runAll(): Promise<void> {
    try {
      const ids = await anonymiseUnsuccessfulApplications(this.db, this.uow);
      if (ids.length > 0) this.logger.log(`Anonymised ${ids.length} unsuccessful application(s).`);
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    }
    // Before lapsing holds: a member suspended now has their held copy sent home.
    try {
      const run = await syncSuspensions(this.db, this.uow);
      if (run.suspended.length > 0) this.logger.log(`Suspended ${run.suspended.length} member(s).`);
      if (run.lifted.length > 0) this.logger.log(`Lifted ${run.lifted.length} suspension(s).`);
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    }
    try {
      const lapsed = await lapseExpiredHolds(this.db, this.uow);
      if (lapsed.length > 0) this.logger.log(`Lapsed ${lapsed.length} uncollected hold(s).`);
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    }
    // After anonymising, so an applicant's values are blanked before any entry leaves.
    try {
      const run = await archiveOldEntries(this.db, this.uow, logArchiveDir());
      if (run.entries > 0) {
        this.logger.log(`Archived ${run.entries} log entries: ${run.files.join(', ')}`);
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    }
  }
}
