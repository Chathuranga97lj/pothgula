import { addDays, todayColombo } from '@pothgula/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { activityLog, appUser, borrow, copy } from '../db/schema';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let bossId: number;
let ksLibrarian: string;
let ksAdminId: number;
let glLibrarian: string;

const today = todayColombo();
const daysAgo = (n: number) => addDays(today, -n);

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
  await t.http().post('/api/categories').set(bearer(boss)).send({ code: 'A1', name: 'Novels' });
  const admin = await makeAccount(t, { userType: 'admin', branchId: ks });
  ksAdminId = admin.id;
  ksLibrarian = await signIn(t, admin.whatsappPhone!);
  glLibrarian = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: gl })).whatsappPhone!,
  );
});
afterAll(async () => {
  await t.close();
});

/** A new title with one copy at the branch; returns its accession number and id. */
async function newCopy(branchId = ks) {
  const res = await t
    .http()
    .post('/api/titles')
    .set(bearer(boss))
    .send({
      title: 'කලියුගය',
      writer: 'මාටින් වික්‍රමසිංහ',
      categoryCode: 'A1',
      copies: { branchId, count: 1 },
    });
  return {
    accessionNo: res.body.accessionNumbers[0] as string,
    id: res.body.title.copies[0].id as number,
  };
}

/** An active member whose membership runs well into the future, unless told otherwise. */
async function newMember(
  opts: {
    branchId?: number;
    status?: 'active' | 'pending' | 'suspended';
    expireAt?: string | null;
  } = {},
) {
  const row = await makeAccount(t, {
    userType: 'member',
    branchId: opts.branchId ?? ks,
    status: opts.status ?? 'active',
  });
  const expireAt = opts.expireAt === undefined ? addDays(today, 300) : opts.expireAt;
  await t.db.update(appUser).set({ expireAt }).where(eq(appUser.id, row.id));
  return row;
}

/** A loan written straight into the database, for dates the counter cannot produce. */
async function pastLoan(opts: {
  copyId: number;
  userId: number;
  borrowDate: string;
  dueDate: string;
  returnedOn?: string;
}) {
  const [row] = await t.db
    .insert(borrow)
    .values({
      copyId: opts.copyId,
      userId: opts.userId,
      branchId: ks,
      borrowDate: opts.borrowDate,
      dueDate: opts.dueDate,
      originalDueDate: opts.dueDate,
      issuedBy: ksAdminId,
      returnedOn: opts.returnedOn ?? null,
      receivedBy: opts.returnedOn ? ksAdminId : null,
    })
    .returning();
  return row!;
}

const issue = (token: string, body: object) =>
  t.http().post('/api/loans').set(bearer(token)).send(body);
const check = (token: string, body: object) =>
  t.http().post('/api/loans/check').set(bearer(token)).send(body);
const takeBack = (token: string, id: number, body: object = {}) =>
  t.http().post(`/api/loans/${id}/return`).set(bearer(token)).send(body);
const logFor = (id: number) =>
  t.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entity, 'borrow'), eq(activityLog.entityId, String(id))));

describe('issuing (FR-CIR-01, FR-CIR-07)', () => {
  it('lends a copy from the shelf for the branch loan period, and logs it', async () => {
    const m = await newMember();
    const c = await newCopy();
    const res = await issue(ksLibrarian, {
      memberId: m.id,
      accessionNo: c.accessionNo.toLowerCase(),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      memberId: m.id,
      accessionNo: c.accessionNo,
      borrowDate: today,
      dueDate: addDays(today, 14),
      status: 'open',
      overdue: false,
      daysLate: 0,
      isBackdated: false,
    });
    const [entry] = await logFor(res.body.id);
    expect(entry).toMatchObject({ action: 'borrow.issue', actorId: ksAdminId, branchId: ks });

    const title = await t
      .http()
      .get(`/api/titles/${(await t.db.select().from(copy).where(eq(copy.id, c.id)))[0]!.titleId}`)
      .set(bearer(ksLibrarian));
    expect(title.body.copies[0].state).toBe('on_loan');
  });

  it('uses the branch loan period when it differs from 14 days', async () => {
    await t.http().patch(`/api/branches/${gl}/settings`).set(bearer(boss)).send({ loanDays: 21 });
    const m = await newMember({ branchId: gl });
    const c = await newCopy(gl);
    const res = await issue(glLibrarian, { memberId: m.id, accessionNo: c.accessionNo });
    expect(res.body.dueDate).toBe(addDays(today, 21));
  });

  it('keeps a librarian to members of their own branch', async () => {
    const m = await newMember();
    const c = await newCopy();
    const res = await issue(glLibrarian, { memberId: m.id, accessionNo: c.accessionNo });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('other_branch');
  });

  it('does not lend to staff accounts or unknown copies', async () => {
    const c = await newCopy();
    expect(
      (await issue(ksLibrarian, { memberId: ksAdminId, accessionNo: c.accessionNo })).body.code,
    ).toBe('member_not_found');
    const m = await newMember();
    expect(
      (await issue(ksLibrarian, { memberId: m.id, accessionNo: 'KS-A1-09999' })).body.code,
    ).toBe('copy_not_found');
  });
});

