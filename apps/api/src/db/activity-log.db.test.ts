import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectPgError, freshDb } from '../../test/db';
import type { DbHandle } from './client';
import { activityLog } from './schema';

let h: DbHandle;
let entryId: number;

beforeAll(async () => {
  h = await freshDb();
  const [row] = await h.db
    .insert(activityLog)
    .values({
      actorRole: 'system',
      action: 'test.write',
      entity: 'app_user',
      entityId: '1',
      afterData: { fullName: 'ප්‍රියංකා', whatsappPhone: '0771234567' },
    })
    .returning();
  entryId = row!.id;
});

afterAll(async () => {
  await h.close();
});

describe('activity log is append-only (FR-LOG-05)', () => {
  it('refuses updates', async () => {
    const err = await expectPgError(() =>
      h.db.update(activityLog).set({ action: 'forged' }).where(eq(activityLog.id, entryId)),
    );
    expect(err.constraint).toBe('activity_log_append_only');
  });

  it('refuses deletes and truncation', async () => {
    const del = await expectPgError(() =>
      h.db.delete(activityLog).where(eq(activityLog.id, entryId)),
    );
    expect(del.constraint).toBe('activity_log_append_only');
    const trunc = await expectPgError(() => h.db.execute(sql`TRUNCATE activity_log`));
    expect(trunc.constraint).toBe('activity_log_append_only');
  });

  it('requires a system entry to have no actor, and a user entry to have one', async () => {
    const err = await expectPgError(() =>
      h.db.insert(activityLog).values({ actorRole: 'admin', action: 'x', entity: 'y' }),
    );
    expect(err.constraint).toBe('activity_log_actor');
  });
});

describe('anonymisation redaction (FR-AUT-20)', () => {
  it('may replace only the values, only when redacting is switched on for the transaction', async () => {
    // Without the switch: refused.
    const off = await expectPgError(() =>
      h.db
        .update(activityLog)
        .set({ afterData: { redacted: true }, redactedAt: new Date() })
        .where(eq(activityLog.id, entryId)),
    );
    expect(off.constraint).toBe('activity_log_append_only');

    // With the switch, but trying to change who acted: refused.
    const forged = await expectPgError(() =>
      h.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL pothgula.redacting = 'on'`);
        await tx
          .update(activityLog)
          .set({ action: 'forged', redactedAt: new Date() })
          .where(eq(activityLog.id, entryId));
      }),
    );
    expect(forged.constraint).toBe('activity_log_append_only');

    // With the switch, values only: allowed.
    await h.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL pothgula.redacting = 'on'`);
      await tx
        .update(activityLog)
        .set({ afterData: { redacted: true }, redactedAt: new Date() })
        .where(eq(activityLog.id, entryId));
    });
    const [row] = await h.db.select().from(activityLog).where(eq(activityLog.id, entryId));
    expect(row?.afterData).toEqual({ redacted: true });
    expect(row?.action).toBe('test.write');

    // The switch does not outlive its transaction.
    const after = await expectPgError(() =>
      h.db
        .update(activityLog)
        .set({ afterData: null, redactedAt: new Date() })
        .where(eq(activityLog.id, entryId)),
    );
    expect(after.constraint).toBe('activity_log_append_only');
  });
});
