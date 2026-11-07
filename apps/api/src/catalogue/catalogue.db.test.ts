import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { activityLog, borrow, copy } from '../db/schema';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let ksLibrarian: string;
let member: string;
let memberId: number;
let adminId: number;

beforeAll(async () => {
  t = await startApp();
  boss = await signIn(t, (await makeAccount(t, { userType: 'super_admin' })).whatsappPhone!);
  const mk = (b: object) => t.http().post('/api/branches').set(bearer(boss)).send(b);
  ks = (await mk({ branchName: 'Kesbewa', branchCode: 'KS', address: 'x', phone: '0112000001' }))
    .body.id;
  gl = (await mk({ branchName: 'Galle', branchCode: 'GL', address: 'y', phone: '0912000002' })).body
    .id;
  for (const [code, name] of [
    ['A1', 'Sinhala novels'],
    ['A2', 'Sinhala short stories'],
    ['B1', 'English novels'],
  ]) {
    await t.http().post('/api/categories').set(bearer(boss)).send({ code, name });
  }
  const admin = await makeAccount(t, { userType: 'admin', branchId: ks });
  adminId = admin.id;
  ksLibrarian = await signIn(t, admin.whatsappPhone!);
  const m = await makeAccount(t, { userType: 'member', branchId: ks });
  memberId = m.id;
  member = await signIn(t, m.whatsappPhone!);
});
afterAll(async () => {
  await t.close();
});

const create = (token: string, body: object) =>
  t.http().post('/api/titles').set(bearer(token)).send(body);
const search = (token: string, query: string) =>
  t.http().get(`/api/catalogue?${query}`).set(bearer(token));
const ids = (res: { body: { titles: { id: number }[] } }) => res.body.titles.map((x) => x.id);

describe('cataloguing (FR-CAT-01, FR-CAT-02)', () => {
  it('creates a title once with several copies, each numbered by the system', async () => {
    const res = await create(ksLibrarian, {
      title: 'මඩොල් දූව',
      writer: 'මාටින් වික්‍රමසිංහ',
      publisher: 'සරසවි',
      isbn: '978-955-573-123-4',
      categoryCode: 'A1',
      copies: { branchId: ks, count: 3, source: 'Donation', priceCents: 75_000 },
    });
    expect(res.status).toBe(201);
    expect(res.body.accessionNumbers).toEqual(['KS-A1-00001', 'KS-A1-00002', 'KS-A1-00003']);
    expect(res.body.title).toMatchObject({
      isbn: '9789555731234',
      categoryName: 'Sinhala novels',
      holdings: [{ branchId: ks, total: 3, onShelf: 3 }],
    });
    expect(res.body.title.copies.every((c: { state: string }) => c.state === 'on_shelf')).toBe(
      true,
    );

    const log = await t.db.select().from(activityLog).where(eq(activityLog.entity, 'copy'));
    expect(
      log.some(
        (e) => (e.afterData as { accessionNumbers?: string[] }).accessionNumbers?.length === 3,
      ),
    ).toBe(true);
  });

  it('keeps a librarian to their own branch when adding copies; a super admin may add anywhere', async () => {
    const res = await create(ksLibrarian, { title: 'Everyday Science', categoryCode: 'B1' });
    const id = res.body.title.id;
    const other = await t
      .http()
      .post(`/api/titles/${id}/copies`)
      .set(bearer(ksLibrarian))
      .send({ branchId: gl, count: 1 });
    expect(other.body.code).toBe('other_branch');
    const ok = await t
      .http()
      .post(`/api/titles/${id}/copies`)
      .set(bearer(boss))
      .send({ branchId: gl, count: 2 });
    expect(ok.body.accessionNumbers).toEqual(['GL-B1-00001', 'GL-B1-00002']);
    expect(
      (
        await t
          .http()
          .post('/api/titles')
          .set(bearer(member))
          .send({ title: 'x', categoryCode: 'B1' })
      ).status,
    ).toBe(403);
  });

  it('lets no new title join a retired category (FR-BRN-07)', async () => {
    const existing = (await create(ksLibrarian, { title: 'Old Stories', categoryCode: 'A2' })).body
      .title.id;
    await t.http().post('/api/categories/A2/retire').set(bearer(boss));
    expect(
      (await create(ksLibrarian, { title: 'New Stories', categoryCode: 'A2' })).body.code,
    ).toBe('category_retired');
    // Copies of a title already in it may still be added.
    const more = await t
      .http()
      .post(`/api/titles/${existing}/copies`)
      .set(bearer(ksLibrarian))
      .send({ branchId: ks, count: 1 });
    expect(more.body.accessionNumbers).toEqual(['KS-A2-00001']);
    await t.http().post('/api/categories/A2/reinstate').set(bearer(boss));
  });

  it('warns of possible duplicates by ISBN or a similar title', async () => {
    const same = await t
      .http()
      .get('/api/titles/similar?title=x&isbn=9789555731234')
      .set(bearer(ksLibrarian));
    expect(same.body[0]).toMatchObject({ title: 'මඩොල් දූව', reason: 'same_isbn' });
    const near = await t
      .http()
      .get(`/api/titles/similar?title=${encodeURIComponent('මඩොල් දුව')}`)
      .set(bearer(ksLibrarian));
    expect(near.body.map((x: { title: string }) => x.title)).toContain('මඩොල් දූව');
  });
});

