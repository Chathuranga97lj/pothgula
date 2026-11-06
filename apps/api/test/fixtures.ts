/**
 * Minimal rows for database tests, inserted directly (not through UnitOfWork):
 * these tests are about what the database itself allows. Invented data only.
 */
import { randomInt } from 'node:crypto';
import type { Db } from '../src/db/client';
import { appUser, branch, category, copy, title } from '../src/db/schema';

let seq = 0;
const nextPhone = () => `07${String(randomInt(10_000_000, 99_999_999))}`;

export async function makeBranch(db: Db, code = 'KS') {
  const [row] = await db
    .insert(branch)
    .values({
      libraryName: 'Test Library',
      branchName: `Branch ${code}`,
      branchCode: code,
      address: '1 Test Road',
      phone: '0112345678',
    })
    .returning();
  return row!;
}

export async function makeCategory(db: Db, code = 'A1') {
  const [row] = await db
    .insert(category)
    .values({ code, name: `Category ${code}` })
    .returning();
  return row!;
}

export async function makeTitle(db: Db, categoryCode = 'A1') {
  seq += 1;
  const [row] = await db
    .insert(title)
    .values({ title: `ගම් මඟ ${seq}`, writer: 'සුනිල්', categoryCode })
    .returning();
  return row!;
}

export async function makeCopy(
  db: Db,
  opts: { titleId: number; branchId: number; accessionNo: string },
) {
  const [row] = await db
    .insert(copy)
    .values({ ...opts, accessionedBranchId: opts.branchId })
    .returning();
  return row!;
}

export async function makeUser(
  db: Db,
  opts: { userType?: 'member' | 'admin' | 'super_admin'; branchId?: number | null } = {},
) {
  const userType = opts.userType ?? 'member';
  const [row] = await db
    .insert(appUser)
    .values({
      fullName: 'කුමාරි පෙරේරා',
      userType,
      status: 'active',
      whatsappPhone: nextPhone(),
      passwordHash: 'not-a-real-hash',
      branchId: userType === 'super_admin' ? null : (opts.branchId ?? null),
    })
    .returning();
  return row!;
}

/** A branch, category, title, copy, member and admin — enough to issue a loan. */
export async function makeLibrary(db: Db) {
  const b = await makeBranch(db, 'KS');
  await makeCategory(db, 'A1');
  const t = await makeTitle(db, 'A1');
  const c = await makeCopy(db, { titleId: t.id, branchId: b.id, accessionNo: 'KS-A1-00001' });
  const member = await makeUser(db, { userType: 'member', branchId: b.id });
  const admin = await makeUser(db, { userType: 'admin', branchId: b.id });
  return { branch: b, title: t, copy: c, member, admin };
}
