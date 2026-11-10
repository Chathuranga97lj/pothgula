import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, type Route, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';
const branches = [{ id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null }];
const librarian = user({ id: 2, fullName: 'කමල්', userType: 'admin', branchId: 1 });

const summary = (over: Record<string, unknown> = {}) => ({
  id: 9,
  fullName: 'නිමාලි සිල්වා',
  whatsappPhone: '0771234567',
  branchId: 1,
  status: 'pending',
  state: 'pending',
  age: 36,
  area: 'Kesbewa',
  organisation: null,
  introducedByName: 'සුනිල් පෙරේරා',
  introducedByPhone: '0712223333',
  appliedAt: '2026-11-01T04:00:00.000Z',
  expireAt: null,
  stale: false,
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  ...summary(),
  address: '12 Temple Road, Kesbewa',
  otherPhone: null,
  dateOfBirth: '1990-04-12',
  rejectionReason: null,
  approvedAt: null,
  mustChangePassword: false,
  payments: [],
  ...over,
});
const branchDetail = {
  id: 1,
  code: 'KS',
  name: 'Kesbewa',
  address: 'x',
  phone: '0112000001',
  logoImageId: null,
  codeLocked: true,
  settings: {
    loanDays: 14,
    maxBooks: 2,
    maxBooksWhileSettling: 1,
    settlementWindowDays: 100,
    staffDueWarningDays: 5,
    memberDueWarningDays: 5,
    declineGraceDays: 3,
    holdDays: 7,
    applicationStaleDays: 30,
    applicationAnonymiseDays: 90,
    renewalGraceDays: 90,
    frequentLateCount: 3,
    frequentLateMonths: 12,
    annualFeeCents: 50_000,
    logRetentionMonths: 24,
    transitAlertDays: 7,
  },
};

function asStaff(extra: Record<string, Route> = {}) {
  localStorage.setItem(TOKEN_KEY, 'tok');
  return fakeApi({
    'GET /auth/me': { body: { user: librarian, warnings: [] } },
    'GET /library': { body: { name: 'Library', logoImageId: null } },
    'GET /branches': { body: branches },
    'GET /branches/1': { body: branchDetail },
    'GET /members/9/loans': {
      body: {
        standing: {
          openLoans: 0,
          maxBooks: 2,
          overdueLoans: 0,
          lateReturns: 0,
          lateReturnMonths: 12,
          frequentlyLate: false,
        },
        loans: [],
      },
    },
    ...extra,
  });
}

describe('applying (FR-AUT-03, FR-AUT-16)', () => {
  it('sends the application, then signs the applicant in to wait', async () => {
    const me = user({ id: 9, userType: 'member', status: 'pending', branchId: 1 });
    const api = fakeApi({
      'GET /library': { body: { name: 'Library', logoImageId: null } },
      'GET /branches': { body: branches },
      'POST /applications': { status: 201, body: { userId: 9 } },
      'POST /auth/sign-in': () => ({ body: { token: 'tok', user: me } }),
      'GET /auth/me': () => ({ body: { user: me, warnings: [] } }),
      'GET /me/dashboard': {
        body: {
          today: '2026-11-09',
          items: [
            {
              kind: 'application_waiting',
              tone: 'info',
              branchName: 'Kesbewa',
              feeCents: 50_000,
            },
          ],
        },
      },
    });
    renderApp('/sign-in');
    await userEvent.click(await screen.findByRole('link', { name: 'Apply for membership' }));
    expect(
      await screen.findByRole('heading', { name: 'Apply for membership' }),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Full name'), 'නිමාලි සිල්වා');
    await userEvent.type(screen.getByLabelText('Date of birth'), '1990-04-12');
    await userEvent.type(screen.getByLabelText('Address'), '12 Temple Road, Kesbewa');
    await userEvent.type(screen.getByLabelText('WhatsApp number'), '077 123 4567');
    await userEvent.selectOptions(screen.getByLabelText('Home branch'), '1');
    await userEvent.type(screen.getByLabelText('Introduced by'), 'සුනිල් පෙරේරා');
    await userEvent.type(screen.getByLabelText("Introducer's phone"), '+94 71 222 3333');
    await userEvent.type(screen.getByLabelText('Choose a password'), 'river-lamp-71');
    await userEvent.type(screen.getByLabelText('New password again'), 'river-lamp-71');

    const send = screen.getByRole('button', { name: 'Send application' });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/has agreed to be named/));
    await userEvent.click(screen.getByLabelText('I have read this and agree.'));
    await userEvent.click(send);

    expect(await screen.findByText('Your application is waiting for approval')).toBeInTheDocument();
    expect(screen.getByText(/Visit the Kesbewa branch .* Rs 500.00/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.route === 'POST /applications')?.body).toMatchObject({
      whatsappPhone: '0771234567',
      introducedByPhone: '0712223333',
      homeBranchId: 1,
      otherPhone: null,
      introducerConsent: true,
      privacyAccepted: true,
    });
  });
});