describe('refusing to issue, with the reason (FR-CIR-02)', () => {
  it('shows the refusals before confirming, and writes nothing', async () => {
    const m = await newMember({ expireAt: daysAgo(1) });
    const c = await newCopy(gl);
    const res = await check(boss, { memberId: m.id, accessionNo: c.accessionNo });
    expect(res.status).toBe(200);
    expect(res.body.refusals.map((r: { code: string }) => r.code)).toEqual([
      'copy_other_branch',
      'member_expired',
    ]);
    expect(res.body.copy).toMatchObject({ accessionNo: c.accessionNo, title: 'කලියුගය' });

    const refused = await issue(boss, { memberId: m.id, accessionNo: c.accessionNo });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('copy_other_branch');
    expect(refused.body.details.refusals).toHaveLength(2);
    expect(await t.db.select().from(borrow).where(eq(borrow.userId, m.id))).toHaveLength(0);
  });

  it('refuses applicants and suspended members', async () => {
    const c = await newCopy();
    const applicant = await newMember({ status: 'pending', expireAt: null });
    expect(
      (await issue(ksLibrarian, { memberId: applicant.id, accessionNo: c.accessionNo })).body.code,
    ).toBe('member_pending');
    const suspended = await newMember({ status: 'suspended' });
    expect(
      (await issue(ksLibrarian, { memberId: suspended.id, accessionNo: c.accessionNo })).body.code,
    ).toBe('member_suspended');
  });

  it('refuses a copy already on loan, withdrawn, or not useable', async () => {
    const [a, b] = [await newMember(), await newMember()];
    const c = await newCopy();
    await issue(ksLibrarian, { memberId: a.id, accessionNo: c.accessionNo });
    expect(
      (await issue(ksLibrarian, { memberId: b.id, accessionNo: c.accessionNo })).body.code,
    ).toBe('copy_on_loan');
    const w = await newCopy();
    await t
      .http()
      .post(`/api/copies/${w.id}/withdraw`)
      .set(bearer(ksLibrarian))
      .send({ reason: 'Torn' });
    expect(
      (await issue(ksLibrarian, { memberId: b.id, accessionNo: w.accessionNo })).body.code,
    ).toBe('copy_withdrawn');
    const d = await newCopy();
    await t
      .http()
      .patch(`/api/copies/${d.id}`)
      .set(bearer(ksLibrarian))
      .send({ condition: 'not_useable' });
    expect(
      (await issue(ksLibrarian, { memberId: b.id, accessionNo: d.accessionNo })).body.code,
    ).toBe('copy_not_useable');
  });

  it('stops a member at two books (FR-CIR-06)', async () => {
    const m = await newMember();
    for (let i = 0; i < 2; i++) {
      expect(
        (await issue(ksLibrarian, { memberId: m.id, accessionNo: (await newCopy()).accessionNo }))
          .status,
      ).toBe(201);
    }
    const third = await issue(ksLibrarian, {
      memberId: m.id,
      accessionNo: (await newCopy()).accessionNo,
    });
    expect(third.body).toMatchObject({ code: 'member_at_limit' });
    expect(third.body.details.refusals[0]).toEqual({ code: 'member_at_limit', params: { max: 2 } });
  });

  it('blocks a member holding an overdue book until it is back (R21)', async () => {
    const m = await newMember();
    const old = await newCopy();
    const loan = await pastLoan({
      copyId: old.id,
      userId: m.id,
      borrowDate: daysAgo(20),
      dueDate: daysAgo(6),
    });
    const c = await newCopy();
    expect(
      (await issue(ksLibrarian, { memberId: m.id, accessionNo: c.accessionNo })).body.code,
    ).toBe('member_overdue');
    await takeBack(ksLibrarian, loan.id);
    expect((await issue(ksLibrarian, { memberId: m.id, accessionNo: c.accessionNo })).status).toBe(
      201,
    );
  });

  it('lets only one of two counters lend the same copy at the same moment', async () => {
    const [a, b] = [await newMember(), await newMember()];
    const c = await newCopy();
    const results = await Promise.all([
      issue(ksLibrarian, { memberId: a.id, accessionNo: c.accessionNo }),
      issue(boss, { memberId: b.id, accessionNo: c.accessionNo }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(results.find((r) => r.status === 422)!.body.code).toBe('copy_on_loan');
  });
});

describe('taking back (FR-CIR-03, FR-CIR-04, FR-CIR-08)', () => {
  it('finds the open loan by accession number and shows how late it is', async () => {
    const m = await newMember();
    const c = await newCopy();
    await pastLoan({ copyId: c.id, userId: m.id, borrowDate: daysAgo(18), dueDate: daysAgo(4) });
    const res = await t
      .http()
      .get(`/api/loans/open?accession=${c.accessionNo.replace(/-/g, '')}`)
      .set(bearer(ksLibrarian));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ memberId: m.id, overdue: true, daysLate: 4 });

    const back = await takeBack(ksLibrarian, res.body.id);
    expect(back.body).toMatchObject({
      status: 'returned',
      returnedOn: today,
      daysLate: 4,
      overdue: false,
    });
    const [entry] = await logFor(res.body.id);
    expect(entry).toMatchObject({ action: 'borrow.return' });
    expect(entry!.afterData).toMatchObject({ returnedOn: today, daysLate: 4 });

    const again = await t
      .http()
      .get(`/api/loans/open?accession=${c.accessionNo}`)
      .set(bearer(ksLibrarian));
    expect(again.body.code).toBe('no_open_loan');
    expect((await takeBack(ksLibrarian, res.body.id)).body.code).toBe('already_returned');
  });

  it('sets a damaged book aside as not useable instead of shelving it', async () => {
    const m = await newMember();
    const c = await newCopy();
    const loan = await issue(ksLibrarian, { memberId: m.id, accessionNo: c.accessionNo });
    await takeBack(ksLibrarian, loan.body.id, { notUseable: true });
    const [row] = await t.db.select().from(copy).where(eq(copy.id, c.id));
    expect(row!.condition).toBe('not_useable');
    const entries = await t.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entity, 'copy'), eq(activityLog.entityId, String(c.id))));
    expect(entries.at(-1)!.afterData).toMatchObject({ condition: 'not_useable' });
  });

  it('keeps another branch out of the take-back', async () => {
    const m = await newMember();
    const c = await newCopy();
    const loan = await issue(ksLibrarian, { memberId: m.id, accessionNo: c.accessionNo });
    expect((await takeBack(glLibrarian, loan.body.id)).body.code).toBe('other_branch');
  });
});

