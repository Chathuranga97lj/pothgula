import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { makeCopy, makeTitle } from '../../test/fixtures';
import { activityLog } from '../db/schema';

let t: TestApp;
let boss: string;
let librarian: string;
let member: string;

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: '#1e5d4b' } })
    .png()
    .toBuffer();

beforeAll(async () => {
  t = await startApp();
  boss = await signIn(t, (await makeAccount(t, { userType: 'super_admin' })).whatsappPhone!);
  const ks = await t.http().post('/api/branches').set(bearer(boss)).send({
    branchName: 'Kesbewa',
    branchCode: 'KS',
    address: '12 Temple Road',
    phone: '0112000001',
  });
  librarian = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: ks.body.id })).whatsappPhone!,
  );
  member = await signIn(
    t,
    (await makeAccount(t, { userType: 'member', branchId: ks.body.id })).whatsappPhone!,
  );
});
afterAll(async () => {
  await t.close();
});

const logOf = (action: string) =>
  t.db.select().from(activityLog).where(eq(activityLog.action, action));

describe('the library (FR-BRN-03, FR-BRN-04)', () => {
  it('shows its name to anyone, and lets only a super admin rename it', async () => {
    const before = await t.http().get('/api/library');
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ name: 'Pothgula Library', logoImageId: null });

    expect(
      (await t.http().patch('/api/library').set(bearer(librarian)).send({ name: 'x' })).status,
    ).toBe(403);
    const renamed = await t
      .http()
      .patch('/api/library')
      .set(bearer(boss))
      .send({ name: 'කැස්බෑව මහජන පුස්තකාලය' });
    expect(renamed.body.name).toBe('කැස්බෑව මහජන පුස්තකාලය');

    const [entry] = await logOf('library.rename');
    expect(entry!.beforeData).toEqual({ name: 'Pothgula Library' });
    expect(entry!.afterData).toEqual({ name: 'කැස්බෑව මහජන පුස්තකාලය' });
  });

  it('stores an uploaded logo resized inside the database and serves it safely (NFR-16)', async () => {
    const res = await t
      .http()
      .post('/api/library/logo')
      .set(bearer(boss))
      .attach('file', await png(1600, 900), 'logo.png');
    expect(res.status).toBe(200);
    const id = res.body.logoImageId as number;

    const full = await t.http().get(`/api/images/${id}`).buffer(true);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('image/png');
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    expect(await sharp(full.body as Buffer).metadata()).toMatchObject({ width: 512, height: 288 });

    const thumb = await t.http().get(`/api/images/${id}?size=thumb`).buffer(true);
    expect((await sharp(thumb.body as Buffer).metadata()).width).toBe(128);
  });

  it('accepts JPEG and WebP but refuses anything that is not really an image', async () => {
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
    const webp = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } })
      .webp()
      .toBuffer();
    for (const [buf, name] of [
      [jpeg, 'a.jpg'],
      [webp, 'a.webp'],
    ] as const) {
      expect(
        (await t.http().post('/api/library/logo').set(bearer(boss)).attach('file', buf, name))
          .status,
      ).toBe(200);
    }
    const fake = await t
      .http()
      .post('/api/library/logo')
      .set(bearer(boss))
      .attach('file', Buffer.from('<svg onload="alert(1)"></svg>'), {
        filename: 'logo.png',
        contentType: 'image/png',
      });
    expect(fake.status).toBe(422);
    expect(fake.body.code).toBe('image_type');
  });

  it('refuses a file over 2 MB', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 10, 1);
    const res = await t
      .http()
      .post('/api/library/logo')
      .set(bearer(boss))
      .attach('file', big, 'big.png');
    expect([413, 422]).toContain(res.status);
    expect(res.body.code).toBe('image_too_large');
  });
});

