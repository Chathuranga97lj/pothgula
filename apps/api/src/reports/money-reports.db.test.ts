import { addDays, type Report, type Settlement, todayColombo } from '@pothgula/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { activityLog, appUser, bookRequest, membershipPayment } from '../db/schema';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let ksAdmin: string;
let glAdmin: string;
let staffId: number;
let copies: { id: number; accessionNo: string }[] = [];
const people: Record<string, { id: number; token: string }> = {};

const today = todayColombo();
const day = (n: number) => addDays(today, n);
const post = (token: string, path: string, body?: object) =>
  t
    .http()
    .post(path)
    .set(bearer(token))
    .send(body ?? {});
const get = (token: string, path: string) => t.http().get(path).set(bearer(token));
const report = async (token: string, kind: string, query = '') =>
  (await get(token, `/api/reports/${kind}${query}`)).body as Report;
const measure = (r: Report, key: string) => r.rows.find((x) => x.key === key)!.cells.slice(1);

async function member(name: string, branchId: number) {
  const row = await makeAccount(t, { userType: 'member', branchId, status: 'active' });
  await t.db
    .update(appUser)
    .set({ fullName: name, expireAt: day(300) })
    .where(eq(appUser.id, row.id));
  people[name] = { id: row.id, token: await signIn(t, row.whatsappPhone!) };
  return row.id;
}

beforeAll(async () => {
  t = await startApp();
  const superAdmin = await makeAccount(t, { userType: 'super_admin' });
  boss = await signIn(t, superAdmin.whatsappPhone!);
  const mk = async (branchName: string, branchCode: string) =>
    (
      await post(boss, '/api/branches', {
        branchName,
        branchCode,
        address: 'x',
        phone: '0112000001',
      })
    ).body.id as number;
  ks = await mk('Kesbewa', 'KS');
  gl = await mk('Galle', 'GL');
  await post(boss, '/api/categories', { code: 'A1', name: 'Novels' });
  copies = (
    await post(boss, '/api/titles', {
      title: 'Gamperaliya',
      categoryCode: 'A1',
      copies: { branchId: ks, count: 3 },
    })
  ).body.title.copies;
  const admin = await makeAccount(t, { userType: 'admin', branchId: ks });
  staffId = admin.id;
  ksAdmin = await signIn(t, admin.whatsappPhone!);
  glAdmin = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: gl })).whatsappPhone!,
  );
  await t
    .http()
    .patch(`/api/branches/${ks}/tariff`)
    .set(bearer(ksAdmin))
    .send({
      amounts: [{ categoryCode: 'A1', amountCents: 150000 }],
    });

  // Membership money: one renewal, one first fee, one waiver at KS; one renewal at GL.
  const asha = await member('Asha', ks);
  const bandu = await member('Bandu', ks);
  const chamari = await member('Chamari', gl);
  await t.db.insert(membershipPayment).values([
    {
      userId: asha,
      kind: 'fee',
      amountCents: 50000,
      paidOn: today,
      receiptNo: 'F-1',
      collectedBy: staffId,
      extendsTo: day(365),
    },
    {
      userId: bandu,
      kind: 'first_fee',
      amountCents: 50000,
      paidOn: today,
      receiptNo: 'F-2',
      collectedBy: staffId,
      extendsTo: day(365),
    },
    {
      userId: bandu,
      kind: 'waiver',
      amountCents: 0,
      paidOn: day(-400),
      collectedBy: staffId,
      reason: 'School programme',
      extendsTo: day(-35),
    },
    {
      userId: chamari,
      kind: 'fee',
      amountCents: 40000,
      paidOn: today,
      receiptNo: 'G-1',
      collectedBy: staffId,
      extendsTo: day(365),
    },
  ]);
});

afterAll(async () => {
  await t.close();
});

