import { addDays, addYears, todayColombo } from '@pothgula/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { activityLog, appUser, membershipPayment } from '../db/schema';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let ksLibrarian: string;
let glLibrarian: string;
let phoneSeq = 0;

const today = todayColombo();
const nextPhone = () => `0761${String(100_000 + ++phoneSeq).slice(-6)}`;

function application(over: Record<string, unknown> = {}) {
  return {
    fullName: 'නිමාලි සිල්වා',
    address: '12 Temple Road, Kesbewa',
    whatsappPhone: nextPhone(),
    otherPhone: '',
    dateOfBirth: '1990-04-12',
    organisation: 'ශ්‍රී පාලි විද්‍යාලය',
    introducedByName: 'සුනිල් පෙරේරා',
    introducedByPhone: '071 222 3333',
    homeBranchId: ks,
    password: 'river-lamp-71',
    introducerConsent: true,
    privacyAccepted: true,
    ...over,
  };
}

async function apply(over: Record<string, unknown> = {}) {
  const body = application(over);
  const res = await t.http().post('/api/applications').send(body);
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return { id: res.body.userId as number, phone: body.whatsappPhone as string };
}

const fee = {
  identityChecked: true,
  payment: { kind: 'first_fee', amountCents: 50_000, receiptNo: 'R-100' },
};

beforeAll(async () => {
  t = await startApp();
  boss = await signIn(t, (await makeAccount(t, { userType: 'super_admin' })).whatsappPhone!);
  const mk = (b: object) => t.http().post('/api/branches').set(bearer(boss)).send(b);
  ks = (await mk({ branchName: 'Kesbewa', branchCode: 'KS', address: 'x', phone: '0112000001' }))
    .body.id;
  gl = (await mk({ branchName: 'Galle', branchCode: 'GL', address: 'y', phone: '0912000002' })).body
    .id;
  ksLibrarian = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: ks })).whatsappPhone!,
  );
  glLibrarian = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: gl })).whatsappPhone!,
  );
});
afterAll(async () => {
  await t.close();
});

describe('applying (FR-AUT-03, FR-AUT-16)', () => {
  it('creates a pending account the applicant can sign in to, logged as their own act', async () => {
    const { id, phone } = await apply();
    const token = await signIn(t, phone);
    const own = await t.http().get('/api/me/membership').set(bearer(token));
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      id,
      status: 'pending',
      state: 'pending',
      introducedByPhone: '0712223333',
      otherPhone: null,
      area: 'Kesbewa',
    });
    const [entry] = await t.db
      .select()
      .from(activityLog)
      .where(
        and(eq(activityLog.action, 'application.create'), eq(activityLog.entityId, String(id))),
      );
    expect(entry).toMatchObject({ actorId: id, actorRole: 'member', branchId: ks });
    expect(JSON.stringify(entry)).not.toContain('argon2');
  });

  it('refuses a used number, a weak password, a future birth date and a missing consent', async () => {
    const { phone } = await apply();
    const send = (over: Record<string, unknown>) =>
      t.http().post('/api/applications').send(application(over));
    expect((await send({ whatsappPhone: phone })).body.code).toBe('phone_in_use');
    expect((await send({ password: 'password123' })).body.code).toBe('password_not_acceptable');
    expect((await send({ dateOfBirth: addDays(today, 1) })).body.code).toBe(
      'invalid_date_of_birth',
    );
    expect((await send({ introducerConsent: false })).body.code).toBe('invalid_request');
    expect((await send({ homeBranchId: 9999 })).body.code).toBe('branch_not_found');
  });

  it('lets an applicant correct their application while it waits', async () => {
    const { phone } = await apply();
    const token = await signIn(t, phone);
    const res = await t
      .http()
      .patch('/api/me/application')
      .set(bearer(token))
      .send({ ...application(), fullName: 'නිමාලි ද සිල්වා', homeBranchId: gl });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fullName: 'නිමාලි ද සිල්වා', branchId: gl });
  });
});