describe('branches (FR-BRN-01 – FR-BRN-04)', () => {
  it('lets only a super admin create one; the code is two capital letters, used once', async () => {
    const body = {
      branchName: 'Galle',
      branchCode: 'gl',
      address: '5 Fort Street',
      phone: '091 200 0002',
    };
    expect((await t.http().post('/api/branches').set(bearer(librarian)).send(body)).status).toBe(
      403,
    );

    const created = await t.http().post('/api/branches').set(bearer(boss)).send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: 'GL', phone: '0912000002', codeLocked: false });
    expect(created.body.settings).toMatchObject({
      loanDays: 14,
      maxBooks: 2,
      holdDays: 7,
      annualFeeCents: 0,
    });

    expect((await t.http().post('/api/branches').set(bearer(boss)).send(body)).body.code).toBe(
      'branch_code_in_use',
    );
    const bad = await t
      .http()
      .post('/api/branches')
      .set(bearer(boss))
      .send({ ...body, branchCode: 'G1' });
    expect(bad.body.code).toBe('invalid_request');
  });

  it('lets members list branches but not open their settings', async () => {
    const list = await t.http().get('/api/branches').set(bearer(member));
    expect(list.status).toBe(200);
    expect(list.body.map((b: { code: string }) => b.code)).toEqual(['GL', 'KS']);
    expect(
      (await t.http().get(`/api/branches/${list.body[0].id}`).set(bearer(member))).status,
    ).toBe(403);
    expect(
      (await t.http().get(`/api/branches/${list.body[0].id}`).set(bearer(librarian))).status,
    ).toBe(200);
  });

  it('renames at any time, and changes the code only until a copy carries it', async () => {
    const created = await t.http().post('/api/branches').set(bearer(boss)).send({
      branchName: 'Matara',
      branchCode: 'MA',
      address: '1 Beach Road',
      phone: '0412000003',
    });
    const id = created.body.id as number;

    const corrected = await t
      .http()
      .patch(`/api/branches/${id}`)
      .set(bearer(boss))
      .send({ branchCode: 'MT' });
    expect(corrected.body.code).toBe('MT');

    const t1 = await makeTitle(t.db, await categoryFor('A1'));
    await makeCopy(t.db, { titleId: t1.id, branchId: id, accessionNo: 'MT-A1-00001' });

    const locked = await t
      .http()
      .patch(`/api/branches/${id}`)
      .set(bearer(boss))
      .send({ branchCode: 'MR' });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('branch_code_locked');
    expect((await t.http().get(`/api/branches/${id}`).set(bearer(boss))).body.codeLocked).toBe(
      true,
    );

    const renamed = await t
      .http()
      .patch(`/api/branches/${id}`)
      .set(bearer(boss))
      .send({ branchName: 'Matara Town' });
    expect(renamed.body).toMatchObject({ name: 'Matara Town', code: 'MT' });

    const entries = (await logOf('branch.update')).filter((e) => e.entityId === String(id));
    // FR-BRN-03: the change is logged with the old and new names.
    expect(entries.at(-1)!.beforeData).toEqual({ name: 'Matara' });
    expect(entries.at(-1)!.afterData).toEqual({ name: 'Matara Town' });
    expect(entries[0]!.beforeData).toEqual({ code: 'MA' });
    expect(entries[0]!.afterData).toEqual({ code: 'MT' });
  });

  it('gives a branch its own logo', async () => {
    const list = await t.http().get('/api/branches').set(bearer(boss));
    const ks = list.body.find((b: { code: string }) => b.code === 'KS');
    const res = await t
      .http()
      .post(`/api/branches/${ks.id}/logo`)
      .set(bearer(boss))
      .attach('file', await png(300, 300), 'ks.png');
    expect(res.status).toBe(200);
    expect(res.body.logoImageId).toEqual(expect.any(Number));
    const again = await t.http().get('/api/branches').set(bearer(member));
    expect(again.body.find((b: { code: string }) => b.code === 'KS').logoImageId).toBe(
      res.body.logoImageId,
    );
  });
});

