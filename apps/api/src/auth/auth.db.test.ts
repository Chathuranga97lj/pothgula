import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, PASSWORD, signIn, startApp, type TestApp } from '../../test/app';
import { makeBranch } from '../../test/fixtures';
import { activityLog, appUser, session } from '../db/schema';

let t: TestApp;
let branchId: number;

beforeAll(async () => {
  t = await startApp();
  branchId = (await makeBranch(t.db, 'KS')).id;
});
afterAll(async () => {
  await t.close();
});

const logOf = (action: string) =>
  t.db.select().from(activityLog).where(eq(activityLog.action, action));

describe('sign-in (FR-AUT-01, FR-AUT-02)', () => {
  it('signs in with the WhatsApp number however it is typed, and logs it', async () => {
    const member = await makeAccount(t, { userType: 'member', branchId });
    const typed = `+94 ${member.whatsappPhone!.slice(1, 3)} ${member.whatsappPhone!.slice(3)}`;
    const res = await t
      .http()
      .post('/api/auth/sign-in')
      .send({ whatsappPhone: typed, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: member.id, userType: 'member' });
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const me = await t.http().get('/api/auth/me').set(bearer(res.body.token));
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(member.id);

    const entries = await logOf('auth.signin');
    expect(entries.some((e) => e.actorId === member.id)).toBe(true);
  });

  it('gives the same answer for a wrong password and an unknown number', async () => {
    const admin = await makeAccount(t, { userType: 'admin', branchId });
    const wrong = await t
      .http()
      .post('/api/auth/sign-in')
      .send({ whatsappPhone: admin.whatsappPhone, password: 'not-the-password' });
    const unknown = await t
      .http()
      .post('/api/auth/sign-in')
      .send({ whatsappPhone: '0700000001', password: 'whatever-123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.code).toBe('invalid_credentials');
  });

  it('stores only a hash of the session token', async () => {
    const member = await makeAccount(t, { userType: 'member', branchId });
    const token = await signIn(t, member.whatsappPhone!);
    const rows = await t.db.select().from(session).where(eq(session.userId, member.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lets applicants sign in, but not rejected applicants (FR-AUT-16, FR-AUT-17)', async () => {
    const applicant = await makeAccount(t, { userType: 'member', branchId, status: 'pending' });
    await signIn(t, applicant.whatsappPhone!);

    const rejected = await makeAccount(t, {
      userType: 'member',
      branchId,
      status: 'rejected',
      rejectionReason: 'Could not confirm identity',
    });
    const res = await t
      .http()
      .post('/api/auth/sign-in')
      .send({ whatsappPhone: rejected.whatsappPhone, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('application_rejected');
  });
});

describe('lockout (FR-AUT-06)', () => {
  it('locks after five wrong passwords, refuses even the right one, and unlocks after the wait', async () => {
    const admin = await makeAccount(t, { userType: 'admin', branchId });
    const attempt = (password: string) =>
      t.http().post('/api/auth/sign-in').send({ whatsappPhone: admin.whatsappPhone, password });

    for (let i = 1; i <= 4; i++)
      expect((await attempt('wrong-password')).body.code).toBe('invalid_credentials');
    const fifth = await attempt('wrong-password');
    expect(fifth.body.code).toBe('account_locked');
    expect(fifth.body.details.retryAfterSeconds).toBeGreaterThan(800);

    expect((await attempt(PASSWORD)).body.code).toBe('account_locked');
    expect(await logOf('auth.locked')).toHaveLength(1);

    // 15 minutes later:
    await t.db
      .update(appUser)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(appUser.id, admin.id));
    expect((await attempt(PASSWORD)).status).toBe(200);
    const [after] = await t.db.select().from(appUser).where(eq(appUser.id, admin.id));
    expect(after).toMatchObject({ failedSigninCount: 0, lockedUntil: null });
  });
});

describe('sessions (NFR-06, FR-AUT-07)', () => {
  it('closes every route except sign-in and health to anyone not signed in', async () => {
    expect((await t.http().get('/api/health')).status).toBe(200);
    for (const [method, path] of [
      ['get', '/api/auth/me'],
      ['get', '/api/staff'],
      ['get', '/api/branches'],
      ['post', '/api/staff'],
    ] as const) {
      const res = await t.http()[method](path);
      expect(res.status, path).toBe(401);
      expect(res.body.code).toBe('not_signed_in');
    }
    const bad = await t.http().get('/api/auth/me').set(bearer('made-up-token'));
    expect(bad.status).toBe(401);
  });

  it('ends a staff session after 30 idle minutes, but keeps a member signed in', async () => {
    const admin = await makeAccount(t, { userType: 'admin', branchId });
    const member = await makeAccount(t, { userType: 'member', branchId });
    const adminToken = await signIn(t, admin.whatsappPhone!);
    const memberToken = await signIn(t, member.whatsappPhone!);

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
    await t.db.update(session).set({ lastSeenAt: twoHoursAgo });

    expect((await t.http().get('/api/auth/me').set(bearer(adminToken))).status).toBe(401);
    expect((await t.http().get('/api/auth/me').set(bearer(memberToken))).status).toBe(200);
  });

  it('signs out by ending the session', async () => {
    const member = await makeAccount(t, { userType: 'member', branchId });
    const token = await signIn(t, member.whatsappPhone!);
    expect((await t.http().post('/api/auth/sign-out').set(bearer(token))).status).toBe(204);
    expect((await t.http().get('/api/auth/me').set(bearer(token))).status).toBe(401);
  });
});

describe('change password (FR-AUT-10, FR-AUT-13, FR-AUT-15)', () => {
  it('checks the current password and the rules, then ends every other session', async () => {
    const member = await makeAccount(t, { userType: 'member', branchId });
    const phone = member.whatsappPhone!;
    const here = await signIn(t, phone);
    const elsewhere = await signIn(t, phone);
    const change = (body: object) =>
      t.http().post('/api/auth/change-password').set(bearer(here)).send(body);

    expect(
      (await change({ currentPassword: 'wrong', newPassword: 'a-good-new-one' })).body.code,
    ).toBe('wrong_current_password');
    const common = await change({ currentPassword: PASSWORD, newPassword: 'Password123' });
    expect(common.status).toBe(422);
    expect(common.body.details.problems).toContain('too_common');
    expect(
      (await change({ currentPassword: PASSWORD, newPassword: phone })).body.details.problems,
    ).toContain('same_as_phone');

    expect(
      (await change({ currentPassword: PASSWORD, newPassword: 'blue-kite-under-trees' })).status,
    ).toBe(204);
    expect((await t.http().get('/api/auth/me').set(bearer(here))).status).toBe(200);
    expect((await t.http().get('/api/auth/me').set(bearer(elsewhere))).status).toBe(401);
    await signIn(t, phone, 'blue-kite-under-trees');

    const [entry] = (await logOf('auth.password_change')).filter(
      (e) => e.entityId === String(member.id),
    );
    expect(JSON.stringify(entry)).not.toContain('blue-kite');
    expect(JSON.stringify(entry)).not.toContain('$argon2');
  });
});

describe('temporary passwords (FR-AUT-11, FR-AUT-12)', () => {
  it('lets an admin reset a member of their own branch; the member must change it first', async () => {
    const admin = await makeAccount(t, { userType: 'admin', branchId });
    const member = await makeAccount(t, { userType: 'member', branchId });
    const memberToken = await signIn(t, member.whatsappPhone!);
    const adminToken = await signIn(t, admin.whatsappPhone!);

    const res = await t
      .http()
      .post(`/api/users/${member.id}/reset-password`)
      .set(bearer(adminToken));
    expect(res.status).toBe(200);
    const temp = res.body.temporaryPassword as string;
    expect(temp).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

    // The member's existing session ended.
    expect((await t.http().get('/api/auth/me').set(bearer(memberToken))).status).toBe(401);

    // With the temporary password, only changing it is possible.
    const tempToken = await signIn(t, member.whatsappPhone!, temp);
    const me = await t.http().get('/api/auth/me').set(bearer(tempToken));
    expect(me.body.user.mustChangePassword).toBe(true);
    const blocked = await t.http().get('/api/branches').set(bearer(tempToken));
    expect(blocked.body.code).toBe('must_change_password');
    await t
      .http()
      .post('/api/auth/change-password')
      .set(bearer(tempToken))
      .send({ currentPassword: temp, newPassword: 'green-door-at-noon' })
      .expect(204);
    expect((await t.http().get('/api/branches').set(bearer(tempToken))).status).toBe(200);

    // FR-AUT-13: logged, without the temporary password.
    const entries = (await logOf('auth.password_reset')).filter(
      (e) => e.entityId === String(member.id),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorId).toBe(admin.id);
    expect(JSON.stringify(entries[0])).not.toContain(temp);
  });

  it('does not let an admin reset another branch, a super admin, or themselves', async () => {
    const other = (await makeBranch(t.db, 'GL')).id;
    const admin = await makeAccount(t, { userType: 'admin', branchId });
    const elsewhere = await makeAccount(t, { userType: 'member', branchId: other });
    const boss = await makeAccount(t, { userType: 'super_admin' });
    const token = await signIn(t, admin.whatsappPhone!);
    for (const id of [elsewhere.id, boss.id, admin.id]) {
      const res = await t.http().post(`/api/users/${id}/reset-password`).set(bearer(token));
      expect(res.status, String(id)).toBe(403);
    }
    const member = await makeAccount(t, { userType: 'member', branchId });
    const memberToken = await signIn(t, member.whatsappPhone!);
    expect(
      (await t.http().post(`/api/users/${admin.id}/reset-password`).set(bearer(memberToken)))
        .status,
    ).toBe(403);
  });
});

describe('staff accounts (FR-AUT-04, FR-AUT-05, FR-AUT-09, FR-AUT-14)', () => {
  it('only a super admin creates staff, who start with a temporary password', async () => {
    const boss = await makeAccount(t, { userType: 'super_admin' });
    const admin = await makeAccount(t, { userType: 'admin', branchId });
    const bossToken = await signIn(t, boss.whatsappPhone!);
    const adminToken = await signIn(t, admin.whatsappPhone!);
    const newAdmin = {
      fullName: 'කමල් බණ්ඩාර',
      whatsappPhone: '077 555 0101',
      userType: 'admin',
      branchId,
    };

    expect((await t.http().post('/api/staff').set(bearer(adminToken)).send(newAdmin)).status).toBe(
      403,
    );

    const created = await t.http().post('/api/staff').set(bearer(bossToken)).send(newAdmin);
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({
      whatsappPhone: '0775550101',
      userType: 'admin',
      mustChangePassword: true,
    });
    await signIn(t, '0775550101', created.body.temporaryPassword);

    expect(
      (await t.http().post('/api/staff').set(bearer(bossToken)).send(newAdmin)).body.code,
    ).toBe('phone_in_use');
    const noBranch = await t
      .http()
      .post('/api/staff')
      .set(bearer(bossToken))
      .send({ ...newAdmin, whatsappPhone: '0775550102', branchId: null });
    expect(noBranch.body.code).toBe('invalid_request');

    const list = await t.http().get('/api/staff').set(bearer(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.every((s: { branchId: number }) => s.branchId === branchId)).toBe(true);
  });

  it('never lets the active super admins fall below two, and ends a deactivated account at once', async () => {
    // Fresh state: count only the super admins this test makes.
    await t.db
      .update(appUser)
      .set({ status: 'deactivated' })
      .where(and(eq(appUser.userType, 'super_admin'), isNull(appUser.branchId)));
    const a = await makeAccount(t, { userType: 'super_admin' });
    const b = await makeAccount(t, { userType: 'super_admin' });
    const aToken = await signIn(t, a.whatsappPhone!);
    const bToken = await signIn(t, b.whatsappPhone!);

    const refused = await t
      .http()
      .post(`/api/users/${b.id}/deactivate`)
      .set(bearer(aToken))
      .send({ reason: 'Left' });
    expect(refused.body.code).toBe('minimum_super_admins');
    expect(
      (
        await t
          .http()
          .post(`/api/users/${a.id}/deactivate`)
          .set(bearer(aToken))
          .send({ reason: 'x' })
      ).body.code,
    ).toBe('cannot_deactivate_self');

    await makeAccount(t, { userType: 'super_admin' }); // a third, so one may go
    expect(
      (
        await t
          .http()
          .post(`/api/users/${b.id}/deactivate`)
          .set(bearer(aToken))
          .send({ reason: 'Left the library' })
      ).status,
    ).toBe(204);
    expect((await t.http().get('/api/auth/me').set(bearer(bToken))).status).toBe(401);
    const again = await t
      .http()
      .post('/api/auth/sign-in')
      .send({ whatsappPhone: b.whatsappPhone, password: PASSWORD });
    expect(again.body.code).toBe('account_deactivated');

    expect((await t.http().post(`/api/users/${b.id}/reactivate`).set(bearer(aToken))).status).toBe(
      204,
    );
    await signIn(t, b.whatsappPhone!);
  });

  it('warns a super admin while fewer than two exist', async () => {
    await t.db
      .update(appUser)
      .set({ status: 'deactivated' })
      .where(eq(appUser.userType, 'super_admin'));
    const only = await makeAccount(t, { userType: 'super_admin' });
    const token = await signIn(t, only.whatsappPhone!);
    const me = await t.http().get('/api/auth/me').set(bearer(token));
    expect(me.body.warnings).toEqual(['fewer_than_two_super_admins']);
    await makeAccount(t, { userType: 'super_admin' });
    expect((await t.http().get('/api/auth/me').set(bearer(token))).body.warnings).toEqual([]);
  });
});