describe('the waiting list (FR-AUT-18, FR-AUT-20)', () => {
  it('shows a librarian only their branch, oldest first, with stale ones flagged', async () => {
    const older = await apply({ fullName: 'Older applicant' });
    await t.db
      .update(appUser)
      .set({ appliedAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(appUser.id, older.id));
    const elsewhere = await apply({ homeBranchId: gl, fullName: 'Galle applicant' });

    const list = await t.http().get('/api/applications').set(bearer(ksLibrarian));
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({ id: older.id, stale: true, age: expect.any(Number) });
    expect(list.body.some((a: { id: number }) => a.id === elsewhere.id)).toBe(false);
    expect(list.body.every((a: { branchId: number }) => a.branchId === ks)).toBe(true);

    const all = await t.http().get('/api/applications').set(bearer(boss));
    expect(all.body.some((a: { id: number }) => a.id === elsewhere.id)).toBe(true);
  });
});

describe('approval at the counter (FR-AUT-17, FR-MEM-01, FR-MEM-10, R18)', () => {
  it('checks identity, takes the first fee and starts the year today', async () => {
    const { id } = await apply();
    const res = await t
      .http()
      .post(`/api/applications/${id}/approve`)
      .set(bearer(ksLibrarian))
      .send(fee);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'active',
      state: 'active',
      expireAt: addYears(today, 1),
    });
    expect(res.body.payments).toEqual([
      expect.objectContaining({
        kind: 'first_fee',
        amountCents: 50_000,
        receiptNo: 'R-100',
        paidOn: today,
      }),
    ]);
    const [row] = await t.db.select().from(appUser).where(eq(appUser.id, id));
    expect(row!.identityCheckedBy).toBe(row!.approvedBy);

    const again = await t
      .http()
      .post(`/api/applications/${id}/approve`)
      .set(bearer(ksLibrarian))
      .send(fee);
    expect(again.body.code).toBe('not_pending');
  });

  it('requires the identity check, and keeps fee waivers for super admins', async () => {
    const { id } = await apply();
    const noCheck = await t
      .http()
      .post(`/api/applications/${id}/approve`)
      .set(bearer(ksLibrarian))
      .send({ ...fee, identityChecked: false });
    expect(noCheck.body.code).toBe('invalid_request');

    const waiver = {
      identityChecked: true,
      payment: { kind: 'waiver', reason: 'School reading programme' },
    };
    expect(
      (await t.http().post(`/api/applications/${id}/approve`).set(bearer(ksLibrarian)).send(waiver))
        .body.code,
    ).toBe('waiver_super_admin_only');
    const ok = await t
      .http()
      .post(`/api/applications/${id}/approve`)
      .set(bearer(boss))
      .send(waiver);
    expect(ok.body.payments[0]).toMatchObject({
      kind: 'waiver',
      amountCents: 0,
      reason: 'School reading programme',
    });
  });

  it("refuses another branch's application", async () => {
    const { id } = await apply();
    const res = await t
      .http()
      .post(`/api/applications/${id}/approve`)
      .set(bearer(glLibrarian))
      .send(fee);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('other_branch');
  });
});

describe('rejecting and reopening (FR-AUT-17)', () => {
  it('rejects with a reason, tells the person at sign-in, and can be reopened', async () => {
    const { id, phone } = await apply();
    const token = await signIn(t, phone);
    const rejected = await t
      .http()
      .post(`/api/applications/${id}/reject`)
      .set(bearer(ksLibrarian))
      .send({ reason: 'Could not confirm the address' });
    expect(rejected.body).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Could not confirm the address',
    });
    expect((await t.http().get('/api/me/membership').set(bearer(token))).status).toBe(401);
    const signin = await t
      .http()
      .post('/api/auth/sign-in')
      .send({ whatsappPhone: phone, password: 'river-lamp-71' });
    expect(signin.body.code).toBe('application_rejected');

    const list = await t.http().get('/api/applications?status=rejected').set(bearer(ksLibrarian));
    expect(list.body.some((a: { id: number }) => a.id === id)).toBe(true);
    const reopened = await t.http().post(`/api/applications/${id}/reopen`).set(bearer(ksLibrarian));
    expect(reopened.body).toMatchObject({ status: 'pending', rejectionReason: null });
    await signIn(t, phone);
  });
});

