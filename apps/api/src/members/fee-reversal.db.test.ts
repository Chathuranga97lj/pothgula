import { addDays, type MemberDetail, type StaffDashboard, todayColombo } from '@pothgula/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { activityLog, appUser, bookRequest, membershipPayment } from '../db/schema';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let ksAdmin: string;
let staffId: number;
let memberId: number;

const today = todayColombo();
const day = (n: number) => addDays(today, n);
const post = (token: string, path: string, body?: object) =>
  t
    .http()
    .post(path)
    .set(bearer(token))
    .send(body ?? {});
const get = (token: string, path: string) => t.http().get(path).set(bearer(token));

beforeAll(async () => {
  t = await startApp();
  boss = await signIn(t, (await makeAccount(t, { userType: 'super_admin' })).whatsappPhone!);
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
  const admin = await makeAccount(t, { userType: 'admin', branchId: ks });
  staffId = admin.id;
  ksAdmin = await signIn(t, admin.whatsappPhone!);
  const m = await makeAccount(t, { userType: 'member', branchId: ks, status: 'active' });
  memberId = m.id;
  // Approved a year ago with the first fee; renewed once already.
  await t.db
    .update(appUser)
    .set({ expireAt: day(30) })
    .where(eq(appUser.id, memberId));
  await t.db.insert(membershipPayment).values([
    {
      userId: memberId,
      kind: 'first_fee',
      amountCents: 50000,
      paidOn: day(-335),
      receiptNo: 'F-1',
      collectedBy: staffId,
      extendsTo: day(30),
    },
  ]);
});

afterAll(async () => {
  await t.close();
});

describe('reversing a membership fee (FR-MEM-05)', () => {
  let renewal: number;

  it('reverses the latest renewal, keeping it, and puts the expiry back', async () => {
    const renewed = (
      await post(ksAdmin, `/api/members/${memberId}/renew`, {
        amountCents: 50000,
        receiptNo: 'F-2',
      })
    ).body as MemberDetail;
    expect(renewed.expireAt).toBe(addDays(day(30), 365));
    renewal = renewed.payments.find((p) => p.receiptNo === 'F-2')!.id;

    expect(
      (await post(ksAdmin, `/api/members/${memberId}/payments/${renewal}/reverse`, { reason: 'x' }))
        .status,
    ).toBe(403);
    const res = await post(boss, `/api/members/${memberId}/payments/${renewal}/reverse`, {
      reason: 'Taken from the wrong member',
    });
    expect(res.status).toBe(200);
    const after = res.body as MemberDetail;
    expect(after.expireAt).toBe(day(30));
    expect(after.payments.map((p) => [p.kind, p.amountCents, p.reversesPaymentId])).toEqual(
      expect.arrayContaining([
        ['fee', 50000, null],
        ['reversal', -50000, renewal],
      ]),
    );
    const [entry] = await t.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, 'membership.reverse'));
    expect(entry).toMatchObject({
      beforeData: { expireAt: addDays(day(30), 365), paymentId: renewal },
      afterData: { expireAt: day(30), reason: 'Taken from the wrong member' },
    });
  });

  it('refuses a second reversal, a first fee, and an earlier renewal', async () => {
    expect(
      (await post(boss, `/api/members/${memberId}/payments/${renewal}/reverse`, { reason: 'x' }))
        .body.code,
    ).toBe('payment_reversed');
    const [first] = await t.db
      .select()
      .from(membershipPayment)
      .where(eq(membershipPayment.receiptNo, 'F-1'));
    expect(
      (await post(boss, `/api/members/${memberId}/payments/${first!.id}/reverse`, { reason: 'x' }))
        .body.code,
    ).toBe('payment_not_reversible');

    const a = (
      await post(ksAdmin, `/api/members/${memberId}/renew`, {
        amountCents: 50000,
        receiptNo: 'F-3',
      })
    ).body as MemberDetail;
    await post(ksAdmin, `/api/members/${memberId}/renew`, { amountCents: 50000, receiptNo: 'F-4' });
    const earlier = a.payments.find((p) => p.receiptNo === 'F-3')!.id;
    expect(
      (await post(boss, `/api/members/${memberId}/payments/${earlier}/reverse`, { reason: 'x' }))
        .body.code,
    ).toBe('reversal_not_latest');
  });

  it('shows the reversal on the fee collection report', async () => {
    const r = (await get(boss, `/api/reports/fees?branchId=${ks}`)).body;
    const row = r.rows.find((x: { key: string }) => x.key === 'feeReversals');
    expect(row.cells[1]).toBe('-500.00');
  });
});

describe('books lost on the road at the top (FR-NOT-09)', () => {
  it('counts a copy written off in transit at its branch until it is found', async () => {
    await post(boss, '/api/categories', { code: 'A1', name: 'Novels' });
    const title = (
      await post(boss, '/api/titles', {
        title: 'Madol Doova',
        categoryCode: 'A1',
        copies: { branchId: gl, count: 1 },
      })
    ).body.title;
    const copyId = title.copies[0].id as number;
    await t.db.insert(bookRequest).values({
      titleId: title.id,
      copyId,
      userId: memberId,
      fromBranchId: gl,
      toBranchId: ks,
      status: 'lost_in_transit',
      decidedAt: new Date(),
      decidedBy: staffId,
      dispatchedAt: new Date(),
      lostReason: 'Bus',
    });
    await t.http().patch(`/api/copies/${copyId}`).set(bearer(boss)).send({ condition: 'missing' });
    const counts = async () =>
      ((await get(boss, '/api/dashboard')).body as StaffDashboard).branches.find(
        (b) => b.branchId === gl,
      )!;
    const before = await counts();
    expect(before.counts.lost_in_transit).toBe(1);
    expect(before.items[0]).toMatchObject({ kind: 'lost_in_transit', tone: 'urgent' });
    await post(boss, `/api/copies/${copyId}/found`, { reason: 'At the depot' });
    expect((await counts()).counts.lost_in_transit).toBe(0);
  });
});
