import {
  addDays,
  type IssueCheck,
  type Loan,
  type MemberDashboard,
  type Settlement,
  type SettlementBoard,
  type StaffDashboard,
  type Tariff,
  todayColombo,
} from '@pothgula/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { activityLog, appUser, bookRequest, bookSettlement, borrow } from '../db/schema';
import { syncSuspensions } from './suspension';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let ksAdmin: string;
let glAdmin: string;
let novels: { id: number; accessionNo: string }[] = [];
let poems: { id: number; accessionNo: string }[] = [];
let novelTitle: number;
let glTitle: number;

const today = todayColombo();
const day = (n: number) => addDays(today, n);
const people: Record<string, { id: number; token: string }> = {};

async function member(name: string) {
  const row = await makeAccount(t, { userType: 'member', branchId: ks, status: 'active' });
  await t.db
    .update(appUser)
    .set({ fullName: name, expireAt: day(300) })
    .where(eq(appUser.id, row.id));
  people[name] = { id: row.id, token: await signIn(t, row.whatsappPhone!) };
  return people[name]!;
}

const post = (token: string, path: string, body?: object) =>
  t
    .http()
    .post(path)
    .set(bearer(token))
    .send(body ?? {});
const patch = (token: string, path: string, body: object) =>
  t.http().patch(path).set(bearer(token)).send(body);
const get = (token: string, path: string) => t.http().get(path).set(bearer(token));
const issue = async (who: string, accessionNo: string) => {
  const res = await post(ksAdmin, '/api/loans', { memberId: people[who]!.id, accessionNo });
  expect(res.status).toBe(201);
  return res.body as Loan;
};
const check = async (who: string, accessionNo: string) =>
  (await post(ksAdmin, '/api/loans/check', { memberId: people[who]!.id, accessionNo }))
    .body as IssueCheck;
const state = async (copyId: number) =>
  (
    await t.db.execute<{ state: string }>(
      sql`SELECT state FROM copy_availability WHERE copy_id = ${copyId}`,
    )
  ).rows[0]!.state;
const actions = async (entity: string, id: number) =>
  (
    await t.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entity, entity), eq(activityLog.entityId, String(id))))
      .orderBy(activityLog.id)
  ).map((e) => e.action);
const status = async (userId: number) =>
  (await t.db.select({ s: appUser.status }).from(appUser).where(eq(appUser.id, userId)))[0]!.s;
const counts = async (token: string, branchId: number) =>
  ((await get(token, '/api/dashboard')).body as StaffDashboard).branches.find(
    (b) => b.branchId === branchId,
  )!.counts;

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
  await post(boss, '/api/categories', { code: 'B2', name: 'Poetry' });
  const n = await post(boss, '/api/titles', {
    title: 'Gamperaliya',
    categoryCode: 'A1',
    copies: { branchId: ks, count: 6 },
  });
  novelTitle = n.body.title.id;
  novels = n.body.title.copies;
  poems = (
    await post(boss, '/api/titles', {
      title: 'Sandesha',
      categoryCode: 'B2',
      copies: { branchId: ks, count: 2 },
    })
  ).body.title.copies;
  glTitle = (
    await post(boss, '/api/titles', {
      title: 'Madol Doova',
      categoryCode: 'A1',
      copies: { branchId: gl, count: 1 },
    })
  ).body.title.id;
  ksAdmin = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: ks })).whatsappPhone!,
  );
  glAdmin = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: gl })).whatsappPhone!,
  );
});

afterAll(async () => {
  await t.close();
});

