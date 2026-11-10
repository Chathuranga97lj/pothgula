import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectPgError, freshDb } from '../../test/db';
import { UnitOfWork } from '../audit/unit-of-work';
import type { DbHandle } from '../db/client';
import { activityLog, branch, branchSetting } from '../db/schema';
import { archiveOldEntries } from './archive';

let h: DbHandle;
let dir: string;
let ks: number;
let gl: number;

const monthsAgo = (n: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
};

async function entry(action: string, branchId: number | null, at: Date): Promise<number> {
  const [row] = await h.db
    .insert(activityLog)
    .values({ at, actorRole: 'system', branchId, action, entity: 'job', afterData: { action } })
    .returning({ id: activityLog.id });
  return row!.id;
}

const present = async (ids: number[]) =>
  (await h.db.select({ id: activityLog.id }).from(activityLog).where(inArray(activityLog.id, ids)))
    .map((r) => r.id)
    .sort((a, b) => a - b);

beforeAll(async () => {
  h = await freshDb();
  dir = await mkdtemp(join(tmpdir(), 'pothgula-archive-'));
  const mk = async (code: string, months: number) => {
    const [b] = await h.db
      .insert(branch)
      .values({ branchCode: code, branchName: code, address: 'x', phone: '0112000000' })
      .returning();
    await h.db.insert(branchSetting).values({ branchId: b!.id, logRetentionMonths: months });
    return b!.id;
  };
  ks = await mk('KS', 24);
  gl = await mk('GL', 36);
});

afterAll(async () => {
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

describe('moving old entries to an archive file (FR-LOG-11)', () => {
  it("moves what each branch's retention allows, writes a checked file, and logs the move", async () => {
    const ksOld = await entry('ks.old', ks, monthsAgo(30));
    const ksNew = await entry('ks.new', ks, monthsAgo(20));
    const glMid = await entry('gl.mid', gl, monthsAgo(30)); // GL keeps 36 months
    const glOld = await entry('gl.old', gl, monthsAgo(40));
    const noBranchMid = await entry('none.mid', null, monthsAgo(30)); // longest rule: 36
    const noBranchOld = await entry('none.old', null, monthsAgo(40));

    const run = await archiveOldEntries(h.db, new UnitOfWork(h.db), dir);

    expect(run.entries).toBe(3);
    const moved = [ksOld, glOld, noBranchOld].sort((a, b) => a - b);
    expect(await present(moved)).toEqual([]);
    expect(await present([ksNew, glMid, noBranchMid])).toEqual(
      [ksNew, glMid, noBranchMid].sort((a, b) => a - b),
    );

    const name = `activity-log-${moved[0]}-${moved[2]}.jsonl.gz`;
    expect(run.files).toEqual([name]);
    const body = await readFile(join(dir, name));
    const sha = createHash('sha256').update(body).digest('hex');
    expect(await readFile(join(dir, `${name}.sha256`), 'utf8')).toBe(`${sha}  ${name}\n`);
    const lines = gunzipSync(body)
      .toString('utf8')
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.id)).toEqual(moved);
    expect(lines.map((l) => l.action).sort()).toEqual(['gl.old', 'ks.old', 'none.old']);
    expect(lines[0]).toHaveProperty('after');

    const [logged] = await h.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, 'log.archive'));
    expect(logged).toMatchObject({ actorRole: 'system', branchId: null, entity: 'activity_log' });
    expect(logged!.afterData).toMatchObject({ file: name, sha256: sha, entries: 3 });
  });

  it('does nothing, and logs nothing, when nothing is past retention', async () => {
    const before = await readdir(dir);
    const run = await archiveOldEntries(h.db, new UnitOfWork(h.db), dir);
    expect(run).toEqual({ files: [], entries: 0 });
    expect(await readdir(dir)).toEqual(before);
    const archives = await h.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, 'log.archive'));
    expect(archives).toHaveLength(1);
  });

  it('never lets anything younger than 24 months go, even with archiving switched on', async () => {
    const recent = await entry('recent', ks, monthsAgo(23));
    const err = await expectPgError(() =>
      h.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL pothgula.archiving = 'on'`);
        await tx.delete(activityLog).where(eq(activityLog.id, recent));
      }),
    );
    expect(err.constraint).toBe('activity_log_append_only');
  });

  it('never lets an old entry go without archiving switched on', async () => {
    const old = await entry('old', ks, monthsAgo(50));
    const err = await expectPgError(() => h.db.delete(activityLog).where(eq(activityLog.id, old)));
    expect(err.constraint).toBe('activity_log_append_only');
    const trunc = await expectPgError(() =>
      h.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL pothgula.archiving = 'on'`);
        await tx.execute(sql`TRUNCATE activity_log`);
      }),
    );
    expect(trunc.constraint).toBe('activity_log_append_only');
  });
});
