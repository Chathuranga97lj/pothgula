import {
  addDays,
  type BranchHours,
  type MemberDashboard,
  type Notice,
  type NoticeBoard,
  todayColombo,
  weekdayOf,
} from '@pothgula/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { activityLog, appUser, bookRequest } from '../db/schema';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let ksAdmin: string;
let glAdmin: string;
let member: string;
let applicant: string;

const today = todayColombo();
const day = (n: number) => addDays(today, n);
const post = (token: string, path: string, body?: object) =>
  t
    .http()
    .post(path)
    .set(bearer(token))
    .send(body ?? {});
const patch = (token: string, path: string, body: object) =>
  t.http().patch(path).set(bearer(token)).send(body);
const get = (token: string, path: string) => t.http().get(path).set(bearer(token));
const week = (open: string | null, close: string | null, closedOn: number[] = []) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    closedOn.includes(weekday) ? { weekday, open: null, close: null } : { weekday, open, close },
  );
const notice = (over: Record<string, unknown> = {}) => ({
  kind: 'notice',
  branchId: ks,
  title: 'Book fair',
  body: 'Bring a friend. Details at https://example.org/fair',
  isImportant: false,
  ...over,
});

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
  ksAdmin = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: ks })).whatsappPhone!,
  );
  glAdmin = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: gl })).whatsappPhone!,
  );
  const m = await makeAccount(t, { userType: 'member', branchId: ks, status: 'active' });
  await t.db
    .update(appUser)
    .set({ expireAt: day(300) })
    .where(eq(appUser.id, m.id));
  member = await signIn(t, m.whatsappPhone!);
  applicant = await signIn(
    t,
    (await makeAccount(t, { userType: 'member', branchId: ks, status: 'pending' })).whatsappPhone!,
  );
});

afterAll(async () => {
  await t.close();
});

