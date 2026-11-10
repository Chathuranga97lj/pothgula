import { addDays, todayColombo } from '@pothgula/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, type Route, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';
const today = todayColombo();
const branches = [
  { id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null },
  { id: 2, code: 'GL', name: 'Galle', logoImageId: null },
];
const categories = [{ code: 'A1', name: 'Sinhala novels', isActive: true, inUse: true }];
const librarian = user({ id: 2, fullName: 'කමල්', userType: 'admin', branchId: 1 });
const galleLibrarian = user({ id: 3, fullName: 'Ruwan', userType: 'admin', branchId: 2 });
const superAdmin = user({ id: 1, userType: 'super_admin', branchId: null });
const memberUser = user({ id: 9, fullName: 'නිමාලි සිල්වා', userType: 'member', branchId: 1 });

const copyRow = (over: Record<string, unknown> = {}) => ({
  id: 11,
  accessionNo: 'GL-A1-00001',
  branchId: 2,
  accessionedBranchId: 2,
  condition: 'useable',
  state: 'on_shelf',
  withdrawnAt: null,
  withdrawnReason: null,
  priceCents: null,
  source: null,
  legacyNo: null,
  ...over,
});
const title = (copies: object[]) => ({
  id: 5,
  title: 'මඩොල් දූව',
  writer: null,
  publisher: null,
  isbn: null,
  edition: null,
  categoryCode: 'A1',
  categoryName: 'Sinhala novels',
  holdings: [],
  mergedIntoId: null,
  copies,
});
const request = (over: Record<string, unknown> = {}) => ({
  id: 40,
  status: 'requested',
  titleId: 5,
  title: 'මඩොල් දූව',
  writer: null,
  copyId: null,
  accessionNo: null,
  memberId: 9,
  memberName: 'නිමාලි සිල්වා',
  memberPhone: '0771234567',
  from: { id: 2, code: 'GL', name: 'Galle' },
  to: { id: 1, code: 'KS', name: 'Kesbewa' },
  requestedAt: `${today}T03:00:00.000Z`,
  decidedAt: null,
  declineReason: null,
  dispatchedAt: null,
  arrivedAt: null,
  holdUntil: null,
  borrowId: null,
  returnDispatchedAt: null,
  returnArrivedAt: null,
  daysInTransit: null,
  transitOverdue: false,
  lostReason: null,
  ...over,
});
const member = {
  id: 9,
  fullName: 'නිමාලි සිල්වා',
  whatsappPhone: '0771234567',
  branchId: 1,
  status: 'active',
  state: 'active',
  age: 36,
  area: 'Kesbewa',
  organisation: 'Kesbewa MV',
  introducedByName: 'සුනිල් පෙරේරා',
  introducedByPhone: '0712223333',
  appliedAt: '2026-01-01T04:00:00.000Z',
  expireAt: addDays(today, 200),
  stale: false,
  address: '12 Temple Road, Kesbewa',
  otherPhone: '0112345678',
  dateOfBirth: '1990-04-12',
  rejectionReason: null,
  approvedAt: '2026-01-01T04:00:00.000Z',
  mustChangePassword: false,
  payments: [],
};
const detail = (over: Record<string, unknown> = {}) => ({
  ...request(over),
  member,
  memberLoans: [],
  lateReturns: 1,
  lateReturnMonths: 12,
});
const branchBoard = (over: Record<string, unknown> = {}) => ({
  branchId: 2,
  branchCode: 'GL',
  branchName: 'Galle',
  toDecide: [],
  toSend: [],
  arriving: [],
  held: [],
  ourMembers: [],
  outElsewhere: [],
  transitOverdue: [],
  ...over,
});

function signedIn(me: object, extra: Record<string, Route> = {}) {
  localStorage.setItem(TOKEN_KEY, 'tok');
  return fakeApi({
    'GET /auth/me': { body: { user: me, warnings: [] } },
    'GET /library': { body: { name: 'Library', logoImageId: null } },
    'GET /branches': { body: branches },
    'GET /categories': { body: categories },
    ...extra,
  });
}

