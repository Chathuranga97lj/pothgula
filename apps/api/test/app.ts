import { randomInt } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UnitOfWork } from '../src/audit/unit-of-work';
import { hashPassword } from '../src/auth/passwords';
import { configureApp } from '../src/configure-app';
import { DB_HANDLE } from '../src/db/db.module';
import { appUser } from '../src/db/schema';
import { freshDb } from './db';

/** The whole API, as in production, on a fresh migrated database. */
export async function startApp() {
  const handle = await freshDb();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DB_HANDLE)
    .useValue(handle)
    .compile();
  const app: INestApplication = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return {
    app,
    db: handle.db,
    uow: new UnitOfWork(handle.db),
    http: () => request(app.getHttpServer()),
    /** Closes the app, which also closes the database pool. */
    close: () => app.close(),
  };
}

export type TestApp = Awaited<ReturnType<typeof startApp>>;

export const PASSWORD = 'river-lamp-71';

/** An account with a known password. Invented data only. */
export async function makeAccount(
  t: TestApp,
  opts: {
    userType: 'member' | 'admin' | 'super_admin';
    branchId?: number | null;
    status?: (typeof appUser.$inferInsert)['status'];
    mustChangePassword?: boolean;
    password?: string;
    rejectionReason?: string;
  },
) {
  const whatsappPhone = `07${randomInt(10_000_000, 99_999_999)}`;
  const [row] = await t.db
    .insert(appUser)
    .values({
      fullName: opts.userType === 'member' ? 'නිමාලි සිල්වා' : 'Staff Member',
      userType: opts.userType,
      status: opts.status ?? 'active',
      whatsappPhone,
      passwordHash: await hashPassword(opts.password ?? PASSWORD),
      mustChangePassword: opts.mustChangePassword ?? false,
      branchId: opts.userType === 'super_admin' ? null : (opts.branchId ?? null),
      rejectionReason: opts.rejectionReason,
    })
    .returning();
  return row!;
}

export async function signIn(t: TestApp, whatsappPhone: string, password = PASSWORD) {
  const res = await t.http().post('/api/auth/sign-in').send({ whatsappPhone, password });
  if (res.status !== 200)
    throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