describe('lost-book money and the missing-books report (FR-RPT-03, FR-RPT-07)', () => {
  let paid: Settlement;
  let open: Settlement;

  beforeAll(async () => {
    const declare = async (who: string, copy: { accessionNo: string }) => {
      const loan = await post(ksAdmin, '/api/loans', {
        memberId: people[who]!.id,
        accessionNo: copy.accessionNo,
      });
      return (
        await post(ksAdmin, `/api/loans/${loan.body.id}/lost`, { kind: 'lost', reason: 'Lost' })
      ).body as Settlement;
    };
    paid = await declare('Asha', copies[0]!);
    await post(ksAdmin, `/api/settlements/${paid.id}/pay`, {
      amountCents: 150000,
      receiptNo: 'L-1',
    });
    open = await declare('Bandu', copies[1]!);
  });

  it('keeps lost-book money apart from fees, branch by branch', async () => {
    const r = await report(boss, 'fees');
    expect(r.columns.map((c) => c.label)).toEqual(['Measure', 'GL', 'KS', 'Whole library']);
    expect(measure(r, 'annualFees')).toEqual(['400.00', '500.00', '900.00']);
    expect(measure(r, 'firstFees')).toEqual(['0.00', '500.00', '500.00']);
    expect(measure(r, 'feesNet')).toEqual(['400.00', '1,000.00', '1,400.00']);
    expect(measure(r, 'lostPayments')).toEqual(['0.00', '1,500.00', '1,500.00']);
    expect(measure(r, 'lostNet')).toEqual(['0.00', '1,500.00', '1,500.00']);
    // The waiver was before the period.
    expect(measure(r, 'firstFeeWaivers')).toEqual([0, 0, 0]);
    const longer = await report(boss, 'fees', `?from=${day(-500)}&to=${today}&branchId=${ks}`);
    expect(measure(longer, 'firstFeeWaivers')).toEqual([1]);
    expect((await get(glAdmin, `/api/reports/fees?branchId=${ks}`)).status).toBe(403);
  });

  it('shows a reversal as a negative amount, and the net after it', async () => {
    const paymentId = ((await get(ksAdmin, `/api/settlements/${paid.id}`)).body as Settlement)
      .payments[0]!.id;
    await post(boss, `/api/settlements/${paid.id}/payments/${paymentId}/reverse`, {
      reason: 'Wrong member',
    });
    const r = await report(ksAdmin, 'fees');
    expect(measure(r, 'lostReversals')).toEqual(['-1,500.00']);
    expect(measure(r, 'lostNet')).toEqual(['0.00']);
  });

  it('lists every copy missing or not useable, with its member and settlement', async () => {
    // A copy lost on the road between branches has no member.
    await t.db.insert(bookRequest).values({
      titleId: (await get(boss, `/api/settlements/${open.id}`)).body.titleId,
      copyId: copies[2]!.id,
      userId: people.Chamari!.id,
      fromBranchId: ks,
      toBranchId: gl,
      status: 'lost_in_transit',
      decidedAt: new Date(),
      decidedBy: staffId,
      dispatchedAt: new Date(),
      lostReason: 'Bus',
    });
    await t
      .http()
      .patch(`/api/copies/${copies[2]!.id}`)
      .set(bearer(boss))
      .send({ condition: 'missing' });

    const r = await report(ksAdmin, 'missing');
    const rows = r.rows.map((x) => x.cells);
    expect(r.columns.map((c) => c.key)).toEqual([
      'accessionNo',
      'title',
      'category',
      'how',
      'member',
      'declared',
      'amountSet',
      'settlement',
    ]);
    expect(rows).toContainEqual([
      copies[1]!.accessionNo,
      'Gamperaliya',
      'A1',
      'Lost by a member',
      'Bandu',
      today,
      '1,500.00',
      'Open',
    ]);
    // Paid and then reversed: open again.
    expect(rows.find((c) => c[0] === copies[0]!.accessionNo)!.slice(4)).toEqual([
      'Asha',
      today,
      '1,500.00',
      'Open',
    ]);
    expect(rows.find((c) => c[0] === copies[2]!.accessionNo)!.slice(3, 5)).toEqual([
      'Lost on the way between branches',
      null,
    ]);
    expect(r.rows.find((x) => x.cells[0] === copies[1]!.accessionNo)!.link).toBe(
      `/lost-books/${open.id}`,
    );
  });

  it('counts unsettled lost books at a glance (FR-RPT-06)', async () => {
    const r = await report(boss, 'summary');
    expect(measure(r, 'unsettledLostBooks')).toEqual([0, 2, 2]);
  });
});