describe('paper transactions after an outage (FR-CIR-14)', () => {
  it('enters an issue with its real date, up to seven days back, marked back-dated', async () => {
    const m = await newMember();
    const c = await newCopy();
    const res = await issue(ksLibrarian, {
      memberId: m.id,
      accessionNo: c.accessionNo,
      borrowDate: daysAgo(3),
    });
    expect(res.body).toMatchObject({
      borrowDate: daysAgo(3),
      dueDate: addDays(daysAgo(3), 14),
      isBackdated: true,
    });
    const [entry] = await logFor(res.body.id);
    expect(entry!.action).toBe('borrow.issue_backdated');
    expect(entry!.afterData).toMatchObject({ borrowDate: daysAgo(3), backdated: true });
    // The log entry's own time is when it was keyed in: today.
    expect(todayColombo(entry!.at)).toBe(today);

    const tooOld = await issue(ksLibrarian, {
      memberId: m.id,
      accessionNo: (await newCopy()).accessionNo,
      borrowDate: daysAgo(8),
    });
    expect(tooOld.body.code).toBe('backdate_too_old');
    const future = await issue(ksLibrarian, {
      memberId: m.id,
      accessionNo: (await newCopy()).accessionNo,
      borrowDate: addDays(today, 1),
    });
    expect(future.body.code).toBe('date_in_future');
  });

  it('enters a take-back with its real date, never before the issue', async () => {
    const m = await newMember();
    const c = await newCopy();
    const loan = await pastLoan({
      copyId: c.id,
      userId: m.id,
      borrowDate: daysAgo(5),
      dueDate: addDays(today, 9),
    });
    expect((await takeBack(ksLibrarian, loan.id, { returnedOn: daysAgo(6) })).body.code).toBe(
      'return_before_issue',
    );
    const back = await takeBack(ksLibrarian, loan.id, { returnedOn: daysAgo(2) });
    expect(back.body).toMatchObject({
      returnedOn: daysAgo(2),
      returnBackdated: true,
      isBackdated: false,
    });
    const entries = await logFor(loan.id);
    expect(entries.at(-1)!.action).toBe('borrow.return_backdated');
  });
});

