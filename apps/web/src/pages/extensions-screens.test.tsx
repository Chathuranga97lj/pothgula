import { addDays, todayColombo } from '@pothgula/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeApi, type Route, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';
const today = todayColombo();
const branches = [{ id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null }];
const librarian = user({ id: 2, fullName: 'කමල්', userType: 'admin', branchId: 1 });
const memberUser = user({ id: 9, fullName: 'නිමාලි සිල්වා', userType: 'member', branchId: 1 });

const member = {
  id: 9,
  fullName: 'නිමාලි සිල්වා',
  whatsappPhone: '0771234567',
  branchId: 1,
  status: 'active',
  state: 'active',
  age: 36,
  area: 'Kesbewa',
  organisation: null,
  introducedByName: 'සුනිල් පෙරේරා',
  introducedByPhone: '0712223333',
  appliedAt: '2026-01-01T04:00:00.000Z',
  expireAt: addDays(today, 200),
  stale: false,
  address: '12 Temple Road, Kesbewa',
  otherPhone: null,
  dateOfBirth: '1990-04-12',
  rejectionReason: null,
  approvedAt: '2026-01-01T04:00:00.000Z',
  mustChangePassword: false,
  payments: [],
};
const loan = (over: Record<string, unknown> = {}) => ({
  id: 31,
  copyId: 11,
  accessionNo: 'KS-A1-00007',
  titleId: 5,
  title: 'මඩොල් දූව',
  writer: null,
  memberId: 9,
  memberName: 'නිමාලි සිල්වා',
  memberPhone: '0771234567',
  branchId: 1,
  borrowDate: addDays(today, -3),
  dueDate: addDays(today, 11),
  originalDueDate: addDays(today, 11),
  returnedOn: null,
  status: 'open',
  overdue: false,
  daysLate: 0,
  isBackdated: false,
  returnBackdated: false,
  voidedAt: null,
  voidReason: null,
  extensionStatus: 'none',
  extensionRequestedAt: null,
  extensionDecidedAt: null,
  extensionReason: null,
  settlementId: null,
  ...over,
});
const asked = (over: Record<string, unknown> = {}) =>
  loan({ extensionStatus: 'requested', extensionRequestedAt: `${today}T03:00:00.000Z`, ...over });
const standing = {
  openLoans: 1,
  maxBooks: 2,
  overdueLoans: 0,
  lateReturns: 0,
  lateReturnMonths: 12,
  frequentlyLate: false,
};

function signedIn(me: object, extra: Record<string, Route> = {}) {
  localStorage.setItem(TOKEN_KEY, 'tok');
  return fakeApi({
    'GET /auth/me': { body: { user: me, warnings: [] } },
    'GET /library': { body: { name: 'Library', logoImageId: null } },
    'GET /branches': { body: branches },
    ...extra,
  });
}

describe('a member asks for more time (FR-CIR-10, FR-CIR-12)', () => {
  it('asks from their own list, then sees the request waiting and can withdraw it', async () => {
    let current = loan();
    const { calls } = signedIn(memberUser, {
      'GET /me/membership': { body: member },
      'GET /me/loans': () => ({ body: { standing, loans: [current] } }),
      'POST /me/loans/31/extension': () => {
        current = asked();
        return { body: current };
      },
      'POST /me/loans/31/extension/cancel': () => {
        current = loan();
        return { body: current };
      },
    });
    renderApp('/my-membership');
    await userEvent.click(await screen.findByRole('button', { name: 'Ask for more time' }));
    expect(await screen.findByText('extension asked for')).toBeInTheDocument();
    expect(calls.map((c) => c.route)).toContain('POST /me/loans/31/extension');

    await userEvent.click(screen.getByRole('button', { name: 'Withdraw the request' }));
    expect(await screen.findByRole('button', { name: 'Ask for more time' })).toBeInTheDocument();
  });

  it('is not offered on an overdue book, and shows why a request was declined', async () => {
    signedIn(memberUser, {
      'GET /me/membership': { body: member },
      'GET /me/loans': {
        body: {
          standing: { ...standing, openLoans: 2, overdueLoans: 1 },
          loans: [
            loan({ overdue: true, daysLate: 2, dueDate: addDays(today, -2) }),
            loan({
              id: 32,
              extensionStatus: 'declined',
              extensionDecidedAt: `${today}T03:00:00.000Z`,
              extensionReason: 'Reserved for the school.',
            }),
          ],
        },
      },
    });
    renderApp('/my-membership');
    expect(await screen.findByText('Not extended: Reserved for the school.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask for more time' })).not.toBeInTheDocument();
  });

  it("shows the decision on the member's panel", async () => {
    signedIn(memberUser, {
      'GET /me/dashboard': {
        body: {
          today,
          items: [
            {
              kind: 'extension_declined',
              tone: 'warning',
              loanId: 32,
              title: 'ගම්පෙරළිය',
              accessionNo: 'KS-A1-00008',
              dueDate: addDays(today, 3),
              reason: 'Reserved for the school.',
            },
            {
              kind: 'extension_approved',
              tone: 'info',
              loanId: 31,
              title: 'මඩොල් දූව',
              accessionNo: 'KS-A1-00007',
              dueDate: addDays(today, 20),
              originalDueDate: addDays(today, 6),
            },
          ],
        },
      },
    });
    renderApp('/');
    expect(await screen.findByText('No extension for ගම්පෙරළිය')).toBeInTheDocument();
    expect(
      screen.getByText(`Reserved for the school. Please bring it back by ${addDays(today, 3)}.`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `It is now due back on ${addDays(today, 20)} (it was ${addDays(today, 6)}).`,
      ),
    ).toBeInTheDocument();
  });
});

