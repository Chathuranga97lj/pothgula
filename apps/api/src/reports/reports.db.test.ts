import { addDays, type Report, todayColombo } from '@pothgula/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { appUser, borrow, membershipPayment } from '../db/schema';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let bossId: number;
let ksLibrarian: string;
let memberToken: string;

const today = todayColombo();
const day = (n: number) => addDays(today, n);
const titles: Record<string, number> = {};
const copies: Record<string, number | undefined> = {};
const people: Record<string, number> = {};

const get = (token: string, path: string, query: Record<string, string> = {}) =>
  t.http().get(path).query(query).set(bearer(token));
const report = async (token: string, kind: string, query: Record<string, string> = {}) => {
  const res = await get(token, `/api/reports/${kind}`, query);
  expect(res.status).toBe(200);
  return res.body as Report;
};
const column = (r: Report, key: string) => r.columns.findIndex((c) => c.key === key);
const measure = (r: Report, key: string) => r.rows.find((x) => x.key === key)!.cells;

beforeAll(async () => {
  t = await startApp();
  const superAdmin = await makeAccount(t, { userType: 'super_admin' });
  bossId = superAdmin.id;
  boss = await signIn(t, superAdmin.whatsappPhone!);
  const mk = (b: object) => t.http().post('/api/branches').set(bearer(boss)).send(b);
  ks = (await mk({ branchName: 'Kesbewa', branchCode: 'KS', address: 'x', phone: '0112000001' }))
    .body.id;
  gl = (await mk({ branchName: 'Galle', branchCode: 'GL', address: 'y', phone: '0912000002' })).body
    .id;
  for (const [code, name] of [
    ['A1', 'Sinhala novels'],
    ['B1', 'English'],
  ]) {
    await t.http().post('/api/categories').set(bearer(boss)).send({ code, name });
  }
  ksLibrarian = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: ks })).whatsappPhone!,
  );

  // Titles and copies: T1 at both branches, T2 and T3 at Kesbewa only.
  const add = async (key: string, title: string, categoryCode: string, count: number) => {
    const res = await t
      .http()
      .post('/api/titles')
      .set(bearer(boss))
      .send({ title, categoryCode, copies: { branchId: ks, count } });
    titles[key] = res.body.title.id;
    return (res.body.title.copies as { id: number }[]).map((c) => c.id);
  };
  [copies.k1, copies.k2] = await add('T1', 'කලියුගය', 'A1', 2);
  [copies.k3, copies.k5] = await add('T2', 'Gamperaliya', 'A1', 2);
  [copies.k4, copies.k6] = await add('T3', 'Matilda', 'B1', 2);
  const gle = await t
    .http()
    .post(`/api/titles/${titles.T1}/copies`)
    .set(bearer(boss))
    .send({ branchId: gl, count: 1 });
  copies.g1 = (gle.body.title.copies as { id: number; branchId: number }[]).find(
    (c) => c.branchId === gl,
  )!.id;
  await t
    .http()
    .post(`/api/copies/${copies.k5}/withdraw`)
    .set(bearer(boss))
    .send({ reason: 'damaged' });
  await t.http().patch(`/api/copies/${copies.k6}`).set(bearer(boss)).send({ condition: 'missing' });

  const member = async (
    name: string,
    opts: {
      branchId?: number;
      dob?: string | null;
      status?: 'active' | 'pending' | 'suspended';
      expireAt?: string;
    },
  ) => {
    const row = await makeAccount(t, {
      userType: 'member',
      branchId: opts.branchId ?? ks,
      status: opts.status ?? 'active',
    });
    await t.db
      .update(appUser)
      .set({ fullName: name, dateOfBirth: opts.dob ?? null, expireAt: opts.expireAt ?? day(200) })
      .where(eq(appUser.id, row.id));
    people[name] = row.id;
    return row;
  };
  const asha = await member('Asha', { dob: addDays(today, -11 * 366) }); // 10 → under 13
  await member('Bimal', { dob: '1990-01-01' });
  await member('Chamari', {});
  await member('Dinesh', { expireAt: day(-1) });
  await member('Eranga', { status: 'pending' });
  await member('Farah', { status: 'suspended' });
  await member('Gayan', { branchId: gl, dob: '1950-01-01' });
  memberToken = await signIn(t, asha.whatsappPhone!);

  const loan = async (
    who: string,
    copy: string,
    borrowed: number,
    opts: { returned?: number; due?: number; voided?: boolean; branchId?: number } = {},
  ) => {
    const original = day(borrowed + 14);
    await t.db.insert(borrow).values({
      copyId: copies[copy]!,
      userId: people[who]!,
      branchId: opts.branchId ?? ks,
      borrowDate: day(borrowed),
      dueDate: opts.due === undefined ? original : day(opts.due),
      originalDueDate: original,
      issuedBy: bossId,
      returnedOn: opts.returned === undefined ? null : day(opts.returned),
      receivedBy: opts.returned === undefined ? null : bossId,
      ...(opts.voided ? { voidedAt: new Date(), voidedBy: bossId, voidReason: 'mistake' } : {}),
    });
  };
  await loan('Asha', 'k2', -60, { returned: -44 }); // 2 days late
  await loan('Asha', 'k1', -40, { returned: -20 }); // 6 days late
  await loan('Bimal', 'k3', -30); // overdue by 16
  await loan('Bimal', 'k1', -10); // due in 4
  await loan('Bimal', 'k4', -3, { voided: true });
  await loan('Chamari', 'k2', 0, { due: 28 }); // extended
  await loan('Gayan', 'g1', -5, { branchId: gl });

  await t.db.insert(membershipPayment).values({
    userId: people.Bimal!,
    kind: 'first_fee',
    amountCents: 50_000,
    paidOn: today,
    receiptNo: 'R-1',
    collectedBy: bossId,
    extendsTo: day(365),
  });
});

