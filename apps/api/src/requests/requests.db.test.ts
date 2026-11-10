import {
  addDays,
  type BookRequest,
  type BookRequestDetail,
  type RequestBoard,
  todayColombo,
} from '@pothgula/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { activityLog, appUser, bookRequest, borrow } from '../db/schema';
import { lapseExpiredHolds } from './lapse';

let t: TestApp;
let ks: number;
let gl: number;
let mt: number;
let boss: string;
let ksAdmin: string;
let glAdmin: string;
let mtAdmin: string;
let titleId: number;
let otherTitleId: number;
const glCopies: { id: number; accessionNo: string }[] = [];

const today = todayColombo();
const day = (n: number) => addDays(today, n);
const people: Record<string, { id: number; token: string }> = {};

async function member(name: string, branchId: number, status: 'active' | 'pending' = 'active') {
  const row = await makeAccount(t, { userType: 'member', branchId, status });
  await t.db
    .update(appUser)
    .set({
      fullName: name,
      expireAt: status === 'active' ? day(300) : null,
      address: '1 Lake Road',
    })
    .where(eq(appUser.id, row.id));
  people[name] = { id: row.id, token: await signIn(t, row.whatsappPhone!) };
}

const post = (token: string, path: string, body?: object) =>
  t
    .http()
    .post(path)
    .set(bearer(token))
    .send(body ?? {});
const get = (token: string, path: string) => t.http().get(path).set(bearer(token));
const ask = (who: string, fromBranchId = gl, title = titleId) =>
  post(people[who]!.token, '/api/me/requests', { titleId: title, fromBranchId });
const state = async (copyId: number) =>
  (
    await t.db.execute<{ state: string }>(
      sql`SELECT state FROM copy_availability WHERE copy_id = ${copyId}`,
    )
  ).rows[0]!.state;
const board = async (token: string, branchId: number) =>
  ((await get(token, `/api/requests?branchId=${branchId}`)).body as RequestBoard).branches[0]!;
const steps = async (id: number) =>
  (
    await t.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entity, 'book_request'), eq(activityLog.entityId, String(id))))
      .orderBy(activityLog.id)
  ).map((e) => `${e.action}@${e.branchId === ks ? 'KS' : e.branchId === gl ? 'GL' : e.branchId}`);

/** Accepted, sent and arrived: held at KS for the member. */
async function heldFor(who: string, copy: { id: number }): Promise<number> {
  const id = (await ask(who)).body.id as number;
  await post(glAdmin, `/api/requests/${id}/accept`, { copyId: copy.id });
  await post(glAdmin, '/api/requests/dispatch', { requestIds: [id] });
  await post(ksAdmin, `/api/requests/${id}/arrive`);
  return id;
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
  mt = await mk('Matara', 'MT');
  await post(boss, '/api/categories', { code: 'A1', name: 'Novels' });
  const res = await post(boss, '/api/titles', {
    title: 'කලියුගය',
    categoryCode: 'A1',
    copies: { branchId: gl, count: 4 },
  });
  titleId = res.body.title.id;
  glCopies.push(...(res.body.title.copies as { id: number; accessionNo: string }[]));
  otherTitleId = (
    await post(boss, '/api/titles', {
      title: 'Gamperaliya',
      categoryCode: 'A1',
      copies: { branchId: ks, count: 1 },
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
  mtAdmin = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: mt })).whatsappPhone!,
  );
});

afterAll(async () => {
  await t.close();
});

