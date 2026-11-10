import { type LogPage, todayColombo } from '@pothgula/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { activityLog } from '../db/schema';
import { EXPORT_LIMITS } from './log.service';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let bossId: number;
let ksAdmin: string;
let ksAdminId: number;
let glAdmin: string;
let member: string;

const today = todayColombo();

const page = (token: string, query: Record<string, string | number> = {}) =>
  t.http().get('/api/log').query(query).set(bearer(token));

async function reads(actorId: number, action = 'log.read') {
  return t.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.actorId, actorId), eq(activityLog.action, action)));
}

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
  // Library-wide: a super admin's entry with no branch.
  await t.http().post('/api/categories').set(bearer(boss)).send({ code: 'A1', name: 'නවකතා' });
  const a = await makeAccount(t, { userType: 'admin', branchId: ks });
  ksAdminId = a.id;
  ksAdmin = await signIn(t, a.whatsappPhone!);
  glAdmin = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: gl })).whatsappPhone!,
  );
  member = await signIn(
    t,
    (await makeAccount(t, { userType: 'member', branchId: ks })).whatsappPhone!,
  );

  // Hand-written entries with known dates and values.
  await t.db.insert(activityLog).values([
    {
      at: new Date('2026-01-15T10:00:00+05:30'),
      actorId: ksAdminId,
      actorRole: 'admin',
      branchId: ks,
      action: 'copy.update',
      entity: 'copy',
      entityId: '7',
      beforeData: { condition: 'useable', notes: null },
      afterData: { condition: 'not_useable', notes: '=HYPERLINK("http://x")' },
      ipAddress: '10.0.0.5',
    },
    {
      at: new Date('2026-01-16T00:10:00+05:30'), // 15th in UTC, 16th at the library
      actorId: ksAdminId,
      actorRole: 'admin',
      branchId: ks,
      action: 'borrow.issue',
      entity: 'borrow',
      entityId: '3',
      afterData: { copyId: 7, userId: 99, dueDate: '2026-01-30' },
    },
    {
      at: new Date('2026-01-17T09:00:00+05:30'),
      actorRole: 'system',
      branchId: gl,
      action: 'borrow.issue',
      entity: 'borrow',
      entityId: '4',
    },
  ]);
});

afterAll(async () => {
  await t.close();
});

describe('who reads what (FR-LOG-06)', () => {
  it('lets only staff read the log', async () => {
    expect((await page(member)).status).toBe(403);
  });

  it("shows an admin their own branch's entries and library-wide ones, never another branch's", async () => {
    const res = await page(ksAdmin, { limit: 200 });
    expect(res.status).toBe(200);
    const body = res.body as LogPage;
    expect(body.entries.length).toBeGreaterThan(0);
    for (const e of body.entries) {
      expect(
        e.branchId === ks ||
          (e.branchId === null && ['category', 'title', 'library'].includes(e.entity)),
      ).toBe(true);
    }
    expect(
      body.entries.some((e) => e.entity === 'category' && e.action === 'category.create'),
    ).toBe(true);
    expect(body.entries.some((e) => e.entity === 'borrow' && e.entityId === '4')).toBe(false);
    // Super admins' branch creations carry the new branch; GL's is not shown to KS.
    expect(body.entries.some((e) => e.branchId === gl)).toBe(false);
  });

  it("refuses an admin who asks for another branch's log", async () => {
    const res = await page(ksAdmin, { branchId: gl });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('other_branch');
  });

  it('shows a super admin every branch', async () => {
    const res = await page(boss, { limit: 200 });
    const branches = new Set((res.body as LogPage).entries.map((e) => e.branchId));
    expect(branches.has(ks)).toBe(true);
    expect(branches.has(gl)).toBe(true);
    expect(branches.has(null)).toBe(true);
  });
});

describe('filters (FR-LOG-07)', () => {
  it('filters by library dates, inclusive, newest first', async () => {
    const res = await page(boss, { from: '2026-01-16', to: '2026-01-17' });
    const ids = (res.body as LogPage).entries.map((e) => e.entityId);
    expect(ids).toEqual(['4', '3']);
    const one = await page(boss, { from: '2026-01-15', to: '2026-01-15' });
    expect((one.body as LogPage).entries.map((e) => e.entityId)).toEqual(['7']);
  });

  it('filters by kind of action, a group or one action', async () => {
    const group = await page(boss, { action: 'borrow', from: '2026-01-01', to: '2026-06-30' });
    expect((group.body as LogPage).entries.every((e) => e.action.startsWith('borrow.'))).toBe(true);
    expect((group.body as LogPage).entries).toHaveLength(2);
    const one = await page(boss, { action: 'copy.update' });
    expect((one.body as LogPage).entries.map((e) => e.entityId)).toEqual(['7']);
  });

  it('filters by person, role, branch and record', async () => {
    const byPerson = await page(boss, { actorId: ksAdminId, from: '2026-01-01', to: '2026-06-30' });
    expect((byPerson.body as LogPage).entries.map((e) => e.entityId)).toEqual(['3', '7']);
    const bySystem = await page(boss, { role: 'system', branchId: gl, to: '2026-06-30' });
    expect((bySystem.body as LogPage).entries.map((e) => e.entityId)).toEqual(['4']);
    const history = await page(ksAdmin, { entity: 'copy', entityId: '7' });
    const entry = (history.body as LogPage).entries[0]!;
    expect(entry).toMatchObject({
      actorId: ksAdminId,
      actorName: 'Staff Member',
      actorRole: 'admin',
      branchCode: 'KS',
      before: { condition: 'useable', notes: null },
      ipAddress: '10.0.0.5',
    });
  });

  it('refuses a filter that makes no sense', async () => {
    expect((await page(boss, { from: '2026-02-01', to: '2026-01-01' })).status).toBe(400);
    expect((await page(boss, { entityId: '7' })).status).toBe(400);
    expect((await page(boss, { entity: 'no_such' })).status).toBe(400);
    expect((await page(boss, { action: "x'; drop" })).status).toBe(400);
  });
});