describe('the lost-book tariff (FR-LST-16)', () => {
  it('starts empty, is kept by the branch’s admins, and logs old and new amounts', async () => {
    const empty = (await get(ksAdmin, `/api/branches/${ks}/tariff`)).body as Tariff;
    expect(empty.rows.map((r) => [r.categoryCode, r.amountCents])).toEqual([
      ['A1', null],
      ['B2', null],
    ]);
    const saved = await patch(ksAdmin, `/api/branches/${ks}/tariff`, {
      amounts: [{ categoryCode: 'A1', amountCents: 120000 }],
    });
    expect(saved.status).toBe(200);
    await patch(ksAdmin, `/api/branches/${ks}/tariff`, {
      amounts: [
        { categoryCode: 'A1', amountCents: 150000 },
        { categoryCode: 'B2', amountCents: null },
      ],
    });
    const after = (await get(ksAdmin, `/api/branches/${ks}/tariff`)).body as Tariff;
    expect(after.rows[0]).toMatchObject({ amountCents: 150000, updatedByName: expect.any(String) });
    const entries = await t.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, 'tariff.update'))
      .orderBy(activityLog.id);
    expect(entries.map((e) => [e.beforeData, e.afterData])).toEqual([
      [
        { categoryCode: 'A1', amountCents: null },
        { categoryCode: 'A1', amountCents: 120000 },
      ],
      [
        { categoryCode: 'A1', amountCents: 120000 },
        { categoryCode: 'A1', amountCents: 150000 },
      ],
    ]);
    const same = await patch(ksAdmin, `/api/branches/${ks}/tariff`, {
      amounts: [{ categoryCode: 'A1', amountCents: 150000 }],
    });
    expect(same.body.code).toBe('nothing_to_change');
  });

  it('is another branch’s to keep, and prints for the counter', async () => {
    expect((await get(glAdmin, `/api/branches/${ks}/tariff`)).status).toBe(403);
    expect(
      (
        await patch(glAdmin, `/api/branches/${ks}/tariff`, {
          amounts: [{ categoryCode: 'A1', amountCents: 1 }],
        })
      ).status,
    ).toBe(403);
    const csv = await get(ksAdmin, `/api/branches/${ks}/tariff/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('A1,Novels,"1,500.00"');
    const pdf = await get(boss, `/api/branches/${ks}/tariff/export?format=pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });
});