describe('the catalogue (FR-CAT-05 – FR-CAT-07)', () => {
  it('finds by title, writer, ISBN and accession number, typed any way', async () => {
    const madol = (await search(member, `q=${encodeURIComponent('මඩොල්')}`)).body.titles[0];
    expect(madol.title).toBe('මඩොල් දූව');
    for (const q of [
      encodeURIComponent('වික්‍රමසිංහ'),
      '978-955-573-123-4',
      'KS-A1',
      'ksa100002',
      'KS-A1-0000',
    ]) {
      expect(ids(await search(member, `q=${q}`)), q).toContain(madol.id);
    }
    expect(ids(await search(member, 'q=GL'))).not.toContain(madol.id);
  });

  it('filters by branch, category and availability', async () => {
    const madol = (await search(member, `q=${encodeURIComponent('මඩොල්')}`)).body.titles[0];
    expect(ids(await search(member, `branchId=${ks}`))).toContain(madol.id);
    expect(ids(await search(member, `branchId=${gl}`))).not.toContain(madol.id);
    expect(ids(await search(member, 'category=B1'))).not.toContain(madol.id);

    // Put every KS copy of it on loan: it is no longer "available".
    const copies = await t.db.select().from(copy).where(eq(copy.titleId, madol.id));
    for (const c of copies) {
      await t.db.insert(borrow).values({
        copyId: c.id,
        userId: memberId,
        branchId: ks,
        borrowDate: '2026-11-01',
        dueDate: '2026-11-15',
        originalDueDate: '2026-11-15',
        issuedBy: adminId,
      });
    }
    expect(ids(await search(member, 'available=true'))).not.toContain(madol.id);
    const detail = await t.http().get(`/api/titles/${madol.id}`).set(bearer(member));
    expect(detail.body.holdings).toEqual([{ branchId: ks, total: 3, onShelf: 0 }]);
    expect(
      detail.body.copies.every(
        (c: { state: string; priceCents: number | null }) =>
          c.state === 'on_loan' && c.priceCents === null,
      ),
    ).toBe(true);
    const staffView = await t.http().get(`/api/titles/${madol.id}`).set(bearer(ksLibrarian));
    expect(staffView.body.copies[0].priceCents).toBe(75_000);
  });

  it('hides titles with no copies from members, but not from staff', async () => {
    const empty = (await create(ksLibrarian, { title: 'Not Yet On The Shelf', categoryCode: 'B1' }))
      .body.title.id;
    expect(ids(await search(member, 'q=Shelf'))).not.toContain(empty);
    expect(ids(await search(ksLibrarian, 'q=Shelf'))).toContain(empty);
  });
});

