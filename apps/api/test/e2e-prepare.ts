/**
 * Builds the database the browser tests (`e2e/`) run against: drops and
 * recreates it, migrates, loads the demonstration data, then adds a librarian,
 * a member and an overdue loan. Invented data only (NFR-17).
 *
 *   DATABASE_URL=postgres://…/pothgula_e2e pnpm --filter @pothgula/api e2e:prepare
 *
 * Refuses any database whose name does not end in `_e2e`, so it cannot be
 * pointed at the development or a real database by mistake.
 */
import { addDays, todayColombo } from '@pothgula/shared';
import { eq } from 'drizzle-orm';
import { Client } from 'pg';
import { SYSTEM_ACTOR } from '../src/audit/actor';
import { UnitOfWork } from '../src/audit/unit-of-work';
import { hashPassword } from '../src/auth/passwords';
import { loggableUser } from '../src/auth/users';
import { createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { appUser, borrow, branch, copy } from '../src/db/schema';
import { seedDemo } from '../src/db/seed';

/** Keep in step with `e2e/fixtures.ts`. */
export const E2E = {
  password: 'e2e-counter-pass-71',
  librarian: { fullName: 'Kumudu Librarian', whatsappPhone: '0770000001' },
  member: { fullName: 'Saman Wickrama', whatsappPhone: '0770000002' },
  /** On loan to the member, six days overdue. */
  overdueCopy: 'KS-A1-00001',
  overdueDays: 6,
} as const;

async function recreate(url: URL): Promise<void> {
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_e2e$/.test(name)) {
    throw new Error(`Refusing to recreate "${name}": the database name must end in _e2e`);
  }
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const admin = new Client({ connectionString: maintenance.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Not in production');
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL must name the end-to-end database');
  const url = new URL(raw);

  await recreate(url);
  await runMigrations(url.toString());

  const handle = createDb(url.toString());
  try {
    const uow = new UnitOfWork(handle.db);
    await seedDemo(uow);
    const passwordHash = await hashPassword(E2E.password);
    const today = todayColombo();

    await uow.run(SYSTEM_ACTOR, async (tx, log) => {
      const [ks] = await tx.select().from(branch).where(eq(branch.branchCode, 'KS'));
      if (!ks) throw new Error('the demonstration data has no KS branch');

      const [librarian] = await tx
        .insert(appUser)
        .values({
          ...E2E.librarian,
          userType: 'admin',
          status: 'active',
          passwordHash,
          branchId: ks.id,
        })
        .returning();
      const [member] = await tx
        .insert(appUser)
        .values({
          ...E2E.member,
          userType: 'member',
          status: 'active',
          passwordHash,
          branchId: ks.id,
          dateOfBirth: '1990-04-12',
          appliedAt: new Date(),
          approvedAt: new Date(),
          expireAt: addDays(today, 300),
        })
        .returning();
      if (!librarian || !member) throw new Error('account insert returned nothing');
      for (const row of [librarian, member]) {
        await log({
          action: row.userType === 'admin' ? 'staff.create' : 'member.register',
          entity: 'app_user',
          entityId: row.id,
          branchId: ks.id,
          after: loggableUser(row),
        });
      }

      const [c] = await tx.select().from(copy).where(eq(copy.accessionNo, E2E.overdueCopy));
      if (!c) throw new Error(`the demonstration data has no ${E2E.overdueCopy}`);
      const dueDate = addDays(today, -E2E.overdueDays);
      const [loan] = await tx
        .insert(borrow)
        .values({
          copyId: c.id,
          userId: member.id,
          branchId: ks.id,
          borrowDate: addDays(dueDate, -14),
          dueDate,
          originalDueDate: dueDate,
          issuedBy: librarian.id,
        })
        .returning();
      await log({
        action: 'borrow.issue',
        entity: 'borrow',
        entityId: loan!.id,
        branchId: ks.id,
        after: loan,
      });
    });
    console.log(`End-to-end database ready: ${url.pathname.slice(1)}`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