afterAll(async () => {
  await t.close();
});

describe('who sees which reports (FR-RPT-10)', () => {
  it('keeps members out, and admins to their own branch', async () => {
    expect((await get(memberToken, '/api/reports/summary')).status).toBe(403);
    const other = await get(ksLibrarian, '/api/reports/summary', { branchId: String(gl) });
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('other_branch');
    const own = await report(ksLibrarian, 'summary');
    expect(own.branch).toMatchObject({ branchId: ks, branchCode: 'KS' });
  });

  it('refuses a report that does not exist, and a backwards period', async () => {
    const res = await get(boss, '/api/reports/salaries');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('report_not_found');
    const back = await get(boss, '/api/reports/popular', { from: day(0), to: day(-5) });
    expect(back.status).toBe(400);
  });
});

describe('at a glance (FR-RPT-06)', () => {
  it("counts one branch's stock, loans, members and this month's fees", async () => {
    const r = await report(ksLibrarian, 'summary');
    expect(r.columns.map((c) => c.key)).toEqual(['measure', 'value']);
    expect(measure(r, 'titles')).toEqual(['Titles held', 3]);
    expect(measure(r, 'copies')).toEqual(['Copies held', 5]);
    expect(measure(r, 'onLoan')).toEqual(['On loan now', 3]);
    expect(measure(r, 'overdue')).toEqual(['Overdue now', 1]);
    expect(measure(r, 'activeMembers')[1]).toBe(3);
    expect(measure(r, 'expiredMembers')[1]).toBe(1);
    expect(measure(r, 'suspendedMembers')[1]).toBe(1);
    expect(measure(r, 'waitingApplications')[1]).toBe(1);
    expect(measure(r, 'feesThisMonth')[1]).toBe('500.00');
    expect(measure(r, 'topThisMonth')[1]).toBe('කලියුගය (1)');
  });

  it('puts each branch beside the whole library for a super admin, without double counting titles', async () => {
    const r = await report(boss, 'summary');
    expect(r.branch).toBeNull();
    expect(r.columns.map((c) => c.key)).toEqual(['measure', 'branch:GL', 'branch:KS', 'total']);
    // T1 is held at both branches: once in the whole library, not twice.
    expect(measure(r, 'titles')).toEqual(['Titles held', 1, 3, 3]);
    expect(measure(r, 'copies')).toEqual(['Copies held', 1, 5, 6]);
    expect(measure(r, 'onLoan')).toEqual(['On loan now', 1, 3, 4]);
    expect(measure(r, 'activeMembers')).toEqual(['Active members', 1, 3, 4]);
    expect(measure(r, 'feesThisMonth')).toEqual([
      'Fees collected this month (Rs)',
      '0.00',
      '500.00',
      '500.00',
    ]);
  });
});

describe('stock (FR-RPT-01)', () => {
  it('counts copies by category and where they are, with a total', async () => {
    const r = await report(ksLibrarian, 'stock');
    expect(r.rows.map((x) => x.cells)).toEqual([
      ['A1', 'Sinhala novels', 2, 4, 0, 3, 0, 0, 1],
      ['B1', 'English', 1, 2, 1, 0, 1, 0, 0],
    ]);
    expect(r.total).toEqual(['Total', null, 3, 6, 1, 3, 1, 0, 1]);
  });

  it('compares branches for the whole library', async () => {
    const r = await report(boss, 'stock', { by: 'branch' });
    expect(r.rows.map((x) => x.cells.slice(0, 4))).toEqual([
      ['GL', 'Galle', 1, 1],
      ['KS', 'Kesbewa', 3, 6],
    ]);
    expect(r.total!.slice(0, 4)).toEqual(['Total', null, 3, 7]);
  });
});