describe('corrections and voids (FR-CIR-05)', () => {
  it('corrects the date, the copy and the member, keeping the old values in the log', async () => {
    const [m, other] = [await newMember(), await newMember()];
    const [c, right] = [await newCopy(), await newCopy()];
    const loan = (await issue(ksLibrarian, { memberId: m.id, accessionNo: c.accessionNo })).body;

    const res = await t
      .http()
      .patch(`/api/loans/${loan.id}`)
      .set(bearer(ksLibrarian))
      .send({
        borrowDate: daysAgo(2),
        accessionNo: right.accessionNo,
        memberId: other.id,
        reason: 'Wrong slip',
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      borrowDate: daysAgo(2),
      dueDate: addDays(daysAgo(2), 14),
      originalDueDate: addDays(daysAgo(2), 14),
      copyId: right.id,
      memberId: other.id,
    });
    const entry = (await logFor(loan.id)).find((e) => e.action === 'borrow.correct')!;
    expect(entry.beforeData).toMatchObject({ borrowDate: today, copyId: c.id, userId: m.id });
    expect(entry.afterData).toMatchObject({
      borrowDate: daysAgo(2),
      copyId: right.id,
      userId: other.id,
      reason: 'Wrong slip',
    });

    // The first copy is back on the shelf; the corrected one is out.
    expect(
      (await check(ksLibrarian, { memberId: m.id, accessionNo: c.accessionNo })).body.refusals,
    ).toEqual([]);
    expect(
      (
        await t
          .http()
          .patch(`/api/loans/${loan.id}`)
          .set(bearer(ksLibrarian))
          .send({ memberId: other.id, reason: 'x' })
      ).body.code,
    ).toBe('nothing_to_change');
  });

  it('will not move an open loan onto a copy that is out, or to another branch', async () => {
    const m = await newMember();
    const [c, busy] = [await newCopy(), await newCopy()];
    const loan = (await issue(ksLibrarian, { memberId: m.id, accessionNo: c.accessionNo })).body;
    await issue(ksLibrarian, { memberId: (await newMember()).id, accessionNo: busy.accessionNo });
    const patch = (body: object) =>
      t
        .http()
        .patch(`/api/loans/${loan.id}`)
        .set(bearer(boss))
        .send({ reason: 'x', ...body });
    expect((await patch({ accessionNo: busy.accessionNo })).body.code).toBe('copy_on_loan');
    expect((await patch({ accessionNo: (await newCopy(gl)).accessionNo })).body.code).toBe(
      'copy_other_branch',
    );
    expect((await patch({ memberId: (await newMember({ branchId: gl })).id })).body.code).toBe(
      'member_other_branch',
    );
  });

  it('undoes a take-back recorded by mistake', async () => {
    const m = await newMember();
    const c = await newCopy();
    const loan = (await issue(ksLibrarian, { memberId: m.id, accessionNo: c.accessionNo })).body;
    await takeBack(ksLibrarian, loan.id);
    const res = await t
      .http()
      .patch(`/api/loans/${loan.id}`)
      .set(bearer(ksLibrarian))
      .send({ returnedOn: null, reason: 'Scanned the wrong book' });
    expect(res.body).toMatchObject({ status: 'open', returnedOn: null });
  });

  it('lets only a super admin void a loan; it stays on the record and counts nowhere', async () => {
    const m = await newMember();
    const c = await newCopy();
    const loan = await pastLoan({
      copyId: c.id,
      userId: m.id,
      borrowDate: daysAgo(30),
      dueDate: daysAgo(16),
    });
    const voidIt = (token: string) =>
      t
        .http()
        .post(`/api/loans/${loan.id}/void`)
        .set(bearer(token))
        .send({ reason: 'Entered for the wrong person' });

    expect((await voidIt(ksLibrarian)).status).toBe(403);
    const res = await voidIt(boss);
    expect(res.body).toMatchObject({
      status: 'void',
      overdue: false,
      daysLate: 0,
      voidReason: 'Entered for the wrong person',
    });
    expect((await voidIt(boss)).body.code).toBe('loan_void');
    const [entry] = (await logFor(loan.id)).filter((e) => e.action === 'borrow.void');
    expect(entry).toMatchObject({ actorId: bossId });

    // No longer blocks the member, and the copy is back on the shelf.
    expect((await issue(ksLibrarian, { memberId: m.id, accessionNo: c.accessionNo })).status).toBe(
      201,
    );
    const history = await t.http().get(`/api/members/${m.id}/loans`).set(bearer(ksLibrarian));
    expect(history.body.loans.map((l: { status: string }) => l.status)).toEqual(['open', 'void']);
    expect(await t.db.select().from(borrow).where(eq(borrow.id, loan.id))).toHaveLength(1);
  });
});