describe('staff decide (FR-CIR-10 to FR-CIR-13)', () => {
  it('lists the requests waiting, marks the urgent ones, and approves', async () => {
    const { calls } = signedIn(librarian, {
      'GET /extensions': {
        body: [
          asked({ dueDate: addDays(today, 1), originalDueDate: addDays(today, 1) }),
          asked({ id: 33, title: 'ගම්පෙරළිය' }),
        ],
      },
      'POST /loans/31/extension/approve': {
        body: loan({ extensionStatus: 'approved', dueDate: addDays(today, 15) }),
      },
    });
    renderApp('/extensions');
    const cards = await screen.findAllByRole('listitem');
    expect(within(cards[0]!).getByText('Urgent')).toBeInTheDocument();
    expect(within(cards[1]!).queryByText('Urgent')).not.toBeInTheDocument();

    await userEvent.click(within(cards[0]!).getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText(`මඩොල් දූව extended: now due ${addDays(today, 15)}.`),
    ).toBeInTheDocument();
    expect(calls.map((c) => c.route)).toContain('POST /loans/31/extension/approve');
  });

  it('declines only with a reason, and sends it', async () => {
    const { calls } = signedIn(librarian, {
      'GET /extensions': { body: [asked()] },
      'POST /loans/31/extension/decline': {
        body: loan({ extensionStatus: 'declined', extensionReason: 'Needed for a class.' }),
      },
    });
    renderApp('/extensions');
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    const confirm = screen.getByRole('button', { name: 'Decline the request' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason for declining'), 'Needed for a class.');
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.route === 'POST /loans/31/extension/decline')?.body).toEqual({
        reason: 'Needed for a class.',
      }),
    );
  });

  it('explains a refusal in words', async () => {
    signedIn(librarian, {
      'GET /extensions': { body: [asked()] },
      'POST /loans/31/extension/approve': {
        status: 422,
        body: { code: 'other_book_overdue', message: 'x', details: { refusals: [] } },
      },
    });
    renderApp('/extensions');
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText('Another book on this card is overdue; it must come back first.'),
    ).toBeInTheDocument();
  });

  it('grants one directly on the loan record (FR-CIR-11)', async () => {
    const { calls } = signedIn(librarian, {
      'GET /loans/31': { body: loan() },
      'POST /loans/31/extension': {
        body: loan({
          extensionStatus: 'approved',
          dueDate: addDays(today, 25),
          extensionDecidedAt: `${today}T03:00:00.000Z`,
        }),
      },
    });
    renderApp('/loans/31');
    await userEvent.click(await screen.findByRole('button', { name: 'Grant one extension' }));
    expect(await screen.findByText('Extended.')).toBeInTheDocument();
    expect(calls.map((c) => c.route)).toContain('POST /loans/31/extension');
  });

  it('shows a waiting request on the loan record, with the decision buttons', async () => {
    signedIn(librarian, { 'GET /loans/31': { body: asked() } });
    renderApp('/loans/31');
    expect(
      await screen.findByText(`The member asked on ${today}; it is waiting for a decision.`),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grant one extension' })).not.toBeInTheDocument();
  });

  it('puts waiting requests on the staff panel, with the way to them', async () => {
    const counts = {
      suspended: 0,
      overdue: 0,
      overdueMembers: 0,
      transit_overdue: 0,
      extensions_urgent: 1,
      due_today: 0,
      applications_waiting: 0,
      extensions_waiting: 2,
      requests_to_decide: 0,
      requests_to_send: 0,
      holds_lapsing: 0,
      requests_arriving: 0,
      copies_elsewhere: 0,
      due_soon: 0,
      returned_late_today: 0,
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
              counts,
              items: [
                { kind: 'extensions_urgent', tone: 'urgent', count: 1 },
                { kind: 'extensions_waiting', tone: 'warning', count: 2 },
              ],
            },
          ],
        },
      },
    });
    renderApp('/');
    expect(
      await screen.findByRole('link', { name: /1 extension request due within two days/ }),
    ).toHaveAttribute('href', '/extensions');
    expect(screen.getByRole('link', { name: /2 extension requests waiting/ })).toBeInTheDocument();
  });
});