describe('membership over time (FR-RPT-04)', () => {
  it('counts applications, approvals, rejections, renewals, suspensions and lapses by month', async () => {
    const month = today.slice(0, 7);
    const dani = await member('Dani', ks);
    await t.db
      .update(appUser)
      .set({ appliedAt: new Date(), approvedAt: new Date() })
      .where(eq(appUser.id, dani));
    // Ran out this month, not renewed.
    const ella = await member('Ella', ks);
    await t.db
      .update(appUser)
      .set({ expireAt: day(-1) })
      .where(eq(appUser.id, ella));
    await t.db.insert(activityLog).values([
      { actorRole: 'system', action: 'application.reject', entity: 'app_user', branchId: ks },
      { actorRole: 'system', action: 'member.suspend', entity: 'app_user', branchId: ks },
      { actorRole: 'system', action: 'member.suspend', entity: 'app_user', branchId: gl },
    ]);
    const r = await report(ksAdmin, 'membership');
    expect(r.columns.map((c) => c.key)).toEqual([
      'month',
      'applications',
      'approvals',
      'rejections',
      'renewals',
      'suspensions',
      'lapsed',
    ]);
    const thisMonth = r.rows.find((x) => x.cells[0] === month)!.cells;
    const lapsed = day(-1) >= `${month}-01` ? 1 : 0;
    expect(thisMonth).toEqual([month, 1, 1, 1, 1, 1, lapsed]);
    expect(r.rows).toHaveLength(13);
    const all = await report(boss, 'membership');
    expect(all.total![5]).toBe(2);
    const suspended = await t.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, 'member.suspend')));
    expect(suspended).toHaveLength(2);
  });
});

describe('receipts (FR-MEM-07)', () => {
  it('prints one for a fee, for staff of the branch and for the member, and logs each', async () => {
    const [fee] = await t.db
      .select()
      .from(membershipPayment)
      .where(eq(membershipPayment.receiptNo, 'F-1'));
    const staff = await get(ksAdmin, `/api/receipts/membership/${fee!.id}`);
    expect(staff.status).toBe(200);
    expect(staff.headers['content-type']).toBe('application/pdf');
    expect(staff.headers['content-disposition']).toContain('receipt-F-1.pdf');
    expect((await get(people.Asha!.token, `/api/receipts/membership/${fee!.id}`)).status).toBe(200);
    expect((await get(people.Bandu!.token, `/api/receipts/membership/${fee!.id}`)).status).toBe(
      404,
    );
    expect((await get(glAdmin, `/api/receipts/membership/${fee!.id}`)).status).toBe(403);
    const printed = await t.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, 'receipt.print'));
    expect(printed).toHaveLength(2);
  });

  it('has nothing to print for a waived fee', async () => {
    const [waiver] = await t.db
      .select()
      .from(membershipPayment)
      .where(eq(membershipPayment.kind, 'waiver'));
    expect((await get(ksAdmin, `/api/receipts/membership/${waiver!.id}`)).body.code).toBe(
      'no_receipt',
    );
  });

  it('prints one for lost-book money, and a credit note for its reversal', async () => {
    const s = (
      (await get(ksAdmin, `/api/members/${people.Asha!.id}/settlements`)).body as Settlement[]
    )[0]!;
    const [payment, reversal] = s.payments;
    const res = await get(ksAdmin, `/api/receipts/settlement/${payment!.id}`);
    expect(res.headers['content-disposition']).toContain('receipt-L-1.pdf');
    const credit = await get(ksAdmin, `/api/receipts/settlement/${reversal!.id}`);
    expect(credit.headers['content-disposition']).toContain('receipt-L-1-R.pdf');
  });
});