describe("a member's history and standing (FR-CIR-04, FR-CIR-09, FR-CIR-15)", () => {
  it('lists every loan, newest first, and marks three late returns in a year', async () => {
    const m = await newMember();
    for (const back of [200, 100, 10]) {
      const c = await newCopy();
      await pastLoan({
        copyId: c.id,
        userId: m.id,
        borrowDate: daysAgo(back + 20),
        dueDate: daysAgo(back + 6),
        returnedOn: daysAgo(back),
      });
    }
    const onTime = await newCopy();
    await pastLoan({
      copyId: onTime.id,
      userId: m.id,
      borrowDate: daysAgo(5),
      dueDate: addDays(today, 9),
    });

    const res = await t.http().get(`/api/members/${m.id}/loans`).set(bearer(ksLibrarian));
    expect(res.body.standing).toEqual({
      openLoans: 1,
      maxBooks: 2,
      overdueLoans: 0,
      lateReturns: 3,
      lateReturnMonths: 12,
      frequentlyLate: true,
    });
    expect(res.body.loans.map((l: { daysLate: number }) => l.daysLate)).toEqual([0, 6, 6, 6]);
    expect((await t.http().get(`/api/members/${m.id}/loans`).set(bearer(glLibrarian))).status).toBe(
      403,
    );
  });

  it('shows a member their own loans and late returns, without voided mistakes', async () => {
    const m = await newMember();
    const token = await signIn(t, m.whatsappPhone!);
    const c = await newCopy();
    const late = await pastLoan({
      copyId: c.id,
      userId: m.id,
      borrowDate: daysAgo(30),
      dueDate: daysAgo(16),
      returnedOn: daysAgo(14),
    });
    const mistake = await pastLoan({
      copyId: (await newCopy()).id,
      userId: m.id,
      borrowDate: daysAgo(3),
      dueDate: addDays(today, 11),
    });
    await t
      .http()
      .post(`/api/loans/${mistake.id}/void`)
      .set(bearer(boss))
      .send({ reason: 'Mistake' });

    const res = await t.http().get('/api/me/loans').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.loans).toHaveLength(1);
    expect(res.body.loans[0]).toMatchObject({ id: late.id, daysLate: 2, status: 'returned' });
    expect((await t.http().get(`/api/members/${m.id}/loans`).set(bearer(token))).status).toBe(403);
    expect((await t.http().get('/api/loans/check').set(bearer(token))).status).toBe(403);
  });
});
