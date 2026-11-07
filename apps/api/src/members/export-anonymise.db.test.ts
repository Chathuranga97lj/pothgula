import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, makeAccount, signIn, startApp, type TestApp } from '../../test/app';
import { activityLog, appUser } from '../db/schema';
import { anonymiseUnsuccessfulApplications } from './anonymise';

let t: TestApp;
let ks: number;
let gl: number;
let boss: string;
let librarian: string;
let seq = 0;

const nextPhone = () => `0762${String(100_000 + ++seq).slice(-6)}`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function apply(over: Record<string, unknown> = {}) {
  const whatsappPhone = nextPhone();
  const res = await t
    .http()
    .post('/api/applications')
    .send({
      fullName: 'ප්‍රියංකා පෙරේරා',
      address: '12 කෝට්ටේ පාර, Kesbewa',
      whatsappPhone,
      dateOfBirth: '1988-02-29',
      organisation: 'கொழும்பு கல்லூரி',
      introducedByName: 'Sunil Perera',
      introducedByPhone: '0712223333',
      homeBranchId: ks,
      password: 'river-lamp-71',
      introducerConsent: true,
      privacyAccepted: true,
      ...over,
    });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return { id: res.body.userId as number, phone: whatsappPhone };
}

beforeAll(async () => {
  t = await startApp();
  boss = await signIn(t, (await makeAccount(t, { userType: 'super_admin' })).whatsappPhone!);
  const mk = (b: object) => t.http().post('/api/branches').set(bearer(boss)).send(b);
  ks = (await mk({ branchName: 'Kesbewa', branchCode: 'KS', address: 'x', phone: '0112000001' }))
    .body.id;
  gl = (await mk({ branchName: 'Galle', branchCode: 'GL', address: 'y', phone: '0912000002' })).body
    .id;
  librarian = await signIn(
    t,
    (await makeAccount(t, { userType: 'admin', branchId: ks })).whatsappPhone!,
  );
});
afterAll(async () => {
  await t.close();
});

describe('exporting one member (FR-AUT-19, FR-RPT-13)', () => {
  it('gives every detail as a UTF-8 text file, and logs who exported whose details', async () => {
    const { id } = await apply();
    const res = await t
      .http()
      .get(`/api/members/${id}/export?format=txt`)
      .set(bearer(librarian))
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="member-\d+-\d{4}-\d{2}-\d{2}\.txt"$/,
    );
    const text = res.text;
    for (const expected of [
      'ප්‍රියංකා පෙරේරා',
      '12 කෝට්ටේ පාර, Kesbewa',
      'கொழும்பு கல்லூரி',
      '0712223333',
      'KS — Kesbewa',
    ]) {
      expect(text).toContain(expected);
    }

    const [entry] = await t.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, 'member.export'), eq(activityLog.entityId, String(id))));
    expect(entry).toMatchObject({ actorRole: 'admin', afterData: { format: 'txt' } });
  });

  it('makes a real PDF with the Sinhala and Tamil fonts embedded', async () => {
    const { id } = await apply();
    const res = await t
      .http()
      .get(`/api/members/${id}/export?format=pdf`)
      .set(bearer(librarian))
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/NotoSansSinhala/);
    expect(raw).toMatch(/NotoSansTamil/);
  });

  it('keeps other branches out, and refuses unknown formats', async () => {
    const { id } = await apply({ homeBranchId: gl });
    expect(
      (await t.http().get(`/api/members/${id}/export?format=pdf`).set(bearer(librarian))).status,
    ).toBe(403);
    const mine = await apply();
    expect(
      (await t.http().get(`/api/members/${mine.id}/export?format=docx`).set(bearer(librarian)))
        .status,
    ).toBe(400);
  });
});

describe('anonymising unsuccessful applications (FR-AUT-20)', () => {
  it('removes personal details after 90 days, redacts the log, frees the number, and leaves members alone', async () => {
    const stale = await apply();
    const rejected = await apply();
    const fresh = await apply();
    const approved = await apply();
    await t
      .http()
      .post(`/api/applications/${rejected.id}/reject`)
      .set(bearer(librarian))
      .send({ reason: 'Not confirmed' });
    await t
      .http()
      .post(`/api/applications/${approved.id}/approve`)
      .set(bearer(librarian))
      .send({
        identityChecked: true,
        payment: { kind: 'first_fee', amountCents: 50_000, receiptNo: 'R-1' },
      });
    for (const id of [stale.id, rejected.id, approved.id]) {
      await t.db
        .update(appUser)
        .set({ appliedAt: daysAgo(100) })
        .where(eq(appUser.id, id));
    }
    await t.db
      .update(appUser)
      .set({ appliedAt: daysAgo(10) })
      .where(eq(appUser.id, fresh.id));

    const done = await anonymiseUnsuccessfulApplications(t.db, t.uow);
    expect(done.sort()).toEqual([stale.id, rejected.id].sort());

    const [gone] = await t.db.select().from(appUser).where(eq(appUser.id, stale.id));
    expect(gone).toMatchObject({
      status: 'anonymised',
      fullName: 'Removed applicant',
      whatsappPhone: null,
      address: null,
      dateOfBirth: null,
      organisation: null,
      introducedByName: null,
      introducedByPhone: null,
    });
    const [kept] = await t.db.select().from(appUser).where(eq(appUser.id, approved.id));
    expect(kept!.fullName).toBe('ප්‍රියංකා පෙරේරා');
    const [young] = await t.db.select().from(appUser).where(eq(appUser.id, fresh.id));
    expect(young!.status).toBe('pending');

    // The log keeps every entry, with the personal values replaced.
    const entries = await t.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entity, 'app_user'), eq(activityLog.entityId, String(stale.id))));
    expect(entries.some((e) => e.action === 'application.create')).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('ප්‍රියංකා');
    expect(JSON.stringify(entries)).not.toContain(stale.phone);
    expect(entries.find((e) => e.action === 'application.create')!.redactedAt).not.toBeNull();
    expect(entries.some((e) => e.action === 'application.anonymise')).toBe(true);

    // The number is free for a new application; running again changes nothing.
    await apply({ whatsappPhone: stale.phone });
    expect(await anonymiseUnsuccessfulApplications(t.db, t.uow)).toEqual([]);
  });
});