describe('a member asks another branch (FR-REQ-01, FR-REQ-11)', () => {
  it('offers the branches with a copy on the shelf, not their own, and asks', async () => {
    const { calls } = signedIn(memberUser, {
      'GET /titles/5': {
        body: title([
          copyRow(),
          copyRow({ id: 12, accessionNo: 'KS-A1-00001', branchId: 1 }),
          copyRow({ id: 13, accessionNo: 'GL-A1-00002', state: 'on_loan' }),
        ]),
      },
      'POST /me/requests': { status: 201, body: request() },
    });
    renderApp('/titles/5');
    await userEvent.click(await screen.findByRole('button', { name: 'Ask Galle for it' }));
    expect(
      await screen.findByText(/Asked Galle\. You will see on your dashboard/),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.route === 'POST /me/requests')?.body).toEqual({
      titleId: 5,
      fromBranchId: 2,
    });
    expect(screen.queryByRole('button', { name: 'Ask Kesbewa for it' })).not.toBeInTheDocument();
  });

  it('says why a request is refused', async () => {
    signedIn(memberUser, {
      'GET /titles/5': { body: title([copyRow()]) },
      'POST /me/requests': {
        status: 422,
        body: { code: 'request_open', message: 'x', details: { refusals: [] } },
      },
    });
    renderApp('/titles/5');
    await userEvent.click(await screen.findByRole('button', { name: 'Ask Galle for it' }));
    expect(
      await screen.findByText('There is already a request open; one at a time.'),
    ).toBeInTheDocument();
  });

  it('lists the member’s requests, with a way to withdraw one not yet accepted', async () => {
    const { calls } = signedIn(memberUser, {
      'GET /me/membership': { body: member },
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
      'GET /me/requests': {
        body: [
          request(),
          request({ id: 39, status: 'held', holdUntil: addDays(today, 5), copyId: 11 }),
        ],
      },
      'POST /me/requests/40/cancel': { body: request({ status: 'cancelled' }) },
    });
    renderApp('/my-membership');
    expect(await screen.findByText('Books asked from other branches')).toBeInTheDocument();
    expect(screen.getByText(`Collect at Kesbewa by ${addDays(today, 5)}.`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(calls.map((c) => c.route)).toContain('POST /me/requests/40/cancel'));
  });

  it('tells the member on their panel when it is ready, on its way or declined', async () => {
    signedIn(memberUser, {
      'GET /me/dashboard': {
        body: {
          today,
          items: [
            {
              kind: 'request_ready',
              tone: 'warning',
              requestId: 39,
              title: 'මඩොල් දූව',
              branchName: 'Kesbewa',
              holdUntil: addDays(today, 5),
            },
            {
              kind: 'request_declined',
              tone: 'warning',
              requestId: 38,
              title: 'ගම්පෙරළිය',
              branchName: 'Galle',
              reason: 'Kept for the exam.',
            },
            {
              kind: 'request_on_way',
              tone: 'info',
              requestId: 40,
              title: 'කලියුගය',
              branchName: 'Galle',
              dispatched: true,
            },
          ],
        },
      },
    });
    renderApp('/');
    expect(await screen.findByText('මඩොල් දූව is ready for you')).toBeInTheDocument();
    expect(screen.getByText('No copy of ගම්පෙරළිය from Galle')).toBeInTheDocument();
    expect(screen.getByText('Kept for the exam.')).toBeInTheDocument();
    expect(
      screen.getByText('Galle has sent it; you will be told when it arrives.'),
    ).toBeInTheDocument();
  });
});

