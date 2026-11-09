import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { activityLog, copy, title } from '../db/schema';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let ksLibrarian: string;
let gamperaliyaId: number;

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
    ['B1', 'English novels'],
    ['C1', 'Tamil novels'],
  ]) {
    await t.http().post('/api/categories').set(bearer(boss)).send({ code, name });
  }
  await t.http().post('/api/categories/C1/retire').set(bearer(boss)).send({});
  ksLibrarian = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: ks })).whatsappPhone!,
  );
  const existing = await t
    .http()
    .post('/api/titles')
    .set(bearer(boss))
    .send({
      title: 'Gamperaliya',
      writer: 'Martin Wickramasinghe',
      isbn: '9789550000001',
      categoryCode: 'B1',
      copies: { branchId: ks, count: 1 },
    });
  gamperaliyaId = existing.body.title.id;
});
afterAll(async () => {
  await t.close();
});

const csv = (...lines: string[]) => Buffer.from(lines.join('\r\n'), 'utf8');
const preview = (token: string, file: Buffer, branchId = ks) =>
  t
    .http()
    .post('/api/imports/preview')
    .set(bearer(token))
    .field('branchId', String(branchId))
    .attach('file', file, 'old-catalogue.csv');
const commit = (token: string, file: Buffer, decisions: object[], branchId = ks) =>
  t
    .http()
    .post('/api/imports')
    .set(bearer(token))
    .field('branchId', String(branchId))
    .field('decisions', JSON.stringify(decisions))
    .attach('file', file, 'old-catalogue.csv');

const GOOD = csv(
  'Old No.,Title,Author,ISBN,Category,Price,Shelf',
  'OLD-1,Gamperaliya,Martin Wickramasinghe,978-955-0000-00-1,B1,450,3',
  'OLD-2,Gamperaliya,Martin Wickramasinghe,9789550000001,B1,,3',
  'OLD-3,Kaliyugaya,Martin Wickramasinghe,,B1,"Rs 1,200.50",4',
  'OLD-4,"Kaliyugaya.",martin  wickramasinghe,,b1,,4',
  'OLD-5,Kaliyugayaa,Martin Wickramasinghe,,B1,,4',
  'OLD-6,ගම් මඟ,සුනිල් රත්නායක,,A1,,1',
  ',The Lighthouse Keeper,Anne Fernando,,B1,,2',
);

describe('the import preview (FR-CAT-13)', () => {
  it('groups copies into titles and finds probable duplicates, writing nothing', async () => {
    const before = await t.db.select().from(copy);
    const res = await preview(ksLibrarian, GOOD);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      branchId: ks,
      fileName: 'old-catalogue.csv',
      rows: 7,
      ignoredColumns: ['Shelf'],
      fileErrors: [],
      errors: [],
    });
    const groups = res.body.groups as {
      key: string;
      title: string;
      lines: number[];
      oldNumbers: string[];
      candidates: { titleId: number; reason: string }[];
      similarKeys: string[];
    }[];
    expect(groups.map((g) => [g.title, g.lines])).toEqual([
      ['Gamperaliya', [2, 3]],
      ['Kaliyugaya', [4, 5]],
      ['Kaliyugayaa', [6]],
      ['ගම් මඟ', [7]],
      ['The Lighthouse Keeper', [8]],
    ]);
    const [gamp, kali, kaliTypo, sinhala, light] = groups;
    expect(gamp!.candidates).toEqual([
      expect.objectContaining({ titleId: gamperaliyaId, reason: 'same_isbn', copies: 1 }),
    ]);
    expect(kali!.similarKeys).toEqual([kaliTypo!.key]);
    expect(kaliTypo!.similarKeys).toEqual([kali!.key]);
    expect(sinhala!.candidates).toEqual([]);
    expect(light!.similarKeys).toEqual([]);
    expect(await t.db.select().from(copy)).toHaveLength(before.length);
  });

  it('lists every problem row, by line', async () => {
    const res = await preview(
      ksLibrarian,
      csv(
        'old_number,title,writer,isbn,category,price',
        'X-1,,Someone,,B1,',
        'X-2,No category,,,,',
        'X-3,Unknown category,,,Z9,',
        'X-4,Retired category,,,C1,',
        'X-5,Bad ISBN,,12345,B1,',
        'X-6,Bad price,,,B1,cheap',
        'X-1,Repeated old number,,,B1,',
        'X-8,Same book,,,B1,',
        'X-9,Same book,,,A1,',
      ),
    );
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([
      { line: 2, code: 'missing_title', value: null },
      { line: 3, code: 'missing_category', value: null },
      { line: 4, code: 'unknown_category', value: 'Z9' },
      { line: 5, code: 'retired_category', value: 'C1' },
      { line: 6, code: 'bad_isbn', value: '12345' },
      { line: 7, code: 'bad_price', value: 'cheap' },
      { line: 8, code: 'old_number_repeated', value: 'X-1' },
      { line: 10, code: 'category_differs', value: 'A1' },
    ]);
    expect(res.body.rows).toBe(9);
  });

  it('says what is wrong with the file itself', async () => {
    const latin1 = Buffer.from('title,category\nCaf\xe9,B1\n', 'latin1');
    expect((await preview(ksLibrarian, latin1)).body.fileErrors).toEqual(['not_utf8']);
    const noCategory = await preview(ksLibrarian, csv('title,writer', 'x,y'));
    expect(noCategory.body).toMatchObject({
      fileErrors: ['missing_column'],
      missingColumns: ['category'],
    });
    expect((await preview(ksLibrarian, csv('title,category'))).body.fileErrors).toEqual(['empty']);
  });

  it('keeps an admin to their own branch', async () => {
    const res = await preview(ksLibrarian, GOOD, gl);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('other_branch');
    const none = await t
      .http()
      .post('/api/imports/preview')
      .set(bearer(ksLibrarian))
      .field('branchId', String(ks));
    expect(none.body.code).toBe('file_required');
  });
});

