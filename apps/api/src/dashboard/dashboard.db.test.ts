import { addDays, endOfMonth, todayColombo } from '@pothgula/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { appUser, borrow } from '../db/schema';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let ksLibrarian: string;
let ksAdminId: number;

const today = todayColombo();
const day = (n: number) => addDays(today, n);

/** Who is who in this file's library. */
const people: Record<string, { id: number; token: string }> = {};
const loans: Record<string, number> = {};

beforeAll(async () => {
  t = await startApp();
  const superAdmin = await makeAccount(t, { userType: 'super_admin' });
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

  const member = async (
    name: string,
    opts: {
      branchId?: number;
      status?: 'active' | 'pending' | 'suspended';
      expireAt?: string | null;
    },
  ) => {
    const row = await makeAccount(t, {
      userType: 'member',
      branchId: opts.branchId ?? ks,
      status: opts.status ?? 'active',
    });
    const expireAt = opts.expireAt === undefined ? day(300) : opts.expireAt;
    await t.db
      .update(appUser)
      .set({ expireAt, fullName: name, otherPhone: name === 'Late Lal' ? '0112345678' : null })
      .where(eq(appUser.id, row.id));
    people[name] = { id: row.id, token: await signIn(t, row.whatsappPhone!) };
  };
  await member('Late Lal', {});
  await member('Soon Sunil', {});
  await member('Back Bimal', {});
  await member('Galle Gayan', { branchId: gl });
  await member('Applicant Anoma', { status: 'pending', expireAt: null });
  await member('Suspended Sena', { status: 'suspended' });
  await member('Ending Eshani', { expireAt: today });
  await member('Lapsed Lakmal', { expireAt: day(-1) });
  await member('Quiet Kumari', {});

  const copyAt = async (branchId: number) => {
    const res = await t
      .http()
      .post('/api/titles')
      .set(bearer(boss))
      .send({ title: 'කලියුගය', categoryCode: 'A1', copies: { branchId, count: 1 } });
    return res.body.title.copies[0].id as number;
  };
  const loan = async (
    key: string,
    who: string,
    due: number,
    opts: { returned?: number; voided?: boolean; branchId?: number } = {},
  ) => {
    const branchId = opts.branchId ?? ks;
    const [row] = await t.db
      .insert(borrow)
      .values({
        copyId: await copyAt(branchId),
        userId: people[who]!.id,
        branchId,
        borrowDate: day(due - 14),
        dueDate: day(due),
        originalDueDate: day(due),
        issuedBy: ksAdminId,
        returnedOn: opts.returned === undefined ? null : day(opts.returned),
        receivedBy: opts.returned === undefined ? null : ksAdminId,
        ...(opts.voided
          ? { voidedAt: new Date(), voidedBy: ksAdminId, voidReason: 'entered by mistake' }
          : {}),
      })
      .returning();
    loans[key] = row!.id;
  };
  await loan('overdue6', 'Late Lal', -6);
  await loan('overdue2', 'Late Lal', -2);
  await loan('dueToday', 'Soon Sunil', 0);
  await loan('due3', 'Soon Sunil', 3);
  await loan('due10', 'Soon Sunil', 10);
  await loan('backLate', 'Back Bimal', -4, { returned: 0 });
  await loan('backOnTime', 'Back Bimal', 5, { returned: 0 });
  await loan('voided', 'Back Bimal', -9, { voided: true });
  await loan('galle', 'Galle Gayan', -1, { branchId: gl });
});
afterAll(async () => {
  await t.close();
});

const get = (token: string, path: string) => t.http().get(path).set(bearer(token));