describe('declaring a copy lost (FR-LST-01, FR-LST-02, FR-LST-04)', () => {
  let loan: Loan;
  let settlement: Settlement;

  it('quotes the owning branch’s tariff and the window before anything is written', async () => {
    await member('Nimal');
    loan = await issue('Nimal', novels[0]!.accessionNo);
    // Overdue by ten days when it is declared.
    await t.db
      .update(borrow)
      .set({ borrowDate: day(-30), dueDate: day(-10), originalDueDate: day(-10) })
      .where(eq(borrow.id, loan.id));
    const quote = await get(ksAdmin, `/api/loans/${loan.id}/lost`);
    expect(quote.body).toMatchObject({
      tariffCents: 150000,
      windowDays: 100,
      windowEnds: day(100),
      copyBranch: { code: 'KS' },
    });
  });

  it('needs a reason to depart from the tariff', async () => {
    const res = await post(ksAdmin, `/api/loans/${loan.id}/lost`, {
      kind: 'lost',
      reason: 'Left on a bus',
      amountCents: 100000,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('amount_reason_required');
  });

  it('ends the loan, takes the copy out of circulation and opens the settlement', async () => {
    const res = await post(ksAdmin, `/api/loans/${loan.id}/lost`, {
      kind: 'lost',
      reason: 'Left on a bus',
    });
    expect(res.status).toBe(201);
    settlement = res.body as Settlement;
    expect(settlement).toMatchObject({
      status: 'open',
      memberName: 'Nimal',
      tariffCents: 150000,
      setAmountCents: 150000,
      amountDueCents: 150000,
      windowEnds: day(100),
      daysLeft: 100,
      windowPassed: false,
      declaredOn: today,
    });
    expect(await state(novels[0]!.id)).toBe('missing');
    const after = (await get(ksAdmin, `/api/loans/${loan.id}`)).body as Loan;
    expect(after).toMatchObject({
      status: 'lost',
      returnedOn: today,
      daysLate: 0,
      settlementId: settlement.id,
    });
    // Not a late return, though it was ten days overdue (FR-LST-01).
    const standing = (await get(ksAdmin, `/api/members/${people.Nimal!.id}/loans`)).body.standing;
    expect(standing).toMatchObject({ openLoans: 0, overdueLoans: 0, lateReturns: 0 });
    expect((await counts(ksAdmin, ks)).returned_late_today).toBe(0);
    expect(await actions('book_settlement', settlement.id)).toEqual(['settlement.declare']);
    expect(await actions('borrow', loan.id)).toContain('borrow.lost');
  });

  it('cannot be declared twice, taken back, corrected or voided', async () => {
    const again = await post(ksAdmin, `/api/loans/${loan.id}/lost`, {
      kind: 'lost',
      reason: 'x',
    });
    expect(again.body.code).toBe('loan_not_open');
    expect((await post(ksAdmin, `/api/loans/${loan.id}/return`)).body.code).toBe('loan_lost');
    const fix = await t
      .http()
      .patch(`/api/loans/${loan.id}`)
      .set(bearer(ksAdmin))
      .send({ returnedOn: null, reason: 'oops' });
    expect(fix.body.code).toBe('loan_lost');
    expect((await post(boss, `/api/loans/${loan.id}/void`, { reason: 'x' })).body.code).toBe(
      'loan_lost',
    );
  });

  it('allows one book, not two, while it is open (FR-LST-04)', async () => {
    await issue('Nimal', novels[1]!.accessionNo);
    const second = await check('Nimal', novels[2]!.accessionNo);
    expect(second.refusals).toEqual([{ code: 'member_settling', params: { max: 1 } }]);
  });

  it('leaves the amount to staff when the category has no tariff', async () => {
    await member('Kamala');
    const l = await issue('Kamala', poems[0]!.accessionNo);
    const none = await post(ksAdmin, `/api/loans/${l.id}/lost`, { kind: 'lost', reason: 'Lost' });
    expect(none.body.code).toBe('amount_required');
    const res = await post(ksAdmin, `/api/loans/${l.id}/lost`, {
      kind: 'lost',
      reason: 'Lost',
      amountCents: 80000,
    });
    expect(res.body).toMatchObject({
      tariffCents: null,
      amountDueCents: 80000,
      amountReason: null,
    });
  });

  it('treats a book ruined beyond use the same, but sets it aside as not useable (FR-LST-11)', async () => {
    await member('Ruwan');
    const l = await issue('Ruwan', novels[3]!.accessionNo);
    const res = await post(ksAdmin, `/api/loans/${l.id}/lost`, {
      kind: 'damaged',
      reason: 'Soaked in the flood',
      amountCents: 120000,
      amountReason: 'Old paperback',
    });
    expect(res.body).toMatchObject({ kind: 'damaged', amountReason: 'Old paperback' });
    expect(await state(novels[3]!.id)).toBe('not_useable');
  });

  it('is shown to staff of the member’s branch, not another’s', async () => {
    expect((await get(glAdmin, `/api/settlements/${settlement.id}`)).status).toBe(403);
    const board = (await get(ksAdmin, '/api/settlements')).body as SettlementBoard;
    expect(board.branches[0]!.open.map((s) => s.memberName)).toEqual(['Nimal', 'Kamala', 'Ruwan']);
    const counted = await counts(ksAdmin, ks);
    expect(counted).toMatchObject({ settlements_open: 3, settlements_passed: 0 });
  });
});

describe('paying, and reversing a payment (FR-LST-07)', () => {
  let s: Settlement;
  beforeAll(async () => {
    s = (
      (await get(ksAdmin, `/api/members/${people.Nimal!.id}/settlements`)).body as Settlement[]
    )[0]!;
  });

  it('takes the amount due, with a receipt, and the limit goes back to two', async () => {
    const wrong = await post(ksAdmin, `/api/settlements/${s.id}/pay`, {
      amountCents: 100000,
      receiptNo: 'R-1',
    });
    expect(wrong.body.code).toBe('amount_mismatch');
    const paid = await post(ksAdmin, `/api/settlements/${s.id}/pay`, {
      amountCents: 150000,
      receiptNo: 'R-1',
    });
    expect(paid.body).toMatchObject({
      status: 'paid',
      settledOn: today,
      daysToSettle: 0,
      paidCents: 150000,
      payments: [{ kind: 'payment', amountCents: 150000, receiptNo: 'R-1', reversed: false }],
    });
    expect((await check('Nimal', novels[2]!.accessionNo)).refusals).toEqual([]);
  });

  it('is reversed only by a super admin, once, and the settlement is open again', async () => {
    const paymentId = ((await get(ksAdmin, `/api/settlements/${s.id}`)).body as Settlement)
      .payments[0]!.id;
    const path = `/api/settlements/${s.id}/payments/${paymentId}/reverse`;
    expect((await post(ksAdmin, path, { reason: 'Wrong member' })).status).toBe(403);
    const res = await post(boss, path, { reason: 'Wrong member' });
    expect(res.body).toMatchObject({ status: 'open', settledOn: null, paidCents: 0 });
    expect(
      (res.body as Settlement).payments.map((p) => [p.kind, p.amountCents, p.reversed]),
    ).toEqual([
      ['payment', 150000, true],
      ['reversal', -150000, false],
    ]);
    expect((await post(boss, path, { reason: 'again' })).body.code).toBe('payment_reversed');
  });

  it('never lets a payment row be changed or deleted', async () => {
    await expect(
      t.db.execute(sql`UPDATE settlement_payment SET amount_cents = 1`),
    ).rejects.toThrow();
    await expect(t.db.execute(sql`DELETE FROM settlement_payment`)).rejects.toThrow();
    await expect(t.db.execute(sql`DELETE FROM book_settlement`)).rejects.toThrow();
  });
});

describe('the window, and suspension (FR-LST-14, FR-LST-15)', () => {
  let s: Settlement;
  let requestId: number;

  it('suspends at the counter as soon as the window passes, before the job runs', async () => {
    s = (
      (await get(ksAdmin, `/api/members/${people.Nimal!.id}/settlements`)).body as Settlement[]
    )[0]!;
    // Nimal brings back the one book they may hold, and asks Galle for another.
    const [out] = await t.db
      .select({ id: borrow.id })
      .from(borrow)
      .where(and(eq(borrow.copyId, novels[1]!.id), sql`${borrow.returnedOn} IS NULL`));
    expect((await post(ksAdmin, `/api/loans/${out!.id}/return`)).status).toBe(200);
    requestId = (
      await post(people.Nimal!.token, '/api/me/requests', {
        titleId: glTitle,
        fromBranchId: gl,
      })
    ).body.id;
    expect(requestId).toBeGreaterThan(0);
    await t.db
      .update(bookSettlement)
      .set({ declaredOn: day(-101), windowEnds: day(-1) })
      .where(eq(bookSettlement.id, s.id));
    expect((await check('Nimal', novels[2]!.accessionNo)).refusals.map((r) => r.code)).toContain(
      'member_suspended',
    );
    expect(await status(people.Nimal!.id)).toBe('active');
  });

  it('the job suspends, ends the request in progress, and every panel says so', async () => {
    const run = await syncSuspensions(t.db, t.uow);
    expect(run.suspended).toEqual([people.Nimal!.id]);
    expect(await status(people.Nimal!.id)).toBe('suspended');
    const [r] = await t.db.select().from(bookRequest).where(eq(bookRequest.id, requestId));
    expect(r!.status).toBe('cancelled');
    expect(await actions('app_user', people.Nimal!.id)).toContain('member.suspend');
    expect((await syncSuspensions(t.db, t.uow)).suspended).toEqual([]);

    expect(await counts(boss, ks)).toMatchObject({ suspended: 1, settlements_passed: 1 });
    const panel = (await get(people.Nimal!.token, '/api/me/dashboard')).body as MemberDashboard;
    expect(panel.items.slice(0, 2)).toEqual([
      { kind: 'suspended', tone: 'urgent' },
      expect.objectContaining({
        kind: 'settlement',
        tone: 'urgent',
        daysLeft: -1,
        amountDueCents: 150000,
      }),
    ]);
    // Suspended members still sign in and see their own record (FR-LST-15).
    const mine = await get(people.Nimal!.token, '/api/me/settlements');
    expect(mine.status).toBe(200);
    expect(
      (await post(people.Nimal!.token, '/api/me/requests', { titleId: glTitle, fromBranchId: gl }))
        .body.code,
    ).toBe('member_suspended');
  });

  it('only a super admin extends, once; extending a passed window lifts the suspension', async () => {
    const path = `/api/settlements/${s.id}/extend`;
    expect((await post(ksAdmin, path, { days: 30, reason: 'Hospital' })).status).toBe(403);
    const res = await post(boss, path, { days: 30, reason: 'Hospital' });
    expect(res.body).toMatchObject({
      windowEnds: day(29),
      windowExtendedDays: 30,
      windowPassed: false,
    });
    expect(await status(people.Nimal!.id)).toBe('active');
    expect(await actions('app_user', people.Nimal!.id)).toContain('member.unsuspend');
    expect((await post(boss, path, { days: 5, reason: 'again' })).body.code).toBe(
      'window_extended',
    );
  });
});

describe('a replacement copy (FR-LST-05, FR-LST-06)', () => {
  it('is catalogued for the owning branch with a new number; the lost one stays lost', async () => {
    const s = (
      (await get(ksAdmin, `/api/members/${people.Kamala!.id}/settlements`)).body as Settlement[]
    )[0]!;
    const res = await post(ksAdmin, `/api/settlements/${s.id}/replace`, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'replaced', replacementAccessionNo: 'KS-B2-00003' });
    const replaced = res.body as Settlement;
    expect(await state(replaced.replacementCopyId!)).toBe('on_shelf');
    expect(await state(poems[0]!.id)).toBe('missing');
    expect(
      (
        await post(ksAdmin, `/api/settlements/${s.id}/pay`, {
          amountCents: 80000,
          receiptNo: 'x',
        })
      ).body.code,
    ).toBe('settlement_closed');
  });
});

describe('the super admin’s decisions (FR-LST-09)', () => {
  it('reduces only to a lower amount, and waives with a reason', async () => {
    const s = (
      (await get(ksAdmin, `/api/members/${people.Ruwan!.id}/settlements`)).body as Settlement[]
    )[0]!;
    expect((await post(ksAdmin, `/api/settlements/${s.id}/waive`, { reason: 'x' })).status).toBe(
      403,
    );
    const higher = await post(boss, `/api/settlements/${s.id}/reduce`, {
      amountCents: 130000,
      reason: 'x',
    });
    expect(higher.body.code).toBe('amount_not_lower');
    const lower = await post(boss, `/api/settlements/${s.id}/reduce`, {
      amountCents: 60000,
      reason: 'Hardship',
    });
    expect(lower.body).toMatchObject({
      setAmountCents: 120000,
      amountDueCents: 60000,
      reductionReason: 'Hardship',
    });
    const waived = await post(boss, `/api/settlements/${s.id}/waive`, { reason: 'Flood victim' });
    expect(waived.body).toMatchObject({ status: 'waived', waiverReason: 'Flood victim' });
    expect(await actions('book_settlement', s.id)).toEqual([
      'settlement.declare',
      'settlement.reduce',
      'settlement.waive',
    ]);
  });
});

describe('a lost copy found again (FR-LST-12)', () => {
  it('comes back only through a super admin, and closes an open settlement', async () => {
    const s = (
      (await get(ksAdmin, `/api/members/${people.Nimal!.id}/settlements`)).body as Settlement[]
    )[0]!;
    const edit = await t
      .http()
      .patch(`/api/copies/${s.copyId}`)
      .set(bearer(ksAdmin))
      .send({ condition: 'useable' });
    expect(edit.body.code).toBe('copy_lost_use_found');
    expect((await post(ksAdmin, `/api/copies/${s.copyId}/found`, { reason: 'x' })).status).toBe(
      403,
    );
    const res = await post(boss, `/api/copies/${s.copyId}/found`, { reason: 'Handed in' });
    expect(res.body.settlement).toMatchObject({
      status: 'found',
      foundOn: today,
      foundReason: 'Handed in',
    });
    expect(await state(s.copyId)).toBe('on_shelf');
    expect((await post(boss, `/api/copies/${s.copyId}/found`, { reason: 'x' })).body.code).toBe(
      'copy_not_lost',
    );
  });

  it('shows a paid settlement alongside, and its reversal is the refund', async () => {
    await member('Sunil');
    const l = await issue('Sunil', novels[4]!.accessionNo);
    const s = (await post(ksAdmin, `/api/loans/${l.id}/lost`, { kind: 'lost', reason: 'Lost' }))
      .body as Settlement;
    await post(ksAdmin, `/api/settlements/${s.id}/pay`, { amountCents: 150000, receiptNo: 'R-9' });
    const found = await post(boss, `/api/copies/${s.copyId}/found`, { reason: 'In the car' });
    expect(found.body.settlement).toMatchObject({
      status: 'paid',
      foundOn: today,
      paidCents: 150000,
    });
    const paymentId = (found.body.settlement as Settlement).payments[0]!.id;
    const refund = await post(boss, `/api/settlements/${s.id}/payments/${paymentId}/reverse`, {
      reason: 'Refunded at the counter',
    });
    expect(refund.body).toMatchObject({ status: 'found', paidCents: 0 });
  });
});

describe('a member’s own view (FR-LST-03, FR-LST-13)', () => {
  it('lists every settlement they have had, with how long it took', async () => {
    const mine = (await get(people.Kamala!.token, '/api/me/settlements')).body as Settlement[];
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'replaced', daysToSettle: 0 });
    expect((await get(people.Kamala!.token, '/api/settlements')).status).toBe(403);
    expect(novelTitle).toBeGreaterThan(0);
  });
});
