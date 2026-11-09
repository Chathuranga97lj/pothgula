import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb } from '../../test/db';
import { makeLibrary } from '../../test/fixtures';
import type { DbHandle } from '../db/client';
import { activityLog, copy } from '../db/schema';
import type { Actor } from './actor';
import { UnitOfWork, UnloggedChangeError } from './unit-of-work';

let h: DbHandle;
let uow: UnitOfWork;
let lib: Awaited<ReturnType<typeof makeLibrary>>;
let admin: Extract<Actor, { kind: 'user' }>;

beforeAll(async () => {
  h = await freshDb();
  uow = new UnitOfWork(h.db);
  lib = await makeLibrary(h.db);
  admin = {
    kind: 'user',
    userId: lib.admin.id,
    role: 'admin',
    branchId: lib.branch.id,
    ipAddress: '192.0.2.10',
  };
});

afterAll(async () => {
  await h.close();
});

const conditionOf = async () =>
  (await h.db.select().from(copy).where(eq(copy.id, lib.copy.id)))[0]?.condition;
const entriesFor = async (action: string) =>
  h.db.select().from(activityLog).where(eq(activityLog.action, action));

describe('UnitOfWork (FR-LOG-13)', () => {
  it('commits the change and its log entry together', async () => {
    await uow.run(admin, async (tx, log) => {
      const [before] = await tx.select().from(copy).where(eq(copy.id, lib.copy.id));
      const [after] = await tx
        .update(copy)
        .set({ condition: 'not_useable' })
        .where(eq(copy.id, lib.copy.id))
        .returning();
      await log({ action: 'copy.condition', entity: 'copy', entityId: lib.copy.id, before, after });
    });

    expect(await conditionOf()).toBe('not_useable');
    const [entry] = await entriesFor('copy.condition');
    expect(entry).toMatchObject({
      actorId: lib.admin.id,
      actorRole: 'admin',
      branchId: lib.branch.id,
      entity: 'copy',
      entityId: String(lib.copy.id),
      ipAddress: '192.0.2.10',
    });
    expect((entry?.beforeData as { condition: string }).condition).toBe('useable');
    expect((entry?.afterData as { condition: string }).condition).toBe('not_useable');
  });

  it('writes several entries in one call, for a bulk change', async () => {
    await uow.run(admin, async (_tx, log) => {
      await log(
        Array.from({ length: 1201 }, (_, i) => ({
          action: 'test.bulk',
          entity: 'copy',
          entityId: i,
        })),
      );
    });
    const entries = await entriesFor('test.bulk');
    expect(entries).toHaveLength(1201);
    expect(entries[0]).toMatchObject({ actorId: lib.admin.id, branchId: lib.branch.id });
  });

  it('rolls the change back when nothing was logged', async () => {
    await expect(
      uow.run(admin, async (tx) => {
        await tx.update(copy).set({ condition: 'missing' }).where(eq(copy.id, lib.copy.id));
      }),
    ).rejects.toBeInstanceOf(UnloggedChangeError);
    expect(await conditionOf()).toBe('not_useable');
  });

  it('rolls back both when the work fails after logging', async () => {
    await expect(
      uow.run(admin, async (tx, log) => {
        await tx.update(copy).set({ condition: 'missing' }).where(eq(copy.id, lib.copy.id));
        await log({ action: 'copy.condition.failed', entity: 'copy', entityId: lib.copy.id });
        throw new Error('something went wrong after the log entry');
      }),
    ).rejects.toThrow('something went wrong');
    expect(await conditionOf()).toBe('not_useable');
    expect(await entriesFor('copy.condition.failed')).toHaveLength(0);
  });

  it('rolls back the change when the log entry cannot be written', async () => {
    await expect(
      uow.run({ ...admin, userId: 999_999 }, async (tx, log) => {
        await tx.update(copy).set({ condition: 'missing' }).where(eq(copy.id, lib.copy.id));
        await log({ action: 'copy.condition.badactor', entity: 'copy' }); // FK on actor_id fails
      }),
    ).rejects.toThrow();
    expect(await conditionOf()).toBe('not_useable');
  });

  it('records the system as actor for scheduled work', async () => {
    await uow.run({ kind: 'system' }, async (_tx, log) => {
      await log({ action: 'job.ran', entity: 'job' });
    });
    const [entry] = await entriesFor('job.ran');
    expect(entry).toMatchObject({ actorId: null, actorRole: 'system', branchId: null });
  });
});