describe('a member asks (FR-REQ-01, FR-REQ-02)', () => {
  it('asks once for a book on another branch’s shelf, and that branch is asked', async () => {
    await member('Asha', ks);
    const res = await ask('Asha');
    expect(res.status).toBe(201);
    expect(res.body as BookRequest).toMatchObject({
      status: 'requested',
      from: { code: 'GL' },
      to: { code: 'KS' },
      copyId: null,
    });
    const again = await ask('Asha');
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('request_open');
    expect(await steps(res.body.id)).toEqual(['request.create@GL']);
    // The member may withdraw it before it is accepted.
    const cancelled = await post(people.Asha!.token, `/api/me/requests/${res.body.id}/cancel`);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('refuses their own branch, an empty shelf, an applicant, and a member at the limit', async () => {
    const own = await ask('Asha', ks, otherTitleId);
    expect(own.body.details.refusals.map((r: { code: string }) => r.code)).toContain('own_branch');
    expect((await ask('Asha', gl, otherTitleId)).body.code).toBe('none_on_shelf');

    await member('Chamari', ks, 'pending');
    expect((await ask('Chamari')).body.code).toBe('member_pending');

    await member('Bimal', ks);
    for (const n of [1, 2]) {
      const c = (
        await post(boss, `/api/titles/${otherTitleId}/copies`, { branchId: ks, count: 1 })
      ).body.title.copies.at(-1);
      expect(
        (
          await post(ksAdmin, '/api/loans', {
            memberId: people.Bimal!.id,
            accessionNo: c.accessionNo,
          })
        ).status,
      ).toBe(201);
      void n;
    }
    expect((await ask('Bimal')).body.code).toBe('member_at_limit');
  });
});

describe('the journey of a copy (FR-REQ-03 to FR-REQ-08, FR-REQ-10, FR-REQ-13)', () => {
  let id: number;
  const copy = () => glCopies[0]!;

  it('shows the holding branch and the home branch the request, with the member in full', async () => {
    id = (await ask('Asha')).body.id;
    expect((await board(glAdmin, gl)).toDecide.map((r) => r.id)).toEqual([id]);
    expect((await board(ksAdmin, ks)).ourMembers.map((r) => r.id)).toEqual([id]);

    const detail = (await get(glAdmin, `/api/requests/${id}`)).body as BookRequestDetail;
    expect(detail.member).toMatchObject({ fullName: 'Asha', address: '1 Lake Road' });
    expect(detail.memberLoans).toEqual([]);
    expect((await get(mtAdmin, `/api/requests/${id}`)).status).toBe(403);
  });

  it('is accepted by the holding branch choosing the copy, which leaves the shelf at once', async () => {
    expect(
      (await post(ksAdmin, `/api/requests/${id}/accept`, { copyId: copy().id })).body.code,
    ).toBe('other_branch');
    const res = await post(glAdmin, `/api/requests/${id}/accept`, { copyId: copy().id });
    expect(res.body).toMatchObject({ status: 'accepted', accessionNo: copy().accessionNo });
    expect(await state(copy().id)).toBe('in_transit');

    await member('Gayan', gl);
    const check = await post(glAdmin, '/api/loans/check', {
      memberId: people.Gayan!.id,
      accessionNo: copy().accessionNo,
    });
    expect(check.body.refusals).toEqual([{ code: 'copy_in_transit' }]);
    expect((await board(glAdmin, gl)).toSend.map((r) => r.id)).toEqual([id]);
  });

  it('is sent with a transit slip, and recorded on arrival at the member’s branch', async () => {
    expect((await post(ksAdmin, '/api/requests/dispatch', { requestIds: [id] })).body.code).toBe(
      'other_branch',
    );
    const sent = await post(glAdmin, '/api/requests/dispatch', { requestIds: [id] });
    expect(sent.body[0]).toMatchObject({
      status: 'in_transit',
      daysInTransit: 0,
      transitOverdue: false,
    });

    const slip = await get(glAdmin, `/api/requests/slip?ids=${id}`).buffer(true);
    expect(slip.headers['content-type']).toBe('application/pdf');
    expect((slip.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    expect((await board(ksAdmin, ks)).arriving.map((r) => r.id)).toEqual([id]);
    const arrived = await post(ksAdmin, `/api/requests/${id}/arrive`);
    expect(arrived.body).toMatchObject({ status: 'held', holdUntil: day(7) });
    expect(await state(copy().id)).toBe('held');

    const panel = await get(people.Asha!.token, '/api/me/dashboard');
    expect(panel.body.items).toContainEqual(
      expect.objectContaining({ kind: 'request_ready', requestId: id, holdUntil: day(7) }),
    );
  });

  it('is held for its member only, and issued to them at their counter as an ordinary loan', async () => {
    await member('Dilan', ks);
    const other = await post(ksAdmin, '/api/loans/check', {
      memberId: people.Dilan!.id,
      accessionNo: copy().accessionNo,
    });
    expect(other.body.refusals.map((r: { code: string }) => r.code)).toEqual([
      'copy_held',
      'copy_other_branch',
    ]);

    const loan = await post(ksAdmin, '/api/loans', {
      memberId: people.Asha!.id,
      accessionNo: copy().accessionNo,
    });
    expect(loan.status).toBe(201);
    expect(loan.body).toMatchObject({ branchId: ks, dueDate: day(14) });
    const [r] = await t.db.select().from(bookRequest).where(eq(bookRequest.id, id));
    expect(r).toMatchObject({ status: 'issued', borrowId: loan.body.id });
    expect(await state(copy().id)).toBe('on_loan');
    expect((await board(glAdmin, gl)).outElsewhere.map((l) => l.id)).toEqual([loan.body.id]);
  });

  it('travels home when taken back, and is on its own shelf again on arrival', async () => {
    const [r] = await t.db.select().from(bookRequest).where(eq(bookRequest.id, id));
    await post(ksAdmin, `/api/loans/${r!.borrowId}/return`, {});
    expect(await state(copy().id)).toBe('in_transit');
    expect((await board(ksAdmin, ks)).toSend.map((x) => x.id)).toEqual([id]);

    // Nothing arrives that was never sent.
    expect((await post(glAdmin, `/api/requests/${id}/arrive`)).body.code).toBe('wrong_step');
    await post(ksAdmin, '/api/requests/dispatch', { requestIds: [id] });
    const home = await post(glAdmin, `/api/requests/${id}/arrive`);
    expect(home.body.status).toBe('completed');
    expect(await state(copy().id)).toBe('on_shelf');

    expect(await steps(id)).toEqual([
      'request.create@GL',
      'request.accept@GL',
      'request.dispatch@GL',
      'request.arrive@KS',
      'request.issue@KS',
      'request.returned@KS',
      'request.return_dispatch@KS',
      'request.return_arrive@GL',
    ]);
  });
});

describe('when it does not go to plan', () => {
  it('lapses a hold not collected in time, and the copy goes home (FR-REQ-06)', async () => {
    await member('Eshan', ks);
    const id = await heldFor('Eshan', glCopies[1]!);
    // Not yet over: it cannot be sent back early.
    expect((await post(ksAdmin, '/api/requests/dispatch', { requestIds: [id] })).body.code).toBe(
      'hold_not_over',
    );
    await t.db
      .update(bookRequest)
      .set({ holdUntil: day(-1) })
      .where(eq(bookRequest.id, id));
    expect(await lapseExpiredHolds(t.db, t.uow)).toEqual([id]);
    expect(await lapseExpiredHolds(t.db, t.uow)).toEqual([]);
    expect(await state(glCopies[1]!.id)).toBe('in_transit');
    expect((await board(ksAdmin, ks)).toSend.map((x) => x.id)).toEqual([id]);

    await post(ksAdmin, '/api/requests/dispatch', { requestIds: [id] });
    expect((await post(glAdmin, `/api/requests/${id}/arrive`)).body.status).toBe('completed');
    expect(await steps(id)).toContain('request.lapse@KS');
  });

  it('declines with a reason the member sees for a week (FR-REQ-04)', async () => {
    await member('Farah', ks);
    const id = (await ask('Farah')).body.id;
    expect((await post(glAdmin, `/api/requests/${id}/decline`, {})).status).toBe(400);
    const res = await post(glAdmin, `/api/requests/${id}/decline`, {
      reason: 'Kept for the exam.',
    });
    expect(res.body).toMatchObject({ status: 'declined', declineReason: 'Kept for the exam.' });
    const panel = await get(people.Farah!.token, '/api/me/dashboard');
    expect(panel.body.items).toContainEqual(
      expect.objectContaining({ kind: 'request_declined', reason: 'Kept for the exam.' }),
    );
    // Declined, it no longer counts: the member may ask again.
    expect((await ask('Farah')).status).toBe(201);
  });

  it('cannot be withdrawn by the member once accepted (FR-REQ-11)', async () => {
    const [mine] = (await get(people.Farah!.token, '/api/me/requests')).body as BookRequest[];
    await post(glAdmin, `/api/requests/${mine!.id}/accept`, { copyId: glCopies[2]!.id });
    expect((await post(people.Farah!.token, `/api/me/requests/${mine!.id}/cancel`)).body.code).toBe(
      'wrong_step',
    );
  });

  it('flags a copy on the road too long to both branches (FR-REQ-12)', async () => {
    const [mine] = (await get(people.Farah!.token, '/api/me/requests')).body as BookRequest[];
    await post(glAdmin, '/api/requests/dispatch', { requestIds: [mine!.id] });
    await t.db
      .update(bookRequest)
      .set({ dispatchedAt: new Date(Date.now() - 10 * 86_400_000) })
      .where(eq(bookRequest.id, mine!.id));
    expect((await board(ksAdmin, ks)).transitOverdue.map((r) => r.id)).toEqual([mine!.id]);
    expect((await board(glAdmin, gl)).transitOverdue.map((r) => r.id)).toEqual([mine!.id]);
    const dash = await get(glAdmin, '/api/dashboard');
    expect(dash.body.branches[0].counts.transit_overdue).toBe(1);
    expect(dash.body.branches[0].items[0]).toMatchObject({ kind: 'transit_overdue' });
  });

  it('writes off a copy that never arrived, at the library’s cost (FR-REQ-14)', async () => {
    const [mine] = (await get(people.Farah!.token, '/api/me/requests')).body as BookRequest[];
    expect((await post(glAdmin, `/api/requests/${mine!.id}/lost`, { reason: 'Bus' })).status).toBe(
      403,
    );
    const res = await post(boss, `/api/requests/${mine!.id}/lost`, {
      reason: 'Not on the bus; carrier searched twice.',
    });
    expect(res.body.status).toBe('lost_in_transit');
    expect(await state(glCopies[2]!.id)).toBe('missing');
    // The member owes nothing and may ask again.
    expect((await ask('Farah')).status).toBe(201);
  });
});

describe('a request counts towards the limit, and undoing its loan puts it back (FR-CIR-06)', () => {
  it('stops a member with one book and one request taking a second book', async () => {
    await member('Hiru', ks);
    const c = (
      await post(boss, `/api/titles/${otherTitleId}/copies`, { branchId: ks, count: 2 })
    ).body.title.copies.slice(-2);
    await post(ksAdmin, '/api/loans', { memberId: people.Hiru!.id, accessionNo: c[0].accessionNo });
    // Copy 4 at GL is still on the shelf.
    const id = (await ask('Hiru')).body.id;
    expect(id).toBeGreaterThan(0);
    const check = await post(ksAdmin, '/api/loans/check', {
      memberId: people.Hiru!.id,
      accessionNo: c[1].accessionNo,
    });
    expect(check.body.refusals).toEqual([{ code: 'member_at_limit', params: { max: 2 } }]);
  });

  it('sends a held copy back to held when its loan is voided', async () => {
    await member('Ishara', ks);
    const req = await t.db
      .select()
      .from(bookRequest)
      .where(eq(bookRequest.userId, people.Hiru!.id));
    await post(glAdmin, `/api/requests/${req[0]!.id}/accept`, { copyId: glCopies[3]!.id });
    await post(glAdmin, '/api/requests/dispatch', { requestIds: [req[0]!.id] });
    await post(ksAdmin, `/api/requests/${req[0]!.id}/arrive`);
    // Hiru takes their first book back, then collects the held one.
    const [first] = await t.db.select().from(borrow).where(eq(borrow.userId, people.Hiru!.id));
    await post(ksAdmin, `/api/loans/${first!.id}/return`, {});
    const loan = await post(ksAdmin, '/api/loans', {
      memberId: people.Hiru!.id,
      accessionNo: glCopies[3]!.accessionNo,
    });
    expect(loan.status).toBe(201);
    expect(
      (
        await t.http().patch(`/api/loans/${loan.body.id}`).set(bearer(ksAdmin)).send({
          memberId: people.Ishara!.id,
          reason: 'wrong card',
        })
      ).body.code,
    ).toBe('loan_from_request');

    const voided = await post(boss, `/api/loans/${loan.body.id}/void`, { reason: 'keyed twice' });
    expect(voided.status).toBe(200);
    const [r] = await t.db.select().from(bookRequest).where(eq(bookRequest.id, req[0]!.id));
    expect(r).toMatchObject({ status: 'held', borrowId: null });
    expect(await state(glCopies[3]!.id)).toBe('held');
  });
});

describe('the requests report (FR-RPT-14)', () => {
  it('counts requests between each pair of branches, with outcomes and decline reasons', async () => {
    const r = (await get(boss, '/api/reports/requests')).body;
    const glToKs = r.rows.find(
      (x: { cells: unknown[] }) => x.cells[0] === 'GL' && x.cells[1] === 'KS',
    );
    const col = (key: string) => r.columns.findIndex((c: { key: string }) => c.key === key);
    expect(glToKs.cells[col('declined')]).toBe(1);
    expect(glToKs.cells[col('collected')]).toBeGreaterThanOrEqual(1);
    expect(glToKs.cells[col('lapsed')]).toBe(1);
    expect(glToKs.cells[col('lostInTransit')]).toBe(1);
    expect(r.about).toContain('  Kept for the exam. (1)');
  });
});