describe('registering at the counter (FR-AUT-05)', () => {
  const registration = () => {
    const { password: _p, privacyAccepted: _a, ...rest } = application();
    return { ...rest, identityChecked: true, payment: fee.payment };
  };

  it('makes an active member with a temporary password, in the librarian’s own branch only', async () => {
    const body = registration();
    const res = await t.http().post('/api/members').set(bearer(ksLibrarian)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({
      state: 'active',
      mustChangePassword: true,
      expireAt: addYears(today, 1),
    });
    const token = await signIn(t, body.whatsappPhone, res.body.temporaryPassword);
    expect((await t.http().get('/api/me/membership').set(bearer(token))).body.code).toBe(
      'must_change_password',
    );

    const other = await t
      .http()
      .post('/api/members')
      .set(bearer(ksLibrarian))
      .send({ ...registration(), homeBranchId: gl });
    expect(other.body.code).toBe('other_branch');
  });
});

describe('members: search, renewal and the three lists (FR-MEM-02, FR-MEM-03)', () => {
  it('finds a member by part of the name or by phone, within the branch', async () => {
    const { id, phone } = await apply({ fullName: 'කුසුම් ජයසූරිය' });
    const byName = await t
      .http()
      .get(`/api/members?q=${encodeURIComponent('ජයසූ')}`)
      .set(bearer(ksLibrarian));
    expect(byName.body.map((m: { id: number }) => m.id)).toContain(id);
    const byPhone = await t
      .http()
      .get(`/api/members?q=${encodeURIComponent('+94 ' + phone.slice(1))}`)
      .set(bearer(ksLibrarian));
    expect(byPhone.body.map((m: { id: number }) => m.id)).toEqual([id]);
    const elsewhere = await t.http().get(`/api/members?q=${phone}`).set(bearer(glLibrarian));
    expect(elsewhere.body).toEqual([]);
  });

  it('renews from the old expiry within the grace period, and from today after it', async () => {
    const { id } = await apply();
    await t.http().post(`/api/applications/${id}/approve`).set(bearer(ksLibrarian)).send(fee);
    const renew = () =>
      t
        .http()
        .post(`/api/members/${id}/renew`)
        .set(bearer(ksLibrarian))
        .send({ amountCents: 50_000, receiptNo: 'R-200' });

    // Expired 30 days ago — inside the 90-day grace: runs from the old date.
    const recentlyExpired = addDays(today, -30);
    await t.db.update(appUser).set({ expireAt: recentlyExpired }).where(eq(appUser.id, id));
    expect((await renew()).body.expireAt).toBe(addYears(recentlyExpired, 1));

    // Expired 200 days ago — outside it: a new year from today.
    await t.db
      .update(appUser)
      .set({ expireAt: addDays(today, -200) })
      .where(eq(appUser.id, id));
    expect((await renew()).body.expireAt).toBe(addYears(today, 1));

    const payments = await t.db
      .select()
      .from(membershipPayment)
      .where(eq(membershipPayment.userId, id));
    expect(payments.map((p) => p.kind).sort()).toEqual(['fee', 'fee', 'first_fee']);
  });

  it('will not renew an application that has not been approved', async () => {
    const { id } = await apply();
    const res = await t
      .http()
      .post(`/api/members/${id}/renew`)
      .set(bearer(ksLibrarian))
      .send({ amountCents: 1, receiptNo: 'x' });
    expect(res.body.code).toBe('cannot_renew');
  });

  it('lists paid recently, expiring soon and expired', async () => {
    const paid = await apply();
    await t.http().post(`/api/applications/${paid.id}/approve`).set(bearer(ksLibrarian)).send(fee);
    const soon = await apply();
    await t.http().post(`/api/applications/${soon.id}/approve`).set(bearer(ksLibrarian)).send(fee);
    await t.db
      .update(appUser)
      .set({ expireAt: addDays(today, 10) })
      .where(eq(appUser.id, soon.id));
    const gone = await apply();
    await t.http().post(`/api/applications/${gone.id}/approve`).set(bearer(ksLibrarian)).send(fee);
    await t.db
      .update(appUser)
      .set({ expireAt: addDays(today, -1) })
      .where(eq(appUser.id, gone.id));

    const res = await t.http().get('/api/members/overview').set(bearer(ksLibrarian));
    const ids = (list: { id: number }[]) => list.map((m) => m.id);
    expect(ids(res.body.paidRecently)).toContain(paid.id);
    expect(ids(res.body.expiringSoon)).toContain(soon.id);
    expect(ids(res.body.expired)).toContain(gone.id);
    expect(res.body.expired.find((m: { id: number }) => m.id === gone.id).state).toBe('expired');
  });
});

describe('a member changes their own details (FR-AUT-21)', () => {
  it('may change address, other phone and organisation, nothing else', async () => {
    const { id, phone } = await apply();
    await t.http().post(`/api/applications/${id}/approve`).set(bearer(ksLibrarian)).send(fee);
    const token = await signIn(t, phone);
    const res = await t.http().patch('/api/me/profile').set(bearer(token)).send({
      address: '7 Lake Road, Piliyandala',
      otherPhone: '011 233 4455',
      fullName: 'Someone Else',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      address: '7 Lake Road, Piliyandala',
      otherPhone: '0112334455',
      area: 'Piliyandala',
    });
    expect(res.body.fullName).toBe('නිමාලි සිල්වා');
  });

  it('keeps staff out of other branches’ member records', async () => {
    const { id } = await apply();
    expect((await t.http().get(`/api/members/${id}`).set(bearer(glLibrarian))).status).toBe(403);
    expect((await t.http().get(`/api/members/${id}`).set(bearer(ksLibrarian))).status).toBe(200);
  });
});
