import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectPgError, freshDb } from '../../test/db';
import { makeBranch, makeCategory, makeCopy, makeTitle, makeUser } from '../../test/fixtures';
import type { DbHandle } from './client';
import {
  appUser,
  borrow,
  branch,
  category,
  copy,
  copyAvailability,
  membershipPayment,
  title,
} from './schema';

let h: DbHandle;
beforeAll(async () => {
  h = await freshDb();
});
afterAll(async () => {
  await h.close();
});

describe('codes (FR-BRN-02, FR-BRN-05, NFR-10)', () => {
  it('accepts only two capital letters as a branch code, and each only once', async () => {
    await makeBranch(h.db, 'AA');
    for (const bad of ['ks', 'K', 'KSA', 'K1']) {
      const err = await expectPgError(() => makeBranch(h.db, bad));
      expect(err.constraint, bad).toBe('branch_code_format');
    }
    const dup = await expectPgError(() => makeBranch(h.db, 'AA'));
    expect(dup.constraint).toBe('branch_branch_code_unique');
  });

  it('accepts only a letter and a digit as a category code', async () => {
    await makeCategory(h.db, 'Z9');
    for (const bad of ['z9', '9Z', 'ZZ', 'Z10']) {
      const err = await expectPgError(() => makeCategory(h.db, bad));
      expect(err.constraint, bad).toBe('category_code_format');
    }
  });

  it('fixes a branch code once a copy carries it', async () => {
    const b = await makeBranch(h.db, 'BB');
    await h.db.update(branch).set({ branchCode: 'BC' }).where(eq(branch.id, b.id)); // still free
    await makeCategory(h.db, 'B1');
    const t = await makeTitle(h.db, 'B1');
    await makeCopy(h.db, { titleId: t.id, branchId: b.id, accessionNo: 'BC-B1-00001' });

    const err = await expectPgError(() =>
      h.db.update(branch).set({ branchCode: 'BD' }).where(eq(branch.id, b.id)),
    );
    expect(err.constraint).toBe('branch_code_locked');
    // Renaming the branch is always allowed (FR-BRN-03).
    await h.db.update(branch).set({ branchName: 'Renamed' }).where(eq(branch.id, b.id));
  });

  it('fixes a category code once a title uses it', async () => {
    await makeCategory(h.db, 'C1');
    await makeTitle(h.db, 'C1');
    const err = await expectPgError(() =>
      h.db.update(category).set({ code: 'C2' }).where(eq(category.code, 'C1')),
    );
    expect(err.code).toBe('23503'); // foreign key from title
  });
});

describe('copies (FR-CAT-02, FR-CAT-14)', () => {
  it('stores only the printed accession format, never 00000', async () => {
    const b = await makeBranch(h.db, 'DD');
    await makeCategory(h.db, 'D1');
    const t = await makeTitle(h.db, 'D1');
    for (const bad of ['DD-D1-1', 'DDD101234', 'dd-d1-00001', 'DD-D1-00000']) {
      const err = await expectPgError(() =>
        makeCopy(h.db, { titleId: t.id, branchId: b.id, accessionNo: bad }),
      );
      expect(err.constraint, bad).toBe('copy_accession_format');
    }
  });

  it('never changes an accession number, but lets the copy move branch', async () => {
    const b1 = await makeBranch(h.db, 'EE');
    const b2 = await makeBranch(h.db, 'EF');
    await makeCategory(h.db, 'E1');
    const t = await makeTitle(h.db, 'E1');
    const c = await makeCopy(h.db, { titleId: t.id, branchId: b1.id, accessionNo: 'EE-E1-00001' });

    const err = await expectPgError(() =>
      h.db.update(copy).set({ accessionNo: 'EE-E1-00002' }).where(eq(copy.id, c.id)),
    );
    expect(err.constraint).toBe('copy_identity_fixed');

    const [moved] = await h.db
      .update(copy)
      .set({ branchId: b2.id })
      .where(eq(copy.id, c.id))
      .returning();
    expect(moved?.accessionNo).toBe('EE-E1-00001');
    expect(moved?.accessionedBranchId).toBe(b1.id);
  });

  it('requires a reason with a withdrawal', async () => {
    const lib = await makeLibraryIn('FF');
    const err = await expectPgError(() =>
      h.db.update(copy).set({ withdrawnAt: new Date() }).where(eq(copy.id, lib.copy.id)),
    );
    expect(err.constraint).toBe('copy_withdrawn_with_reason');
  });
});