describe('pages and logged reads (FR-LOG-10)', () => {
  it('logs a new search once, not the pages after it, and leaves the read out of what it shows', async () => {
    const before = (await reads(bossId)).length;
    const first = await page(boss, { limit: 2, from: '2026-01-01', to: '2026-06-30' });
    const body = first.body as LogPage;
    expect(body.entries.map((e) => e.entityId)).toEqual(['4', '3']);
    expect(body.nextBefore).toBe(body.entries[1]!.id);
    expect(body.entries.some((e) => e.action === 'log.read')).toBe(false);

    const second = await page(boss, {
      limit: 2,
      from: '2026-01-01',
      to: '2026-06-30',
      before: body.nextBefore!,
    });
    expect((second.body as LogPage).entries.map((e) => e.entityId)).toEqual(['7']);
    expect((second.body as LogPage).nextBefore).toBeNull();

    const after = await reads(bossId);
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.afterData).toEqual({ filter: { from: '2026-01-01', to: '2026-06-30' } });
  });

  it('logs a cursor on a search nobody logged, so a made-up cursor is not a way round FR-LOG-10', async () => {
    const before = (await reads(bossId)).length;
    await page(boss, { role: 'system', before: 999_999_999 });
    await page(boss, { role: 'system', before: 999_999_999 }); // the same search: now free
    const after = await reads(bossId);
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.afterData).toEqual({ filter: { role: 'system' } });
  });

  it("writes an admin's read against their branch, so their branch can see who looked", async () => {
    await page(ksAdmin, { entity: 'copy', entityId: '7' });
    const [read] = (await reads(ksAdminId)).slice(-1);
    expect(read!.branchId).toBe(ks);
    expect(read!.afterData).toEqual({ filter: { entity: 'copy', entityId: '7' } });
    const seen = await page(glAdmin, { action: 'log' });
    expect((seen.body as LogPage).entries.some((e) => e.actorId === ksAdminId)).toBe(false);
  });
});

describe('exports (FR-LOG-08)', () => {
  const exp = (token: string, query: Record<string, string>) =>
    t.http().get('/api/log/export').query(query).set(bearer(token)).buffer(true);

  it('writes a CSV that Excel reads as UTF-8, with full values and no live formulas', async () => {
    const res = await exp(boss, { format: 'csv', from: '2026-01-15', to: '2026-01-15' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="activity-log-${today}.csv"`,
    );
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe('No.,When,Who,Role,Branch,Action,Record,Before,After,Network address');
    expect(lines[1]).toContain('2026-01-15 10:00:00');
    expect(lines[1]).toContain('copy #7');
    // The whole after value is one quoted JSON cell; the formula sits inside it, not at its start.
    expect(lines[1]).toContain(',"{""notes"":""=HYPERLINK(');
    expect(lines).toHaveLength(3); // header, one row, the trailing line end
  });

  it('writes a text file with the filter and one block per entry', async () => {
    const res = await exp(boss, { format: 'txt', action: 'copy.update' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Activity log');
    expect(res.text).toContain('Filter: Action: copy.update');
    expect(res.text).toContain('Branch: every branch');
    expect(res.text).toContain('condition: useable → not_useable');
  });

  it("puts the branch name on an admin's PDF and logs every export", async () => {
    const before = (await reads(ksAdminId, 'log.export')).length;
    const res = await exp(ksAdmin, { format: 'pdf', action: 'borrow' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const logged = await reads(ksAdminId, 'log.export');
    expect(logged).toHaveLength(before + 1);
    expect(logged.at(-1)!.afterData).toEqual({
      filter: { action: 'borrow' },
      format: 'pdf',
      entries: 1,
    });
  });

  it('refuses an unknown format, and a file too big to be useful', async () => {
    expect((await exp(boss, { format: 'xlsx' })).status).toBe(400);
    await t.db.insert(activityLog).values(
      Array.from({ length: EXPORT_LIMITS.pdf + 1 }, () => ({
        at: new Date('2025-06-01T08:00:00Z'),
        actorRole: 'system',
        action: 'test.bulk',
        entity: 'job',
      })),
    );
    const res = await exp(boss, { format: 'pdf', action: 'test.bulk' });
    expect(res.status).toBe(422);
    expect(JSON.parse(res.text)).toMatchObject({
      code: 'export_too_large',
      details: { count: EXPORT_LIMITS.pdf + 1, limit: EXPORT_LIMITS.pdf },
    });
  });
});
