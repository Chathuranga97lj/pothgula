import { addDays, type Loan, todayColombo } from '@pothgula/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { expectPgError } from '../../test/db';
import { activityLog, appUser, borrow } from '../db/schema';

let t: TestApp;
let ks: number;
let gl: number;
let bossId: number;
let boss: string;
let ksAdmin: string;
let glAdmin: string;
let titleId: number;

const today = todayColombo();
const day = (n: number) => addDays(today, n);
const members: Record<string, { id: number; token: string }> = {};

async function member(name: string, branchId = ks) {
  const row = await makeAccount(t, { userType: 'member', branchId });
  await t.db
    .update(appUser)
    .set({ fullName: name, expireAt: day(300) })
    .where(eq(appUser.id, row.id));
  members[name] = { id: row.id, token: await signIn(t, row.whatsappPhone!) };
  return members[name]!;
}

/** A loan made `borrowed` days ago (negative), due 14 days after, with any extension state. */
async function loan(
  who: string,
  borrowed: number,
  over: Partial<typeof borrow.$inferInsert> = {},
): Promise<number> {
  const res = await t
    .http()
    .post(`/api/titles/${titleId}/copies`)
    .set(bearer(boss))
    .send({ branchId: over.branchId ?? ks, count: 1 });
  const copies = res.body.title.copies as { id: number; accessionNo: string }[];
  const added = copies.find((c) => c.accessionNo === res.body.accessionNumbers[0])!;
  const original = day(borrowed + 14);
  const [row] = await t.db
    .insert(borrow)
    .values({
      copyId: added.id,
      userId: members[who]!.id,
      branchId: ks,
      borrowDate: day(borrowed),
      dueDate: original,
      originalDueDate: original,
      issuedBy: bossId,
      ...over,
    })
    .returning();
  return row!.id;
}

const post = (token: string, path: string, body?: object) =>
  t
    .http()
    .post(path)
    .set(bearer(token))
    .send(body ?? {});
