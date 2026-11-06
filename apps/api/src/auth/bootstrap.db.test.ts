import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb } from '../../test/db';
import { UnitOfWork } from '../audit/unit-of-work';
import type { DbHandle } from '../db/client';
import { activityLog, appUser } from '../db/schema';
import { BootstrapError, createFirstSuperAdmin, serverResetSuperAdmin } from './bootstrap';
import { verifyPassword } from './passwords';

let h: DbHandle;
let uow: UnitOfWork;
beforeAll(async () => {
  h = await freshDb();
  uow = new UnitOfWork(h.db);
});
afterAll(async () => {
  await h.close();
});

describe('installation commands (FR-AUT-04, FR-AUT-14)', () => {
  it('creates the first super admin once, and only once', async () => {
    const first = await createFirstSuperAdmin(uow, {
      fullName: 'පුස්තකාලයාධිපති',
      whatsappPhone: '+94 77 100 2000',
    });
    const [row] = await h.db.select().from(appUser).where(eq(appUser.id, first.userId));
    expect(row).toMatchObject({
      userType: 'super_admin',
      branchId: null,
      whatsappPhone: '0771002000',
      mustChangePassword: true,
    });
    expect(row!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(row!.passwordHash, first.temporaryPassword)).toBe(true);

    await expect(
      createFirstSuperAdmin(uow, { fullName: 'Second', whatsappPhone: '0771002001' }),
    ).rejects.toBeInstanceOf(BootstrapError);

    const [entry] = await h.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, 'super_admin.bootstrap'));
    expect(entry).toMatchObject({ actorRole: 'system', entityId: String(first.userId) });
    expect(JSON.stringify(entry)).not.toContain(first.temporaryPassword);
    expect(JSON.stringify(entry)).not.toContain('argon2');
  });

  it('resets a locked-out or deactivated super admin from the server', async () => {
    await h.db
      .update(appUser)
      .set({
        status: 'deactivated',
        lockedUntil: new Date(Date.now() + 600_000),
        failedSigninCount: 3,
      })
      .where(eq(appUser.whatsappPhone, '0771002000'));

    const reset = await serverResetSuperAdmin(uow, { whatsappPhone: '0771002000' });
    const [row] = await h.db.select().from(appUser).where(eq(appUser.id, reset.userId));
    expect(row).toMatchObject({
      status: 'active',
      lockedUntil: null,
      failedSigninCount: 0,
      mustChangePassword: true,
    });
    expect(await verifyPassword(row!.passwordHash, reset.temporaryPassword)).toBe(true);

    await expect(
      serverResetSuperAdmin(uow, { whatsappPhone: '0779999999' }),
    ).rejects.toBeInstanceOf(BootstrapError);
  });
});