describe('branch settings and the annual fee (FR-MEM-06)', () => {
  it('lets only a super admin change them, logs old and new, and keeps them consistent', async () => {
    const ks = (await t.http().get('/api/branches').set(bearer(boss))).body.find(
      (b: { code: string }) => b.code === 'KS',
    );
    const url = `/api/branches/${ks.id}/settings`;

    expect(
      (await t.http().patch(url).set(bearer(librarian)).send({ annualFeeCents: 1 })).status,
    ).toBe(403);

    const res = await t
      .http()
      .patch(url)
      .set(bearer(boss))
      .send({ annualFeeCents: 50_000, loanDays: 21 });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ annualFeeCents: 50_000, loanDays: 21, maxBooks: 2 });

    const [entry] = (await logOf('branch.settings')).filter((e) => e.entityId === String(ks.id));
    expect(entry!.beforeData).toEqual({ annualFeeCents: 0, loanDays: 14 });
    expect(entry!.afterData).toEqual({ annualFeeCents: 50_000, loanDays: 21 });

    const clash = await t
      .http()
      .patch(url)
      .set(bearer(boss))
      .send({ maxBooks: 1, maxBooksWhileSettling: 2 });
    expect(clash.status).toBe(400);
    expect(
      (await t.http().patch(url).set(bearer(boss)).send({ annualFeeCents: 12.5 })).status,
    ).toBe(400);
    expect((await t.http().patch(url).set(bearer(boss)).send({})).status).toBe(400);
  });
});

describe('categories (FR-BRN-05 – FR-BRN-07)', () => {
  it('creates, renames and retires; the code is fixed once a title uses it', async () => {
    const created = await t
      .http()
      .post('/api/categories')
      .set(bearer(boss))
      .send({ code: 'b1', name: 'English novels' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      code: 'B1',
      name: 'English novels',
      isActive: true,
      inUse: false,
    });
    expect(
      (
        await t
          .http()
          .post('/api/categories')
          .set(bearer(librarian))
          .send({ code: 'B2', name: 'x' })
      ).status,
    ).toBe(403);
    expect(
      (await t.http().post('/api/categories').set(bearer(boss)).send({ code: 'B1', name: 'x' }))
        .body.code,
    ).toBe('category_code_in_use');

    const moved = await t.http().patch('/api/categories/B1').set(bearer(boss)).send({ code: 'B2' });
    expect(moved.body.code).toBe('B2');

    await makeTitle(t.db, 'B2');
    const locked = await t
      .http()
      .patch('/api/categories/B2')
      .set(bearer(boss))
      .send({ code: 'B3' });
    expect(locked.body.code).toBe('category_code_locked');
    const renamed = await t
      .http()
      .patch('/api/categories/B2')
      .set(bearer(boss))
      .send({ name: 'English fiction' });
    expect(renamed.body).toMatchObject({ code: 'B2', name: 'English fiction', inUse: true });

    expect((await t.http().post('/api/categories/B2/retire').set(bearer(boss))).body.isActive).toBe(
      false,
    );
    expect(
      (await t.http().post('/api/categories/B2/reinstate').set(bearer(boss))).body.isActive,
    ).toBe(true);

    const list = await t.http().get('/api/categories').set(bearer(member));
    expect(list.status).toBe(200);
    expect(list.body.some((c: { code: string }) => c.code === 'B2')).toBe(true);

    const retire = await t.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, 'category.retire'), eq(activityLog.entityId, 'B2')));
    expect(retire).toHaveLength(1);
  });
});

async function categoryFor(code: string): Promise<string> {
  const res = await t
    .http()
    .post('/api/categories')
    .set(bearer(boss))
    .send({ code, name: `Category ${code}` });
  if (res.status !== 201 && res.body.code !== 'category_code_in_use')
    throw new Error(JSON.stringify(res.body));
  return code;
}