const get = (token: string, path: string) => t.http().get(path).set(bearer(token));
const ask = (who: string, id: number) => post(members[who]!.token, `/api/me/loans/${id}/extension`);
const entries = (id: number) =>
  t.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entity, 'borrow'), eq(activityLog.entityId, String(id))));

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
  titleId = (
    await t
      .http()
      .post('/api/titles')
      .set(bearer(boss))
      .send({ title: 'කලියුගය', categoryCode: 'A1' })
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

describe('a member asks (FR-CIR-10)', () => {
  it('asks once from their own loan, logged as theirs, and may withdraw and ask again', async () => {
    const m = await member('Asha');
    const id = await loan('Asha', -3);

    const res = await ask('Asha', id);
    expect(res.status).toBe(200);
    expect(res.body as Loan).toMatchObject({ extensionStatus: 'requested', dueDate: day(11) });
    expect((res.body as Loan).extensionRequestedAt).not.toBeNull();

    const again = await ask('Asha', id);
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('extension_requested');

    expect((await post(m.token, `/api/me/loans/${id}/extension/cancel`)).body.extensionStatus).toBe(
      'none',
    );
    expect((await ask('Asha', id)).status).toBe(200);

    const log = await entries(id);
    expect(log.map((e) => e.action)).toEqual([
      'borrow.extension_request',
      'borrow.extension_cancel',
      'borrow.extension_request',
    ]);
    expect(log[0]).toMatchObject({ actorId: m.id, actorRole: 'member', branchId: ks });
  });

  it("cannot touch another member's loan, and staff cannot ask on a member's behalf here", async () => {
    await member('Bimal');
    const id = await loan('Bimal', -1);
    const res = await ask('Asha', id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('loan_not_found');
    expect((await post(ksAdmin, `/api/me/loans/${id}/extension`)).status).toBe(403);
  });

  it('may ask on the due date, not after; nor while suspended or holding another overdue book', async () => {
    await member('Chamari');
    const dueToday = await loan('Chamari', -14);
    expect((await ask('Chamari', dueToday)).status).toBe(200);

    await member('Dinesh');
    const late = await loan('Dinesh', -16);
    const fresh = await loan('Dinesh', -1);
    const res = await ask('Dinesh', late);
    expect(res.body).toMatchObject({
      code: 'loan_overdue',
      // The other loan is not overdue, so this one's lateness is the only reason.
      details: { refusals: [{ code: 'loan_overdue' }] },
    });
    expect((await ask('Dinesh', fresh)).body.code).toBe('other_book_overdue');

    const e = await member('Eranga');
    const id = await loan('Eranga', -1);
    await t.db.update(appUser).set({ status: 'suspended' }).where(eq(appUser.id, e.id));
    expect((await ask('Eranga', id)).body.code).toBe('member_suspended');
  });

  it('cannot ask on a book that is back', async () => {
    await member('Farah');
    const id = await loan('Farah', -5, { returnedOn: day(-1), receivedBy: bossId });
    expect((await ask('Farah', id)).body.code).toBe('loan_not_open');
  });
});

describe('staff decide (FR-CIR-10, FR-CIR-12)', () => {
  it('lists the requests waiting at their branch, soonest due first', async () => {
    await member('Gayan', gl);
    const glLoan = await loan('Gayan', -2, { branchId: gl });
    await ask('Gayan', glLoan);

    const ksList = (await get(ksAdmin, '/api/extensions')).body as Loan[];
    expect(ksList.length).toBeGreaterThan(0);
    expect(ksList.every((l) => l.branchId === ks && l.extensionStatus === 'requested')).toBe(true);
    expect(ksList.map((l) => l.dueDate)).toEqual(ksList.map((l) => l.dueDate).toSorted());
    expect(ksList.some((l) => l.id === glLoan)).toBe(false);

    const all = (await get(boss, '/api/extensions')).body as Loan[];
    expect(all.some((l) => l.id === glLoan)).toBe(true);
    expect((await get(ksAdmin, `/api/extensions?branchId=${gl}`)).status).toBe(403);
  });

  it('approves: the due date moves one period on from the original, once only', async () => {
    await member('Hiru');
    const id = await loan('Hiru', -5);
    await ask('Hiru', id);
    expect((await post(glAdmin, `/api/loans/${id}/extension/approve`)).body.code).toBe(
      'other_branch',
    );

    const res = await post(ksAdmin, `/api/loans/${id}/extension/approve`);
    expect(res.status).toBe(200);
    expect(res.body as Loan).toMatchObject({
      extensionStatus: 'approved',
      originalDueDate: day(9),
      dueDate: day(23),
    });
    expect((await ask('Hiru', id)).body.code).toBe('extension_used');
    expect((await post(ksAdmin, `/api/loans/${id}/extension`)).body.code).toBe('extension_used');

    const [entry] = (await entries(id)).filter((e) => e.action === 'borrow.extension_approve');
    expect(entry!.afterData).toMatchObject({ dueDate: day(23), source: 'request' });
  });

  it('declines with a reason the member sees; before the due date the date stays', async () => {
    await member('Isuru');
    const id = await loan('Isuru', -5);
    await ask('Isuru', id);
    expect((await post(ksAdmin, `/api/loans/${id}/extension/decline`, {})).status).toBe(400);

    const res = await post(ksAdmin, `/api/loans/${id}/extension/decline`, {
      reason: 'Another member is waiting for it.',
    });
    expect(res.body as Loan).toMatchObject({
      extensionStatus: 'declined',
      extensionReason: 'Another member is waiting for it.',
      dueDate: day(9),
    });
    const panel = await get(members.Isuru!.token, '/api/me/dashboard');
    expect(panel.body.items).toContainEqual(
      expect.objectContaining({
        kind: 'extension_declined',
        loanId: id,
        reason: 'Another member is waiting for it.',
      }),
    );
    // One extension per loan: a member cannot ask again, but staff may still grant it in person.
    expect((await ask('Isuru', id)).body.code).toBe('extension_used');
    const granted = await post(ksAdmin, `/api/loans/${id}/extension`);
    expect(granted.body).toMatchObject({ extensionStatus: 'approved', dueDate: day(23) });
  });

  it('grants directly at the counter, logged as a staff action (FR-CIR-11)', async () => {
    await member('Janaki');
    const id = await loan('Janaki', -2);
    const res = await post(ksAdmin, `/api/loans/${id}/extension`);
    expect(res.body as Loan).toMatchObject({
      extensionStatus: 'approved',
      extensionRequestedAt: null,
      dueDate: day(26),
    });
    const [entry] = (await entries(id)).filter((e) => e.action === 'borrow.extension_grant');
    expect(entry!.afterData).toMatchObject({ source: 'staff' });

    const panel = await get(members.Janaki!.token, '/api/me/dashboard');
    expect(panel.body.items).toContainEqual(
      expect.objectContaining({ kind: 'extension_approved', loanId: id, dueDate: day(26) }),
    );
  });
});

describe('a request made in time protects the member (FR-CIR-13)', () => {
  let waitingId: number;
  let kamal: { id: number; token: string };

  beforeAll(async () => {
    kamal = await member('Kamal');
    // Asked on the due date, two days ago; nobody has decided.
    waitingId = await loan('Kamal', -16, {
      extensionStatus: 'requested',
      extensionRequestedAt: new Date(Date.now() - 2 * 86_400_000),
    });
  });

  it('is not overdue while undecided, and does not block borrowing', async () => {
    const res = await get(ksAdmin, `/api/loans/${waitingId}`);
    expect(res.body as Loan).toMatchObject({ overdue: false, daysLate: 0 });
    const loans = await get(ksAdmin, `/api/members/${kamal.id}/loans`);
    expect(loans.body.standing.overdueLoans).toBe(0);
    const panel = await get(kamal.token, '/api/me/dashboard');
    const kinds = panel.body.items.map((i: { kind: string }) => i.kind);
    expect(kinds).toContain('extension_pending');
    expect(kinds).not.toContain('loan_overdue');
  });

  it('shows staff the requests waiting, and those near or past the due date as urgent', async () => {
    const dash = await get(ksAdmin, '/api/dashboard');
    const counts = dash.body.branches[0].counts;
    expect(counts.extensions_waiting).toBeGreaterThanOrEqual(1);
    expect(counts.extensions_urgent).toBeGreaterThanOrEqual(1);
    expect(dash.body.branches[0].items[2]).toMatchObject({ kind: 'extensions_urgent' });
  });

  it('declined after the due date, gives the grace days from today', async () => {
    const res = await post(ksAdmin, `/api/loans/${waitingId}/extension/decline`, {
      reason: 'Reserved by the school.',
    });
    expect(res.body as Loan).toMatchObject({
      extensionStatus: 'declined',
      dueDate: day(3),
      originalDueDate: day(-2),
      overdue: false,
    });
    const [entry] = (await entries(waitingId)).filter(
      (e) => e.action === 'borrow.extension_decline',
    );
    expect(entry!.afterData).toMatchObject({ dueDate: day(3), graceDays: 3 });
  });

  it('approved after the due date, moves on from the original due date', async () => {
    await member('Lahiru');
    const id = await loan('Lahiru', -15, {
      extensionStatus: 'requested',
      extensionRequestedAt: new Date(Date.now() - 86_400_000),
    });
    const res = await post(ksAdmin, `/api/loans/${id}/extension/approve`);
    expect(res.body as Loan).toMatchObject({ dueDate: day(13), overdue: false });
  });
});

describe('the database keeps an extension consistent', () => {
  it('refuses a request without its time, and a decline without a reason', async () => {
    await member('Mala');
    const id = await loan('Mala', -1);
    const missingTime = await expectPgError(() =>
      t.db.update(borrow).set({ extensionStatus: 'requested' }).where(eq(borrow.id, id)),
    );
    expect(missingTime.constraint).toBe('borrow_extension');
    const noReason = await expectPgError(() =>
      t.db
        .update(borrow)
        .set({
          extensionStatus: 'declined',
          extensionDecidedAt: new Date(),
          extensionDecidedBy: bossId,
        })
        .where(eq(borrow.id, id)),
    );
    expect(noReason.constraint).toBe('borrow_extension');
  });
});