describe('committing the import (FR-CAT-13, FR-CAT-02)', () => {
  it('refuses a file with errors, or with duplicates nobody looked at', async () => {
    const bad = await commit(ksLibrarian, csv('title,category', ',B1'), []);
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('import_has_errors');

    const unreviewed = await commit(ksLibrarian, GOOD, []);
    expect(unreviewed.status).toBe(422);
    expect(unreviewed.body.code).toBe('duplicates_unreviewed');
    expect(unreviewed.body.details.keys).toHaveLength(3);

    const wrong = await commit(ksLibrarian, GOOD, [
      { key: 'isbn:9789550000001', action: 'existing', titleId: 999_999 },
    ]);
    expect(wrong.body.code).toBe('bad_decision');
  });

  it('numbers every copy, keeps the old number, and logs it all', async () => {
    const shown = (await preview(ksLibrarian, GOOD)).body.groups as {
      key: string;
      title: string;
    }[];
    const key = (name: string) => shown.find((g) => g.title === name)!.key;
    const res = await commit(ksLibrarian, GOOD, [
      { key: key('Gamperaliya'), action: 'existing', titleId: gamperaliyaId },
      { key: key('Kaliyugaya'), action: 'new' },
      { key: key('Kaliyugayaa'), action: 'merge', intoKey: key('Kaliyugaya') },
    ]);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ titlesCreated: 3, titlesAddedTo: 1 });
    expect(
      res.body.copies.map((c: { line: number; oldNumber: string; accessionNo: string }) => [
        c.line,
        c.oldNumber,
        c.accessionNo,
      ]),
    ).toEqual([
      [2, 'OLD-1', 'KS-B1-00002'],
      [3, 'OLD-2', 'KS-B1-00003'],
      [4, 'OLD-3', 'KS-B1-00004'],
      [5, 'OLD-4', 'KS-B1-00005'],
      [6, 'OLD-5', 'KS-B1-00006'],
      [7, 'OLD-6', 'KS-A1-00001'],
      [8, null, 'KS-B1-00007'],
    ]);

    const [old3] = await t.db.select().from(copy).where(eq(copy.accessionNo, 'KS-B1-00004'));
    expect(old3).toMatchObject({ legacyNo: 'OLD-3', priceCents: 120_050, branchId: ks });
    const gampCopies = await t.db.select().from(copy).where(eq(copy.titleId, gamperaliyaId));
    expect(gampCopies).toHaveLength(3);
    const kaliTitle = res.body.copies.find((c: { line: number }) => c.line === 4).titleId;
    expect(res.body.copies.find((c: { line: number }) => c.line === 6).titleId).toBe(kaliTitle);
    const [kali] = await t.db.select().from(title).where(eq(title.id, kaliTitle));
    expect(kali).toMatchObject({ title: 'Kaliyugaya', writer: 'Martin Wickramasinghe' });

    const entries = await t.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.branchId, ks), eq(activityLog.action, 'import.commit')));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.afterData).toMatchObject({ rows: 7, titlesCreated: 3, titlesAddedTo: 1 });
    const created = await t.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, 'title.create'));
    expect(
      created.filter((e) => (e.afterData as { source?: string }).source === 'import'),
    ).toHaveLength(3);
  });

  it('catches the same file being imported twice', async () => {
    const again = await preview(ksLibrarian, GOOD);
    expect(again.body.errors.map((e: { code: string }) => e.code)).toEqual(
      Array(6).fill('old_number_exists'),
    );
  });
});

describe('spine labels (FR-CAT-10)', () => {
  it("prints labels for the branch's copies, in the order given", async () => {
    const res = await t
      .http()
      .post('/api/labels')
      .set(bearer(ksLibrarian))
      .send({ accessionNumbers: ['KS-B1-00004', 'ksa100001'] })
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuses unknown numbers and other branches', async () => {
    const unknown = await t
      .http()
      .post('/api/labels')
      .set(bearer(ksLibrarian))
      .send({ accessionNumbers: ['KS-B1-09999'] });
    expect(unknown.status).toBe(404);

    await t
      .http()
      .post('/api/titles')
      .set(bearer(boss))
      .send({ title: 'Galle book', categoryCode: 'B1', copies: { branchId: gl, count: 1 } });
    const other = await t
      .http()
      .post('/api/labels')
      .set(bearer(ksLibrarian))
      .send({ accessionNumbers: ['GL-B1-00001'] });
    expect(other.status).toBe(403);
  });
});
