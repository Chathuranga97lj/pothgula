import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb } from '../../test/db';
import { UnitOfWork } from '../audit/unit-of-work';
import type { DbHandle } from './client';
import { activityLog, copy, copyAvailability } from './schema';
import { seedDemo } from './seed';

let h: DbHandle;
beforeAll(async () => {
  h = await freshDb();
});
afterAll(async () => {
  await h.close();
});

describe('demonstration seed', () => {
  it('loads an empty database once, logging what it did', async () => {
    const uow = new UnitOfWork(h.db);
    const first = await seedDemo(uow);
    expect(first).toMatchObject({ skipped: false, branches: 2, categories: 31, titles: 8 });

    const copies = await h.db.select().from(copy);
    expect(copies).toHaveLength(first.copies);
    expect(copies.map((c) => c.accessionNo)).toContain('KS-A1-00003');

    const states = await h.db.select().from(copyAvailability);
    expect(states.every((s) => s.state === 'on_shelf')).toBe(true);

    const log = await h.db.select().from(activityLog);
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((e) => e.actorRole === 'system')).toBe(true);

    expect((await seedDemo(uow)).skipped).toBe(true);
  });
});