describe('approval at the counter (FR-AUT-17, FR-MEM-10, R18)', () => {
  it('needs the identity tick, fills in the branch fee, and approves', async () => {
    const api = asStaff({
      'GET /applications?status=pending': { body: [summary()] },
      'GET /members/9': { body: detail() },
      'POST /applications/9/approve': {
        body: detail({ status: 'active', state: 'active', expireAt: '2027-11-07' }),
      },
    });
    renderApp('/members');
    expect(await screen.findByRole('tab', { name: 'Waiting (1)' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('link', { name: 'නිමාලි සිල්වා' }));

    const approve = await screen.findByRole('button', { name: 'Approve and start membership' });
    expect(approve).toBeDisabled();
    expect(screen.queryByLabelText(/Waive the first fee/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('First year’s fee (Rs)')).toHaveValue('500.00'),
    );
    await userEvent.click(screen.getByLabelText(/I have checked an identity document/));
    await userEvent.type(screen.getByLabelText('Receipt number'), 'KS-0007');
    await userEvent.click(approve);

    expect(
      await screen.findByText('Approved. The membership runs until 2027-11-07.'),
    ).toBeInTheDocument();
    expect(api.calls.find((c) => c.route === 'POST /applications/9/approve')?.body).toEqual({
      identityChecked: true,
      payment: { kind: 'first_fee', amountCents: 50_000, receiptNo: 'KS-0007' },
    });
  });

  it('asks for a reason before not approving', async () => {
    let record = detail();
    const api = asStaff({
      'GET /members/9': () => ({ body: record }),
      'POST /applications/9/reject': () => {
        record = detail({
          status: 'rejected',
          state: 'rejected',
          rejectionReason: 'Address not confirmed',
        });
        return { body: record };
      },
    });
    renderApp('/members/9');
    await userEvent.click(await screen.findByRole('button', { name: 'Not approve…' }));
    await userEvent.type(
      screen.getByLabelText('Why is this application not approved?'),
      'Address not confirmed',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Do not approve' }));
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(api.calls.find((c) => c.route === 'POST /applications/9/reject')?.body).toEqual({
      reason: 'Address not confirmed',
    });
  });
});

describe('a member’s record (FR-MEM-02, FR-AUT-19)', () => {
  const active = detail({
    status: 'active',
    state: 'expired',
    expireAt: '2026-10-01',
    payments: [
      {
        id: 1,
        kind: 'first_fee',
        amountCents: 50_000,
        paidOn: '2025-10-01',
        receiptNo: 'R-1',
        reason: null,
        extendsTo: '2026-10-01',
        collectedBy: 2,
        reversesPaymentId: null,
      },
    ],
  });

  it('records a renewal with the branch fee', async () => {
    const api = asStaff({
      'GET /members/9': { body: active },
      'POST /members/9/renew': { body: { ...active, state: 'active', expireAt: '2027-10-01' } },
    });
    renderApp('/members/9');
    expect(await screen.findByText(/^First fee ·/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Annual fee (Rs)')).toHaveValue('500.00'));
    await userEvent.type(screen.getByLabelText('Receipt number'), 'R-2');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(
      await screen.findByText('Payment recorded. The membership now runs until 2027-10-01.'),
    ).toBeInTheDocument();
    expect(api.calls.find((c) => c.route === 'POST /members/9/renew')?.body).toEqual({
      amountCents: 50_000,
      receiptNo: 'R-2',
    });
  });

  it('lets a super admin reverse a renewal taken by mistake (FR-MEM-05)', async () => {
    const renewed = {
      ...active,
      state: 'active',
      expireAt: '2027-10-01',
      payments: [
        ...active.payments,
        {
          id: 2,
          kind: 'fee',
          amountCents: 50_000,
          paidOn: '2026-11-10',
          receiptNo: 'R-2',
          reason: null,
          extendsTo: '2027-10-01',
          collectedBy: 2,
          reversesPaymentId: null,
        },
      ],
    };
    const reversedRecord = {
      ...renewed,
      expireAt: '2026-10-01',
      payments: [
        ...renewed.payments,
        {
          id: 3,
          kind: 'reversal',
          amountCents: -50_000,
          paidOn: '2026-11-10',
          receiptNo: null,
          reason: 'Wrong member',
          extendsTo: '2026-10-01',
          collectedBy: 1,
          reversesPaymentId: 2,
        },
      ],
    };
    let current: object = renewed;
    const api = asStaff({
      'GET /auth/me': {
        body: { user: user({ id: 1, userType: 'super_admin', branchId: null }), warnings: [] },
      },
      // The record as it stands: the page reads it again after the reversal.
      'GET /members/9': () => ({ body: current }),
      'POST /members/9/payments/2/reverse': () => {
        current = reversedRecord;
        return { body: current };
      },
    });
    renderApp('/members/9');
    // Only the renewal can be reversed, not the first fee.
    const buttons = await screen.findAllByRole('button', { name: 'Reverse' });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    await userEvent.type(screen.getByLabelText('Why it is reversed'), 'Wrong member');
    await userEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.route === 'POST /members/9/payments/2/reverse')?.body).toEqual(
        {
          reason: 'Wrong member',
        },
      ),
    );
    expect(await screen.findByText('Wrong member')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
  });

  it('downloads an export with the session token', async () => {
    asStaff({ 'GET /members/9': { body: active } });
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const created = vi.fn(() => 'blob:x');
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }),
    );
    renderApp('/members/9');
    await screen.findByText(/^First fee ·/);
    fetchSpy.mockImplementationOnce(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('/api/members/9/export?format=txt');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
      return new Response('MEMBER DETAILS', {
        headers: { 'content-disposition': 'attachment; filename="member-9.txt"' },
      });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Export text' }));
    await waitFor(() => expect(created).toHaveBeenCalled());
  });
});

describe('my membership (FR-MEM-09, FR-AUT-21)', () => {
  it('lets a member change their address, and only that kind of detail', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    const member = user({ id: 9, userType: 'member', status: 'active', branchId: 1 });
    const mine = detail({ status: 'active', state: 'active', expireAt: '2027-11-07' });
    const api = fakeApi({
      'GET /auth/me': { body: { user: member, warnings: [] } },
      'GET /library': { body: { name: 'Library', logoImageId: null } },
      'GET /branches': { body: branches },
      'GET /me/membership': { body: mine },
      'GET /me/loans': {
        body: {
          standing: {
            openLoans: 0,
            maxBooks: 2,
            overdueLoans: 0,
            lateReturns: 0,
            lateReturnMonths: 12,
            frequentlyLate: false,
          },
          loans: [],
        },
      },
      'PATCH /me/profile': (body) => ({ body: { ...mine, ...(body as object) } }),
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('link', { name: 'My membership' }));
    expect(await screen.findByText('Your membership runs until 2027-11-07.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();

    const address = screen.getByLabelText('Address');
    await userEvent.clear(address);
    await userEvent.type(address, '7 Lake Road, Piliyandala');
    const form = address.closest('form')!;
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(api.calls.find((c) => c.route === 'PATCH /me/profile')?.body).toMatchObject({
      address: '7 Lake Road, Piliyandala',
    });
  });
});