describe('the staff dashboard (FR-NOT-03, FR-NOT-07, FR-NOT-09)', () => {
  it("counts today's work at the admin's own branch, most urgent first", async () => {
    const res = await get(ksLibrarian, '/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ today, monthEnd: endOfMonth(today) });
    expect(res.body.branches).toHaveLength(1);
    const [b] = res.body.branches;
    expect(b).toMatchObject({ branchId: ks, branchCode: 'KS', warningDays: 5 });
    expect(b.counts).toEqual({
      suspended: 1,
      settlements_passed: 0,
      settlements_closing: 0,
      settlements_open: 0,
      overdue: 2,
      overdueMembers: 1,
      transit_overdue: 0,
      extensions_urgent: 0,
      due_today: 1,
      extensions_waiting: 0,
      requests_to_decide: 0,
      requests_to_send: 0,
      holds_lapsing: 0,
      requests_arriving: 0,
      copies_elsewhere: 0,
      applications_waiting: 1,
      due_soon: 2,
      returned_late_today: 1,
      expiring_this_month: 1,
    });
    expect(b.items.map((i: { kind: string }) => i.kind)).toEqual([
      'suspended',
      'overdue',
      'due_today',
      'applications_waiting',
      'due_soon',
      'returned_late_today',
      'expiring_this_month',
    ]);
  });

  it('gives a super admin every branch, by code', async () => {
    const res = await get(boss, '/api/dashboard');
    expect(res.body.branches.map((b: { branchCode: string }) => b.branchCode)).toEqual([
      'GL',
      'KS',
    ]);
    expect(res.body.branches[0].items).toEqual([{ kind: 'overdue', tone: 'urgent', count: 1 }]);
  });

  it('is for staff only', async () => {
    expect((await get(people['Late Lal']!.token, '/api/dashboard')).status).toBe(403);
  });
});

describe('the due lists (FR-NOT-04, FR-NOT-12)', () => {
  it('holds overdue books above the five-day list, with the phones to call', async () => {
    const res = await get(ksLibrarian, '/api/due');
    expect(res.status).toBe(200);
    const [b] = res.body.branches;
    const ids = (rows: { id: number }[]) => rows.map((r) => r.id);
    expect(ids(b.overdue)).toEqual([loans.overdue6, loans.overdue2]);
    expect(ids(b.dueSoon)).toEqual([loans.dueToday, loans.due3]);
    expect(ids(b.returnedLateToday)).toEqual([loans.backLate]);
    expect(b.overdue[0]).toMatchObject({
      memberName: 'Late Lal',
      memberOtherPhone: '0112345678',
      memberBranchCode: 'KS',
      copyBranchCode: 'KS',
      daysLate: 6,
      overdue: true,
      extensionStatus: 'none',
    });
    const all = [...b.overdue, ...b.dueSoon, ...b.returnedLateToday];
    expect(ids(all)).not.toContain(loans.voided);
    expect(ids(all)).not.toContain(loans.due10);
  });

  it('keeps an admin to their own branch; a super admin can pick one', async () => {
    const other = await get(ksLibrarian, `/api/due?branchId=${gl}`);
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('other_branch');

    const one = await get(boss, `/api/due?branchId=${gl}`);
    expect(one.body.branches).toHaveLength(1);
    expect(one.body.branches[0].overdue.map((l: { id: number }) => l.id)).toEqual([loans.galle]);

    expect((await get(boss, '/api/due')).body.branches).toHaveLength(2);
    expect((await get(boss, '/api/due?branchId=abc')).status).toBe(400);
    expect((await get(boss, '/api/due?branchId=9999')).status).toBe(404);
  });
});

describe('the sheets to print (FR-RPT-16, FR-NOT-04)', () => {
  it("makes the daily loans sheet and the call list for the admin's branch", async () => {
    for (const path of ['/api/sheets/daily-loans', '/api/sheets/call-list']) {
      const res = await get(ksLibrarian, path).buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain(`-KS-${today}.pdf`);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  it('asks a super admin which branch, and keeps an admin to their own', async () => {
    const none = await get(boss, '/api/sheets/daily-loans');
    expect(none.status).toBe(400);
    expect(none.body.code).toBe('branch_required');
    expect((await get(boss, `/api/sheets/call-list?branchId=${gl}`)).status).toBe(200);
    expect((await get(ksLibrarian, `/api/sheets/daily-loans?branchId=${gl}`)).status).toBe(403);
  });
});

describe("a member's panel (FR-NOT-01, FR-NOT-02, FR-NOT-08)", () => {
  const panel = async (who: string) => {
    const res = await get(people[who]!.token, '/api/me/dashboard');
    expect(res.status).toBe(200);
    return res.body.items as { kind: string; [k: string]: unknown }[];
  };

  it('puts overdue books first, the longest overdue at the top', async () => {
    expect(await panel('Late Lal')).toEqual([
      expect.objectContaining({ kind: 'loan_overdue', loanId: loans.overdue6, daysLate: 6 }),
      expect.objectContaining({ kind: 'loan_overdue', loanId: loans.overdue2, daysLate: 2 }),
    ]);
  });

  it('warns about books due within five days, and not later ones', async () => {
    expect(await panel('Soon Sunil')).toEqual([
      expect.objectContaining({ kind: 'loan_due_soon', loanId: loans.dueToday, daysLeft: 0 }),
      expect.objectContaining({ kind: 'loan_due_soon', loanId: loans.due3, daysLeft: 3 }),
    ]);
  });

  it('notes late returns, and never a voided loan', async () => {
    expect(await panel('Back Bimal')).toEqual([
      { kind: 'late_returns', tone: 'info', count: 1, months: 12 },
    ]);
  });

  it('warns before the membership ends, and says clearly once it has', async () => {
    expect(await panel('Ending Eshani')).toEqual([
      { kind: 'membership_expiring', tone: 'warning', expireAt: today, daysLeft: 0 },
    ]);
    expect(await panel('Lapsed Lakmal')).toEqual([
      { kind: 'membership_expired', tone: 'urgent', expireAt: day(-1) },
    ]);
  });

  it('tells an applicant what to bring, and a suspended member first of all', async () => {
    expect(await panel('Applicant Anoma')).toEqual([
      { kind: 'application_waiting', tone: 'info', branchName: 'Kesbewa', feeCents: 0 },
    ]);
    expect((await panel('Suspended Sena'))[0]).toEqual({ kind: 'suspended', tone: 'urgent' });
  });

  it('is empty for a member with nothing to attend to', async () => {
    expect(await panel('Quiet Kumari')).toEqual([]);
  });

  it("follows the member's own branch; staff have no member panel", async () => {
    expect(await panel('Galle Gayan')).toEqual([
      expect.objectContaining({ kind: 'loan_overdue', loanId: loans.galle }),
    ]);
    const res = await get(ksLibrarian, '/api/me/dashboard');
    expect(res.status).toBe(403);
  });
});