describe('opening hours (FR-SCH-01 to FR-SCH-05)', () => {
  it('says nothing until a pattern is set, then states today plainly', async () => {
    const before = (await get(member, `/api/branches/${ks}/hours`)).body as BranchHours;
    expect(before).toMatchObject({ configured: false, status: { kind: 'unknown' } });
    const saved = await patch(ksAdmin, `/api/branches/${ks}/hours`, {
      week: week('00:00', '23:59'),
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      configured: true,
      status: { kind: 'open', until: '23:59' },
    });
    const [entry] = await t.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, 'hours.update'));
    expect(entry!.afterData).toMatchObject({ week: expect.arrayContaining(['Mon 00:00–23:59']) });
  });

  it('is changed by the branch’s own staff only; anyone signed in may look', async () => {
    expect(
      (await patch(glAdmin, `/api/branches/${ks}/hours`, { week: week(null, null) })).status,
    ).toBe(403);
    expect((await get(applicant, `/api/branches/${gl}/hours`)).status).toBe(200);
    const bad = await patch(ksAdmin, `/api/branches/${ks}/hours`, { week: week('17:00', '09:00') });
    expect(bad.status).toBe(400);
  });

  it('closes a run of dates in one go, with the reason, and today’s status says so', async () => {
    const res = await post(ksAdmin, `/api/branches/${ks}/closures`, {
      from: today,
      to: day(2),
      reason: 'Stock-taking',
    });
    expect(res.status).toBe(201);
    const hours = res.body as BranchHours;
    expect(hours.closures.map((c) => c.date)).toEqual([today, day(1), day(2)]);
    expect(hours.status).toMatchObject({
      kind: 'closed',
      reason: 'Stock-taking',
      next: { date: day(3) },
    });
    const again = await post(ksAdmin, `/api/branches/${ks}/closures`, {
      from: today,
      reason: 'x',
    });
    expect(again.body.code).toBe('already_closed');
    expect(
      (await post(ksAdmin, `/api/branches/${ks}/closures`, { from: day(-1), reason: 'x' })).body
        .code,
    ).toBe('date_in_past');
  });

  it('shows the member the closures in the coming week, and a mistake can be withdrawn', async () => {
    const panel = (await get(member, '/api/me/dashboard')).body as MemberDashboard;
    expect(panel.items.filter((i) => i.kind === 'closure')).toEqual([
      expect.objectContaining({ date: today, tone: 'warning', reason: 'Stock-taking' }),
      expect.objectContaining({ date: day(1), tone: 'warning' }),
      expect.objectContaining({ date: day(2), tone: 'info' }),
    ]);
    const hours = (await get(ksAdmin, `/api/branches/${ks}/hours`)).body as BranchHours;
    const last = hours.closures.at(-1)!;
    const res = await post(ksAdmin, `/api/closures/${last.id}/withdraw`);
    expect((res.body as BranchHours).closures).toHaveLength(2);
    expect((await post(ksAdmin, `/api/closures/${last.id}/withdraw`)).status).toBe(404);
  });

  it('never lets a hold end on a closed day (FR-REQ-05)', async () => {
    // GL is closed on the weekday the hold would end; the hold runs on a day.
    const last = day(7);
    await patch(glAdmin, `/api/branches/${gl}/hours`, {
      week: week('09:00', '17:00', [weekdayOf(last)]),
    });
    const titleId = (
      await post(boss, '/api/categories', { code: 'A1', name: 'Novels' }).then(() =>
        post(boss, '/api/titles', {
          title: 'Madol Doova',
          categoryCode: 'A1',
          copies: { branchId: ks, count: 1 },
        }),
      )
    ).body.title.id as number;
    const glMember = await makeAccount(t, { userType: 'member', branchId: gl, status: 'active' });
    await t.db
      .update(appUser)
      .set({ expireAt: day(300) })
      .where(eq(appUser.id, glMember.id));
    const token = await signIn(t, glMember.whatsappPhone!);
    const asked = await post(token, '/api/me/requests', { titleId, fromBranchId: ks });
    const copyId = (await get(ksAdmin, `/api/titles/${titleId}`)).body.copies[0].id;
    await post(ksAdmin, `/api/requests/${asked.body.id}/accept`, { copyId });
    await post(ksAdmin, '/api/requests/dispatch', { requestIds: [asked.body.id] });
    await post(glAdmin, `/api/requests/${asked.body.id}/arrive`);
    const [r] = await t.db.select().from(bookRequest).where(eq(bookRequest.id, asked.body.id));
    expect(r!.holdUntil).toBe(day(8));
  });
});

