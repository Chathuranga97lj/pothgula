/**
 * FR-LOG-11: entries older than their branch's retention period (24 months by
 * default) are moved to an archive file, never destroyed.
 *
 * One batch at a time, inside one unit of work: the entries are read and locked,
 * written to `activity-log-<first id>-<last id>.jsonl.gz` with a `.sha256` beside
 * it, the file is read back and checked, and only then are the rows removed —
 * under the trigger's single archiving exception (drizzle/0005_log_archive.sql),
 * which refuses anything younger than 24 months — and the move is logged in the
 * same transaction. If the transaction fails after the file is written, the rows
 * stay and the next run writes the same file again: an entry can end up in an
 * archive twice, never in none.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { asc, inArray, sql } from 'drizzle-orm';
import { SYSTEM_ACTOR } from '../audit/actor';
import type { UnitOfWork } from '../audit/unit-of-work';
import type { Db, Tx } from '../db/client';
import { activityLog, branchSetting } from '../db/schema';

export const ARCHIVE_BATCH = 10_000;

class NothingToArchive extends Error {}

/**
 * Past retention: by the branch's own setting, and for entries with no branch
 * (super admins, the system) by the longest any branch keeps, so nothing leaves
 * the database sooner than some branch's rule allows.
 */
function pastRetention(q: Db | Tx, limit: number) {
  return q
    .select()
    .from(activityLog)
    .where(
      sql`${activityLog.at} < now() - make_interval(months => COALESCE(
        (SELECT ${branchSetting.logRetentionMonths} FROM ${branchSetting}
          WHERE ${branchSetting.branchId} = ${activityLog.branchId}),
        (SELECT max(${branchSetting.logRetentionMonths}) FROM ${branchSetting}),
        24))`,
    )
    .orderBy(asc(activityLog.id))
    .limit(limit);
}

export interface ArchiveRun {
  files: string[];
  entries: number;
}

/** Moves every entry past retention into archive files in `dir`. */
export async function archiveOldEntries(db: Db, uow: UnitOfWork, dir: string): Promise<ArchiveRun> {
  const run: ArchiveRun = { files: [], entries: 0 };
  for (;;) {
    const [any] = await pastRetention(db, 1);
    if (!any) return run;
    try {
      const moved = await uow.run(SYSTEM_ACTOR, async (tx, log) => {
        const rows = await pastRetention(tx, ARCHIVE_BATCH).for('update');
        if (rows.length === 0) throw new NothingToArchive();
        const first = rows[0]!.id;
        const last = rows[rows.length - 1]!.id;
        const name = `activity-log-${first}-${last}.jsonl.gz`;
        const sha256 = await writeChecked(dir, name, rows);

        await tx.execute(sql`SET LOCAL pothgula.archiving = 'on'`);
        const deleted = await tx
          .delete(activityLog)
          .where(
            inArray(
              activityLog.id,
              rows.map((r) => r.id),
            ),
          )
          .returning({ id: activityLog.id });
        await tx.execute(sql`SET LOCAL pothgula.archiving = 'off'`);
        if (deleted.length !== rows.length) {
          throw new Error(`Archive ${name}: removed ${deleted.length} of ${rows.length} entries`);
        }

        await log({
          action: 'log.archive',
          entity: 'activity_log',
          branchId: null,
          after: {
            file: name,
            sha256,
            entries: rows.length,
            firstId: first,
            lastId: last,
            oldest: rows[0]!.at.toISOString(),
            newest: rows.reduce((m, r) => (r.at > m ? r.at : m), rows[0]!.at).toISOString(),
          },
        });
        return { name, count: rows.length };
      });
      run.files.push(moved.name);
      run.entries += moved.count;
      if (moved.count < ARCHIVE_BATCH) return run;
    } catch (error) {
      if (error instanceof NothingToArchive) return run;
      throw error;
    }
  }
}

/** Writes the file and its checksum, reads it back, and returns the sha256. */
async function writeChecked(
  dir: string,
  name: string,
  rows: (typeof activityLog.$inferSelect)[],
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const lines = rows.map((r) =>
    JSON.stringify({
      id: r.id,
      at: r.at.toISOString(),
      actorId: r.actorId,
      actorRole: r.actorRole,
      branchId: r.branchId,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      before: r.beforeData,
      after: r.afterData,
      ipAddress: r.ipAddress,
      redactedAt: r.redactedAt?.toISOString() ?? null,
    }),
  );
  const body = gzipSync(Buffer.from(lines.join('\n') + '\n', 'utf8'));
  const sha256 = createHash('sha256').update(body).digest('hex');
  const path = join(dir, name);
  await writeFile(`${path}.part`, body, { flush: true });
  await rename(`${path}.part`, path);
  await writeFile(`${path}.sha256`, `${sha256}  ${name}\n`, { flush: true });

  // A file that cannot be read back is not an archive.
  const back = await readFile(path);
  const ids = gunzipSync(back)
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .map((l) => (JSON.parse(l) as { id: number }).id);
  if (
    createHash('sha256').update(back).digest('hex') !== sha256 ||
    ids.length !== rows.length ||
    ids.some((id, i) => id !== rows[i]!.id)
  ) {
    throw new Error(`Archive ${name} did not read back as written`);
  }
  return sha256;
}