describe('books out (FR-RPT-02)', () => {
  it('lists open loans, longest overdue first, showing extensions', async () => {
    const r = await report(ksLibrarian, 'loans');
    expect(r.rows.map((x) => x.cells[column(r, 'member')])).toEqual(['Bimal', 'Bimal', 'Chamari']);
    expect(r.rows[0]!.cells[column(r, 'daysLate')]).toBe(16);
    expect(r.rows[2]!.cells[column(r, 'extendedFrom')]).toBe(day(14));
    expect(r.rows[0]!.link).toMatch(/^\/loans\/\d+$/);
    expect(column(r, 'branch')).toBe(-1);
    const all = await report(boss, 'loans');
    expect(all.rows).toHaveLength(4);
    expect(column(all, 'branch')).toBe(0);
  });
});

describe('most and least borrowed (FR-RPT-05)', () => {
  it('counts every copy of a title together, leaving out voided loans', async () => {
    const r = await report(ksLibrarian, 'popular');
    expect(r.rows.map((x) => x.cells.slice(1, 5))).toEqual([
      ['කලියුගය', null, 'A1', 4],
      ['Gamperaliya', null, 'A1', 1],
    ]);
    expect(r.rows[0]!.link).toBe(`/titles/${titles.T1}`);
    const all = await report(boss, 'popular');
    expect(all.rows[0]!.cells[4]).toBe(5);
  });

  it('finds the least borrowed among titles on hand, never-borrowed first, and filters by category', async () => {
    const r = await report(ksLibrarian, 'popular', { order: 'least' });
    expect(r.rows.map((x) => [x.cells[1], x.cells[4], x.cells[5]])).toEqual([
      ['Matilda', 0, 2],
      ['Gamperaliya', 1, 1],
      ['කලියුගය', 4, 2],
    ]);
    const b1 = await report(ksLibrarian, 'popular', { order: 'least', category: 'B1' });
    expect(b1.rows.map((x) => x.cells[1])).toEqual(['Matilda']);
  });

  it('covers only the period asked for', async () => {
    const r = await report(ksLibrarian, 'popular', { from: day(-15), to: day(0) });
    expect(r.rows.map((x) => [x.cells[1], x.cells[4]])).toEqual([['කලියුගය', 2]]);
    expect(r).toMatchObject({ from: day(-15), to: day(0) });
  });
});

describe('borrowing by month (FR-RPT-08)', () => {
  it('has a row for every month in the period and a column per category borrowed', async () => {
    const r = await report(ksLibrarian, 'borrowing');
    expect(r.columns.map((c) => c.key)).toEqual(['month', 'category:A1', 'total']);
    expect(r.rows.length).toBeGreaterThanOrEqual(12);
    expect(r.rows[r.rows.length - 1]!.cells[0]).toBe(today.slice(0, 7));
    expect(r.total).toEqual(['Total', 5, 5]);
  });
});

describe('late returns (FR-RPT-15)', () => {
  it('ranks members by late returns, with the average days late per branch', async () => {
    const r = await report(ksLibrarian, 'late');
    expect(r.rows.map((x) => x.cells)).toEqual([['Asha', 'KS', 2, 4, 6]]);
    expect(r.rows[0]!.link).toBe(`/members/${people.Asha}`);
    expect(r.about).toContain('KS: 2 late returns, 4.0 days late on average.');
    expect(r.total).toEqual(['All late returns', null, 2, 4, 6]);
  });
});

describe('members by age (FR-RPT-11)', () => {
  it('bands active members by age, with those without a date of birth apart', async () => {
    const r = await report(ksLibrarian, 'ages');
    const counts = Object.fromEntries(r.rows.map((x) => [x.key, x.cells[1]]));
    expect(counts).toMatchObject({ under13: 1, age26to40: 1, unknown: 1, over60: 0 });
    expect(r.total).toEqual(['Total', 3, '100%']);
    const all = await report(boss, 'ages');
    expect(all.columns.map((c) => c.key)).toEqual([
      'ageBand',
      'branch:GL',
      'branch:KS',
      'members',
      'share',
    ]);
    expect(all.rows.find((x) => x.key === 'over60')!.cells).toEqual([
      '61 and over',
      1,
      0,
      1,
      '25%',
    ]);
  });
});

describe('taking a report away (FR-RPT-09)', () => {
  const exp = (format: string) =>
    get(ksLibrarian, '/api/reports/stock/export', { format }).buffer(true);

  it('writes CSV, text and PDF with the branch and the total', async () => {
    const csv = await exp('csv');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toBe(
      `attachment; filename="report-stock-KS-${today}.csv"`,
    );
    const lines = csv.text.slice(1).split('\r\n');
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toBe(
      'Category,Name,Titles,All copies,On the shelf,On loan,Missing,Not useable,Withdrawn',
    );
    expect(lines).toContain('Total,,3,6,1,3,1,0,1');

    const txt = await exp('txt');
    expect(txt.text).toContain('Stock');
    expect(txt.text).toContain('Branch: KS — Kesbewa');
    expect(txt.text).toMatch(/Total\s+—\s+3\s+6/);

    const pdf = await exp('pdf');
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await exp('xlsx')).status).toBe(400);
  });
});