describe('notices and events (FR-PUB-01 to FR-PUB-07)', () => {
  let fair: Notice;

  it('publishes for the admin’s own branch only; every branch is a super admin’s', async () => {
    const res = await post(ksAdmin, '/api/notices', notice());
    expect(res.status).toBe(201);
    fair = res.body as Notice;
    expect(fair).toMatchObject({ state: 'shown', branch: { code: 'KS' }, opened: false });
    expect((await post(ksAdmin, '/api/notices', notice({ branchId: gl }))).status).toBe(403);
    expect((await post(ksAdmin, '/api/notices', notice({ branchId: null }))).body.code).toBe(
      'super_admin_only',
    );
    expect(
      (await post(boss, '/api/notices', notice({ branchId: null, title: 'New year closing' })))
        .status,
    ).toBe(201);
  });

  it('needs a date and a time for an event, and lists events soonest first', async () => {
    const noDate = await post(ksAdmin, '/api/notices', notice({ kind: 'event' }));
    expect(noDate.status).toBe(400);
    for (const [title, date] of [
      ['Later talk', day(10)],
      ['Story hour', day(2)],
      ['Last week', day(-3)],
      ['Long gone', day(-8)],
    ] as const) {
      await post(
        ksAdmin,
        '/api/notices',
        notice({ kind: 'event', title, eventDate: date, startTime: '10:00', venue: 'Hall' }),
      );
    }
    const board = (await get(applicant, '/api/notices')).body as NoticeBoard;
    expect(board.events.map((e) => [e.title, e.past])).toEqual([
      ['Story hour', false],
      ['Later talk', false],
      ['Last week', true],
    ]);
    // Their own branch's and the library-wide ones, newest first (FR-PUB-04).
    expect(board.notices.map((n) => n.title)).toEqual(['New year closing', 'Book fair']);
    const galle = (await get(member, `/api/notices?branchId=${gl}`)).body as NoticeBoard;
    expect(galle.notices.map((n) => n.title)).toEqual(['New year closing']);
  });

  it('keeps a scheduled or withdrawn notice from members, and can show it again', async () => {
    const later = (await post(ksAdmin, '/api/notices', notice({ title: 'Soon', showFrom: day(3) })))
      .body as Notice;
    expect(later.state).toBe('scheduled');
    expect((await get(member, `/api/notices/${later.id}`)).status).toBe(404);
    const down = await post(ksAdmin, `/api/notices/${fair.id}/withdraw`);
    expect(down.body.state).toBe('withdrawn');
    let board = (await get(member, '/api/notices')).body as NoticeBoard;
    expect(board.notices.map((n) => n.title)).not.toContain('Book fair');
    await post(ksAdmin, `/api/notices/${fair.id}/restore`);
    board = (await get(member, '/api/notices')).body as NoticeBoard;
    expect(board.notices.map((n) => n.title)).toContain('Book fair');
    const staffList = (await get(ksAdmin, '/api/notices/manage')).body as Notice[];
    expect(staffList.find((n) => n.id === later.id)?.state).toBe('scheduled');
  });

  it('is edited by its branch, with only what changed in the log', async () => {
    expect((await patch(glAdmin, `/api/notices/${fair.id}`, notice({ title: 'x' }))).status).toBe(
      403,
    );
    const res = await patch(
      ksAdmin,
      `/api/notices/${fair.id}`,
      notice({ title: 'Book fair, Sat' }),
    );
    expect(res.body.title).toBe('Book fair, Sat');
    const [entry] = await t.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, 'notice.update'));
    expect(entry).toMatchObject({
      beforeData: { title: 'Book fair' },
      afterData: { title: 'Book fair, Sat' },
    });
  });

  it('stores its picture resized as JPEG inside the system (FR-PUB-05)', async () => {
    const photo = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#88aa66' },
    })
      .png()
      .toBuffer();
    const res = await t
      .http()
      .post(`/api/notices/${fair.id}/image`)
      .set(bearer(ksAdmin))
      .attach('file', photo, 'fair.png');
    expect(res.status).toBe(200);
    const full = await t.http().get(`/api/images/${res.body.imageId}`).buffer(true);
    expect(full.headers['content-type']).toBe('image/jpeg');
    expect(await sharp(full.body as Buffer).metadata()).toMatchObject({ width: 1200, height: 800 });
    const removed = await post(ksAdmin, `/api/notices/${fair.id}/image/remove`);
    expect(removed.body.imageId).toBeNull();
  });

  it('puts an important one on the member’s panel until they open it (FR-PUB-07)', async () => {
    const urgent = (
      await post(ksAdmin, '/api/notices', notice({ title: 'Water leak', isImportant: true }))
    ).body as Notice;
    const kinds = async () =>
      ((await get(member, '/api/me/dashboard')).body as MemberDashboard).items
        .filter((i) => i.kind === 'notice')
        .map((i) => (i.kind === 'notice' ? i.title : ''));
    expect(await kinds()).toEqual(['Water leak']);
    expect((await get(member, `/api/notices/${urgent.id}`)).body.opened).toBe(true);
    expect(await kinds()).toEqual([]);
  });

  it('is never deleted', async () => {
    await expect(t.db.execute('DELETE FROM notice')).rejects.toThrow();
    await expect(t.db.execute('DELETE FROM branch_closure')).rejects.toThrow();
  });
});