describe('loans (NFR-10)', () => {
  it('allows only one open loan per copy, and a new one after return', async () => {
    const lib = await makeLibraryIn('GG');
    const loan = {
      copyId: lib.copy.id,
      userId: lib.member.id,
      branchId: lib.branch.id,
      borrowDate: '2026-11-06',
      dueDate: '2026-11-20',
      originalDueDate: '2026-11-20',
      issuedBy: lib.admin.id,
    };
    const [first] = await h.db.insert(borrow).values(loan).returning();

    const err = await expectPgError(() => h.db.insert(borrow).values(loan));
    expect(err.constraint).toBe('borrow_one_open_loan_per_copy');

    await h.db
      .update(borrow)
      .set({ returnedOn: '2026-11-10', receivedBy: lib.admin.id })
      .where(eq(borrow.id, first!.id));
    await h.db.insert(borrow).values({
      ...loan,
      borrowDate: '2026-11-10',
      dueDate: '2026-11-24',
      originalDueDate: '2026-11-24',
    });
  });

  it('refuses impossible dates and half-recorded returns', async () => {
    const lib = await makeLibraryIn('HH');
    const base = {
      copyId: lib.copy.id,
      userId: lib.member.id,
      branchId: lib.branch.id,
      issuedBy: lib.admin.id,
      borrowDate: '2026-11-06',
      originalDueDate: '2026-11-20',
    };
    const early = await expectPgError(() =>
      h.db.insert(borrow).values({ ...base, dueDate: '2026-11-05' }),
    );
    expect(early.constraint).toBe('borrow_dates');
    const noReceiver = await expectPgError(() =>
      h.db.insert(borrow).values({ ...base, dueDate: '2026-11-20', returnedOn: '2026-11-07' }),
    );
    expect(noReceiver.constraint).toBe('borrow_received_when_returned');
  });

  it('works out availability from loans and condition (R2)', async () => {
    const lib = await makeLibraryIn('JJ');
    const state = async () =>
      (
        await h.db.select().from(copyAvailability).where(eq(copyAvailability.copyId, lib.copy.id))
      )[0]?.state;

    expect(await state()).toBe('on_shelf');
    const [loan] = await h.db
      .insert(borrow)
      .values({
        copyId: lib.copy.id,
        userId: lib.member.id,
        branchId: lib.branch.id,
        borrowDate: '2026-11-06',
        dueDate: '2026-11-20',
        originalDueDate: '2026-11-20',
        issuedBy: lib.admin.id,
      })
      .returning();
    expect(await state()).toBe('on_loan');

    await h.db
      .update(borrow)
      .set({ voidedAt: new Date(), voidedBy: lib.admin.id, voidReason: 'Entered in error' })
      .where(eq(borrow.id, loan!.id));
    expect(await state()).toBe('on_shelf');

    await h.db.update(copy).set({ condition: 'missing' }).where(eq(copy.id, lib.copy.id));
    expect(await state()).toBe('missing');
  });
});

describe('people (R9, NFR-15, FR-AUT-20)', () => {
  it('gives super admins no branch and everyone else exactly one', async () => {
    const b = await makeBranch(h.db, 'KK');
    const superErr = await expectPgError(() =>
      h.db.insert(appUser).values({
        fullName: 'Super',
        userType: 'super_admin',
        status: 'active',
        whatsappPhone: '0771111111',
        passwordHash: 'x',
        branchId: b.id,
      }),
    );
    expect(superErr.constraint).toBe('app_user_branch_by_role');
    const memberErr = await expectPgError(() =>
      makeUser(h.db, { userType: 'member', branchId: null }),
    );
    expect(memberErr.constraint).toBe('app_user_branch_by_role');
  });

  it('keeps phone numbers as text with their leading zero, unique for sign-in', async () => {
    const b = await makeBranch(h.db, 'LL');
    const values = {
      fullName: 'සුනිල්',
      userType: 'member' as const,
      status: 'active' as const,
      whatsappPhone: '0712345678',
      passwordHash: 'x',
      branchId: b.id,
    };
    const [u] = await h.db.insert(appUser).values(values).returning();
    expect(u?.whatsappPhone).toBe('0712345678');

    const dup = await expectPgError(() => h.db.insert(appUser).values(values));
    expect(dup.constraint).toBe('app_user_whatsapp_phone_unique');
    const bad = await expectPgError(() =>
      h.db.insert(appUser).values({ ...values, whatsappPhone: '071-234 5678' }),
    );
    expect(bad.constraint).toBe('app_user_phone_format');
  });

  it('frees the sign-in number only by anonymising', async () => {
    const b = await makeBranch(h.db, 'MM');
    const u = await makeUser(h.db, { branchId: b.id });
    const half = await expectPgError(() =>
      h.db.update(appUser).set({ whatsappPhone: null }).where(eq(appUser.id, u.id)),
    );
    expect(half.constraint).toBe('app_user_anonymised_has_no_phone');
    await h.db
      .update(appUser)
      .set({ status: 'anonymised', whatsappPhone: null, anonymisedAt: new Date() })
      .where(eq(appUser.id, u.id));
  });
});

