import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { UnitOfWork } from '../audit/unit-of-work';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { anonymiseUnsuccessfulApplications } from '../members/anonymise';

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
  }
}
