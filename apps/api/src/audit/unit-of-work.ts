import { Inject, Injectable } from '@nestjs/common';
import type { Db, Tx } from '../db/client';
import { DB } from '../db/db.module';
import { activityLog } from '../db/schema';
import type { Actor } from './actor';

/** One activity log entry (FR-LOG-02). */
export interface LogEntry {
  /** What was done, e.g. `copy.withdraw`, `borrow.issue`. */
  action: string;
  /** The kind of record, e.g. `copy`, `borrow`, `app_user`. */
  entity: string;
  entityId?: string | number | null;
  /** The branch the change belongs to; defaults to the actor's branch. */
  branchId?: number | null;
  before?: unknown;
  after?: unknown;
}

export type Log = (entry: LogEntry) => Promise<void>;

export class UnloggedChangeError extends Error {
  constructor() {
    super('A unit of work changed data without writing an activity log entry (FR-LOG-13)');
    this.name = 'UnloggedChangeError';
  }
}

/**
 * The only way application code should change data. `run` opens a transaction,
 * hands the work a `log` function that writes activity log entries inside that
 * same transaction, and refuses to commit if the work logged nothing. A change
 * and its record therefore commit together or not at all (FR-LOG-13, R13).
 */
@Injectable()
export class UnitOfWork {
  constructor(@Inject(DB) private readonly db: Db) {}

  run<T>(actor: Actor, work: (tx: Tx, log: Log) => Promise<T>): Promise<T> {
    return this.runAs((tx, logAs) => work(tx, (entry) => logAs(actor, entry)));
  }

  /**
   * As `run`, for the rare work whose actor only exists part-way through — a
   * public application, where the applicant's account is created in the same
   * transaction. Each entry names its actor; the same rule applies: no entry,
   * no commit.
   */
  runAs<T>(
    work: (tx: Tx, logAs: (actor: Actor, entry: LogEntry) => Promise<void>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      let entries = 0;
      const logAs = async (actor: Actor, entry: LogEntry) => {
        await tx.insert(activityLog).values(toRow(actor, entry));
        entries += 1;
      };
      const result = await work(tx, logAs);
      if (entries === 0) throw new UnloggedChangeError();
      return result;
    });
  }
}

function toRow(actor: Actor, entry: LogEntry): typeof activityLog.$inferInsert {
  const isUser = actor.kind === 'user';
  return {
    actorId: isUser ? actor.userId : null,
    actorRole: isUser ? actor.role : 'system',
    branchId: entry.branchId !== undefined ? entry.branchId : isUser ? actor.branchId : null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId == null ? null : String(entry.entityId),
    beforeData: entry.before ?? null,
    afterData: entry.after ?? null,
    ipAddress: actor.ipAddress ?? null,
  };
}