describe('copies: condition, withdrawal, moving (FR-CAT-03, FR-CAT-08, FR-CAT-11, FR-CAT-14)', () => {
  async function freshCopy(branchId = ks) {
    const res = await create(boss, {
      title: `Copy test ${Math.random()}`,
      categoryCode: 'B1',
      copies: { branchId, count: 1 },
    });
    return {
      titleId: res.body.title.id as number,
      copyId: res.body.title.copies[0].id as number,
      accessionNo: res.body.accessionNumbers[0] as string,
    };
  }

  it('withdraws with a reason, never while on loan, and only a super admin reinstates', async () => {
    const { titleId, copyId } = await freshCopy();
    expect(
      (await t.http().post(`/api/copies/${copyId}/withdraw`).set(bearer(ksLibrarian)).send({})).body
        .code,
    ).toBe('invalid_request');

    await t.db.insert(borrow).values({
      copyId,
      userId: memberId,
      branchId: ks,
      borrowDate: '2026-11-01',
      dueDate: '2026-11-15',
      originalDueDate: '2026-11-15',
      issuedBy: adminId,
    });
    const onLoan = await t
      .http()
      .post(`/api/copies/${copyId}/withdraw`)
      .set(bearer(ksLibrarian))
      .send({ reason: 'Worn out' });
    expect(onLoan.body.code).toBe('copy_on_loan');
    await t.db
      .update(borrow)
      .set({ returnedOn: '2026-11-05', receivedBy: adminId })
      .where(eq(borrow.copyId, copyId));

    const withdrawn = await t
      .http()
      .post(`/api/copies/${copyId}/withdraw`)
      .set(bearer(ksLibrarian))
      .send({ reason: 'Worn out' });
    expect(withdrawn.body.copies[0]).toMatchObject({
      state: 'withdrawn',
      withdrawnReason: 'Worn out',
    });
    expect((await t.http().get(`/api/titles/${titleId}`).set(bearer(member))).body.copies).toEqual(
      [],
    );

    expect(
      (await t.http().post(`/api/copies/${copyId}/reinstate`).set(bearer(ksLibrarian))).status,
    ).toBe(403);
    const back = await t.http().post(`/api/copies/${copyId}/reinstate`).set(bearer(boss));
    expect(back.body.copies[0].state).toBe('on_shelf');
  });

  it('marks a copy not useable, within the librarian’s own branch only', async () => {
    const { copyId } = await freshCopy();
    const res = await t
      .http()
      .patch(`/api/copies/${copyId}`)
      .set(bearer(ksLibrarian))
      .send({ condition: 'not_useable' });
    expect(res.body.copies[0].state).toBe('not_useable');
    const elsewhere = await freshCopy(gl);
    expect(
      (
        await t
          .http()
          .patch(`/api/copies/${elsewhere.copyId}`)
          .set(bearer(ksLibrarian))
          .send({ condition: 'not_useable' })
      ).body.code,
    ).toBe('other_branch');
  });

  it('moves a copy for good, keeping its printed number; super admin only', async () => {
    const { copyId, accessionNo } = await freshCopy();
    expect(
      (
        await t
          .http()
          .post(`/api/copies/${copyId}/move`)
          .set(bearer(ksLibrarian))
          .send({ branchId: gl })
      ).status,
    ).toBe(403);
    const moved = await t
      .http()
      .post(`/api/copies/${copyId}/move`)
      .set(bearer(boss))
      .send({ branchId: gl });
    expect(moved.body.copies[0]).toMatchObject({
      branchId: gl,
      accessionedBranchId: ks,
      accessionNo,
    });
    expect(
      (await t.http().post(`/api/copies/${copyId}/move`).set(bearer(boss)).send({ branchId: gl }))
        .body.code,
    ).toBe('same_branch');
  });

  it('finds a copy by accession number with or without hyphens', async () => {
    const { copyId, accessionNo } = await freshCopy();
    for (const typed of [accessionNo, accessionNo.replace(/-/g, '').toLowerCase()]) {
      const res = await t.http().get(`/api/copies/by-accession/${typed}`).set(bearer(ksLibrarian));
      expect(res.body.copyId, typed).toBe(copyId);
    }
    expect(
      (await t.http().get('/api/copies/by-accession/KS-A1-99999').set(bearer(ksLibrarian))).status,
    ).toBe(404);
  });
});

describe('correcting and merging titles (FR-CAT-08, FR-CAT-14, FR-CAT-18)', () => {
  it('logs a correction, and a category change leaves the numbers on the books alone', async () => {
    const res = await create(ksLibrarian, {
      title: 'Gamperaliya',
      categoryCode: 'B1',
      copies: { branchId: ks, count: 1 },
    });
    const id = res.body.title.id;
    const fixed = await t
      .http()
      .patch(`/api/titles/${id}`)
      .set(bearer(ksLibrarian))
      .send({ title: 'ගම්පෙරළිය', categoryCode: 'A1' });
    expect(fixed.body).toMatchObject({ title: 'ගම්පෙරළිය', categoryCode: 'A1' });
    expect(fixed.body.copies[0].accessionNo).toMatch(/^KS-B1-/);
    const [entry] = await t.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, 'title.update'), eq(activityLog.entityId, String(id))));
    expect(entry!.beforeData).toEqual({ title: 'Gamperaliya', categoryCode: 'B1' });
  });

  it('merges a duplicate into the title that stays; super admin only', async () => {
    const keep = (
      await create(boss, {
        title: 'යුගාන්තය',
        categoryCode: 'A1',
        copies: { branchId: ks, count: 2 },
      })
    ).body.title.id;
    const dup = (
      await create(boss, {
        title: 'යුගාන්තයය',
        categoryCode: 'A1',
        copies: { branchId: gl, count: 1 },
      })
    ).body.title.id;

    expect(
      (
        await t
          .http()
          .post(`/api/titles/${dup}/merge`)
          .set(bearer(ksLibrarian))
          .send({ intoTitleId: keep })
      ).status,
    ).toBe(403);
    expect(
      (await t.http().post(`/api/titles/${dup}/merge`).set(bearer(boss)).send({ intoTitleId: dup }))
        .body.code,
    ).toBe('merge_into_self');

    const merged = await t
      .http()
      .post(`/api/titles/${dup}/merge`)
      .set(bearer(boss))
      .send({ intoTitleId: keep });
    expect(merged.body.holdings).toEqual([
      { branchId: ks, total: 2, onShelf: 2 },
      { branchId: gl, total: 1, onShelf: 1 },
    ]);
    expect(ids(await search(member, `q=${encodeURIComponent('යුගාන්ත')}`))).toEqual([keep]);
    expect(
      (
        await t
          .http()
          .post(`/api/titles/${dup}/merge`)
          .set(bearer(boss))
          .send({ intoTitleId: keep })
      ).body.code,
    ).toBe('title_merged');
  });
});