describe('staff move the books (FR-REQ-03 to FR-REQ-09, FR-REQ-13)', () => {
  it('shows the member in full to the branch asked, and accepts with a chosen copy', async () => {
    const { calls } = signedIn(galleLibrarian, {
      'GET /requests/40': { body: detail() },
      'GET /titles/5': {
        body: title([copyRow(), copyRow({ id: 13, accessionNo: 'GL-A1-00002', state: 'on_loan' })]),
      },
      'POST /requests/40/accept': {
        body: request({ status: 'accepted', copyId: 11, accessionNo: 'GL-A1-00001' }),
      },
    });
    renderApp('/requests/40');
    expect(await screen.findByText('12 Temple Road, Kesbewa')).toBeInTheDocument();
    expect(screen.getByText('සුනිල් පෙරේරා · 0712223333')).toBeInTheDocument();
    expect(screen.getByText('1990-04-12 (age 36)')).toBeInTheDocument();
    expect(screen.getByText('1 in the last 12 months')).toBeInTheDocument();

    const pick = screen.getByLabelText('Copy to send');
    await waitFor(() => expect(within(pick).getAllByRole('option')).toHaveLength(2));
    await userEvent.selectOptions(pick, '11');
    await userEvent.click(screen.getByRole('button', { name: 'Accept and set it aside' }));
    expect(await screen.findByText('මඩොල් දූව set aside.')).toBeInTheDocument();
    expect(calls.find((c) => c.route === 'POST /requests/40/accept')?.body).toEqual({
      copyId: 11,
    });
  });

  it('declines only with a reason', async () => {
    const { calls } = signedIn(galleLibrarian, {
      'GET /requests/40': { body: detail() },
      'GET /titles/5': { body: title([copyRow()]) },
      'POST /requests/40/decline': { body: request({ status: 'declined' }) },
    });
    renderApp('/requests/40');
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    const confirm = screen.getByRole('button', { name: 'Decline the request' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason for declining'), 'Kept for the exam.');
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.route === 'POST /requests/40/decline')?.body).toEqual({
        reason: 'Kept for the exam.',
      }),
    );
  });

  it('sends the ticked books together and downloads the transit slip', async () => {
    const createObjectURL = vi.fn(() => 'blob:slip');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const out = request({ status: 'accepted', copyId: 11, accessionNo: 'GL-A1-00001' });
    const home = request({
      id: 41,
      status: 'returning',
      copyId: 12,
      accessionNo: 'GL-A1-00003',
      from: { id: 2, code: 'GL', name: 'Galle' },
    });
    const { calls } = signedIn(galleLibrarian, {
      'GET /requests': { body: { today, branches: [branchBoard({ toSend: [out, home] })] } },
      'POST /requests/dispatch': {
        body: [{ ...out, status: 'in_transit' }],
      },
      'GET /requests/slip?ids=40': { body: {} },
    });
    renderApp('/requests');
    const send = await screen.findByRole('button', { name: 'Send 0 books and print the slip' });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getAllByRole('checkbox', { name: 'Send මඩොල් දූව' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Send 1 book and print the slip' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(calls.find((c) => c.route === 'POST /requests/dispatch')?.body).toEqual({
      requestIds: [40],
    });
    expect(
      await screen.findByText('1 book sent. The transit slip is downloading.'),
    ).toBeInTheDocument();
  });

  it('records an arrival, and flags a book on the road too long', async () => {
    const coming = request({
      status: 'in_transit',
      copyId: 11,
      accessionNo: 'GL-A1-00001',
      daysInTransit: 9,
      transitOverdue: true,
    });
    const { calls } = signedIn(librarian, {
      'GET /requests': {
        body: {
          today,
          branches: [
            branchBoard({
              branchId: 1,
              branchCode: 'KS',
              branchName: 'Kesbewa',
              arriving: [coming],
              transitOverdue: [coming],
            }),
          ],
        },
      },
      'POST /requests/40/arrive': { body: { ...coming, status: 'held' } },
    });
    renderApp('/requests');
    expect(await screen.findByText('1 book on the road too long')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Record arrival' }));
    await waitFor(() => expect(calls.map((c) => c.route)).toContain('POST /requests/40/arrive'));
  });

  it('lets only a super admin write off a book lost on the way (FR-REQ-14)', async () => {
    const onRoad = detail({ status: 'in_transit', copyId: 11, accessionNo: 'GL-A1-00001' });
    signedIn(superAdmin, {
      'GET /requests/40': { body: onRoad },
      'GET /titles/5': { body: title([]) },
    });
    renderApp('/requests/40');
    // Nothing to write off until the reason is given.
    expect(await screen.findByRole('button', { name: 'Mark lost on the way' })).toBeDisabled();
  });

  it('does not offer the write-off to a librarian', async () => {
    signedIn(librarian, {
      'GET /requests/40': {
        body: detail({ status: 'in_transit', copyId: 11, accessionNo: 'GL-A1-00001' }),
      },
      'GET /titles/5': { body: title([]) },
    });
    renderApp('/requests/40');
    expect(await screen.findByRole('button', { name: 'Record arrival' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark lost on the way' })).not.toBeInTheDocument();
  });

  it('puts the steps on the staff panel, with the way to them', async () => {
    const zero = {
      suspended: 0,
      overdue: 0,
      overdueMembers: 0,
      transit_overdue: 0,
      extensions_urgent: 0,
      due_today: 0,
      applications_waiting: 0,
      extensions_waiting: 0,
      requests_to_decide: 2,
      requests_to_send: 0,
      holds_lapsing: 0,
      requests_arriving: 0,
      copies_elsewhere: 0,
      due_soon: 0,
      returned_late_today: 0,
      lost_in_transit: 0,
      settlements_passed: 0,
      settlements_closing: 0,
      settlements_open: 0,
      expiring_this_month: 0,
    };
    signedIn(librarian, {
      'GET /dashboard': {
        body: {
          today,
          monthEnd: today,
          branches: [
            {
              branchId: 1,
              branchCode: 'KS',
              branchName: 'Kesbewa',
              warningDays: 5,
              counts: zero,
              items: [{ kind: 'requests_to_decide', tone: 'warning', count: 2 }],
            },
          ],
        },
      },
    });
    renderApp('/');
    expect(
      await screen.findByRole('link', { name: /2 requests from other branches to decide/ }),
    ).toHaveAttribute('href', '/requests');
  });
});