describe('nothing is deleted (R12)', () => {
  it('refuses to delete records', async () => {
    const lib = await makeLibraryIn('NN');
    for (const attempt of [
      () => h.db.delete(copy).where(eq(copy.id, lib.copy.id)),
      () => h.db.delete(title).where(eq(title.id, lib.title.id)),
      () => h.db.delete(appUser).where(eq(appUser.id, lib.member.id)),
      () => h.db.delete(branch).where(eq(branch.id, lib.branch.id)),
    ]) {
      const err = await expectPgError(attempt);
      expect(err.constraint).toBe('no_delete');
    }
  });

  it('never edits a payment; a reversal is a new row', async () => {
    const lib = await makeLibraryIn('PP');
    const [fee] = await h.db
      .insert(membershipPayment)
      .values({
        userId: lib.member.id,
        kind: 'fee',
        amountCents: 50_000,
        paidOn: '2026-11-06',
        receiptNo: 'R-001',
        collectedBy: lib.admin.id,
        extendsTo: '2027-11-06',
      })
      .returning();
    const edit = await expectPgError(() =>
      h.db
        .update(membershipPayment)
        .set({ amountCents: 1 })
        .where(eq(membershipPayment.id, fee!.id)),
    );
    expect(edit.constraint).toBe('no_update');

    await h.db.insert(membershipPayment).values({
      userId: lib.member.id,
      kind: 'reversal',
      amountCents: -50_000,
      paidOn: '2026-11-07',
      collectedBy: lib.admin.id,
      reason: 'Wrong member',
      reversesPaymentId: fee!.id,
    });
    const twice = await expectPgError(() =>
      h.db.insert(membershipPayment).values({
        userId: lib.member.id,
        kind: 'reversal',
        amountCents: -50_000,
        paidOn: '2026-11-07',
        collectedBy: lib.admin.id,
        reason: 'Again',
        reversesPaymentId: fee!.id,
      }),
    );
    expect(twice.constraint).toBe('membership_payment_reversed_once');
  });

  it('keeps money exact in whole cents', async () => {
    const lib = await makeLibraryIn('QQ');
    const [p] = await h.db
      .insert(membershipPayment)
      .values({
        userId: lib.member.id,
        kind: 'fee',
        amountCents: 123_456_789_01,
        paidOn: '2026-11-06',
        receiptNo: 'R-002',
        collectedBy: lib.admin.id,
        extendsTo: '2027-11-06',
      })
      .returning();
    expect(p?.amountCents).toBe(123_456_789_01);
    const [{ type } = { type: '' }] = (
      await h.db.execute<{ type: string }>(
        sql`SELECT pg_typeof(amount_cents)::text AS type FROM membership_payment LIMIT 1`,
      )
    ).rows;
    expect(type).toBe('bigint');
  });
});

/** makeLibrary, with a branch code that is unique within this file's database. */
async function makeLibraryIn(code: string) {
  const b = await makeBranch(h.db, code);
  const catCode = `${code[0]}${(code.charCodeAt(1) % 10).toString()}`;
  const existing = await h.db.select().from(category).where(eq(category.code, catCode));
  if (existing.length === 0) await makeCategory(h.db, catCode);
  const t = await makeTitle(h.db, catCode);
  const c = await makeCopy(h.db, {
    titleId: t.id,
    branchId: b.id,
    accessionNo: `${code}-${catCode}-00001`,
  });
  const member = await makeUser(h.db, { userType: 'member', branchId: b.id });
  const admin = await makeUser(h.db, { userType: 'admin', branchId: b.id });
  return { branch: b, title: t, copy: c, member, admin };
}
