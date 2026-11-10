import { addDays, todayColombo } from '@pothgula/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, type Route, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';
const today = todayColombo();
const branches = [
  { id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null },
  { id: 2, code: 'GL', name: 'Galle', logoImageId: null },
];
const librarian = user({ id: 2, fullName: 'කමල්', userType: 'admin', branchId: 1 });
const superAdmin = user({ id: 1, fullName: 'සුනිලා', userType: 'super_admin', branchId: null });
const memberUser = user({ id: 9, fullName: 'නිමාලි සිල්වා', userType: 'member', branchId: 1 });

const counts = (over: Record<string, number> = {}) => ({
  suspended: 0,
  overdue: 0,
  overdueMembers: 0,
  transit_overdue: 0,
  extensions_urgent: 0,
  due_today: 0,
  applications_waiting: 0,
  extensions_waiting: 0,
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
  ...over,
});
const TONES: Record<string, string> = {
  suspended: 'urgent',
  overdue: 'urgent',
  extensions_urgent: 'urgent',
  due_today: 'warning',
  applications_waiting: 'warning',
  extensions_waiting: 'warning',
  due_soon: 'info',
  returned_late_today: 'info',
  expiring_this_month: 'info',
};
const branchToday = (id: number, code: string, name: string, c: ReturnType<typeof counts>) => ({
  branchId: id,
  branchCode: code,
  branchName: name,
  warningDays: 5,
  counts: c,
  items: Object.keys(TONES)
    .filter((k) => (c as Record<string, number>)[k]! > 0)
    .map((kind) => ({ kind, tone: TONES[kind], count: (c as Record<string, number>)[kind] })),
});

const dueLoan = (over: Record<string, unknown> = {}) => ({
  id: 31,
  copyId: 11,
  accessionNo: 'KS-A1-00007',
  titleId: 5,
  title: 'මඩොල් දූව',
  writer: null,
  memberId: 9,
  memberName: 'නිමාලි සිල්වා',
  memberPhone: '0771234567',
  memberOtherPhone: null,
  memberBranchCode: 'KS',
  copyBranchCode: 'KS',
  branchId: 1,
  borrowDate: addDays(today, -10),
  dueDate: addDays(today, 4),
  originalDueDate: addDays(today, 4),
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
const overdueLoan = (id: number, memberId: number, name: string, daysLate: number) =>
  dueLoan({
    id,
    memberId,
    memberName: name,
    accessionNo: `KS-A1-0000${id}`,
    dueDate: addDays(today, -daysLate),
    originalDueDate: addDays(today, -daysLate),
    overdue: true,
    daysLate,
  });

function signedIn(me: object, extra: Record<string, Route> = {}) {
  localStorage.setItem(TOKEN_KEY, 'tok');
  return fakeApi({
    'GET /auth/me': { body: { user: me, warnings: [] } },
    'GET /library': { body: { name: 'Library', logoImageId: null } },
    'GET /branches': { body: branches },
    ...extra,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("staff: today's work (FR-NOT-03, FR-NOT-07, FR-NOT-09)", () => {
  it('opens on what needs attention at the branch, most urgent first, with a count', async () => {
    signedIn(librarian, {
      'GET /dashboard': {
        body: {
          today,
          monthEnd: today,
          branches: [
            branchToday(
              1,
              'KS',
              'Kesbewa',
              counts({
                overdue: 3,
                overdueMembers: 2,
                due_today: 1,
                due_soon: 4,
                applications_waiting: 2,
              }),
            ),
          ],
        },
      },
    });
    renderApp('/');

    const panel = await screen.findByTestId('panel-KS');
    expect(
      within(panel)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual([
      '3 books overdue',
      '1 book due back today',
      '2 applications waiting for approval',
      '4 books due within 5 days',
    ]);
    expect(within(panel).getByRole('link', { name: '3 books overdue' })).toHaveAttribute(
      'href',
      '/due',
    );
    expect(screen.getByRole('heading', { name: 'Needs attention 4' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call list (2 members)' })).toHaveAttribute(
      'href',
      '/due/calls',
    );
    expect(screen.getByRole('button', { name: 'Print the daily loans sheet' })).toBeInTheDocument();
  });

  it('says so on a quiet day', async () => {
    signedIn(librarian, {
      'GET /dashboard': {
        body: { today, monthEnd: today, branches: [branchToday(1, 'KS', 'Kesbewa', counts())] },
      },
    });
    renderApp('/');
    expect(await screen.findByText('Nothing needs attention today.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Call list/ })).not.toBeInTheDocument();
  });

  it('gives a super admin every branch, with suspended members at the top', async () => {
    signedIn(superAdmin, {
      'GET /dashboard': {
        body: {
          today,
          monthEnd: today,
          branches: [
            branchToday(2, 'GL', 'Galle', counts({ suspended: 1, overdue: 1, overdueMembers: 1 })),
            branchToday(1, 'KS', 'Kesbewa', counts({ expiring_this_month: 2 })),
          ],
        },
      },
    });
    renderApp('/');

    const top = await screen.findByRole('alert');
    expect(top).toHaveTextContent('Suspended members');
    expect(top).toHaveTextContent('GL — 1 suspended member');
    expect(screen.getByText('GL — Galle')).toBeInTheDocument();
    expect(screen.getByText('KS — Kesbewa')).toBeInTheDocument();
    // Lifted to the top, so not repeated in the branch's own panel.
    expect(within(screen.getByTestId('panel-GL')).getAllByRole('link')).toHaveLength(1);
    expect(
      within(screen.getByTestId('panel-GL')).getByRole('link', { name: '1 book overdue' }),
    ).toHaveAttribute('href', '/due?branch=2');
    expect(
      within(screen.getByTestId('panel-KS')).getByRole('link', {
        name: '2 memberships end this month',
      }),
    ).toHaveAttribute('href', '/members?tab=lists');
  });

  it('downloads the daily loans sheet for the branch', async () => {
    const createObjectURL = vi.fn(() => 'blob:sheet');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const api = signedIn(librarian, {
      'GET /dashboard': {
        body: { today, monthEnd: today, branches: [branchToday(1, 'KS', 'Kesbewa', counts())] },
      },
      'GET /sheets/daily-loans?branchId=1': { body: {} },
    });
    renderApp('/');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Print the daily loans sheet' }),
    );
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    const call = api.calls.find((c) => c.route === 'GET /sheets/daily-loans?branchId=1');
    expect(call?.authorization).toBe('Bearer tok');
  });
});

describe('the due lists (FR-NOT-12, FR-NOT-04)', () => {
  const lists = {
    today,
    branches: [
      {
        branchId: 1,
        branchCode: 'KS',
        branchName: 'Kesbewa',
        warningDays: 5,
        overdue: [overdueLoan(1, 9, 'නිමාලි සිල්වා', 6), overdueLoan(2, 10, 'Ajith Perera', 2)],
        dueSoon: [
          dueLoan({ id: 3, memberName: 'Zara', dueDate: today, title: 'B book' }),
          dueLoan({
            id: 4,
            memberName: 'Amal',
            memberOtherPhone: '0112345678',
            dueDate: addDays(today, 3),
            title: 'A book',
            extensionStatus: 'approved',
          }),
        ],
        returnedLateToday: [
          dueLoan({ id: 5, status: 'returned', returnedOn: today, daysLate: 4, title: 'C book' }),
        ],
      },
    ],
  };

  it('holds overdue books above the five-day list, which staff can sort', async () => {
    signedIn(librarian, { 'GET /due': { body: lists } });
    renderApp('/due');

    const overdue = (await screen.findByRole('heading', { name: 'Overdue (2)' })).closest(
      'section',
    )!;
    const soon = screen.getByRole('heading', { name: 'Due within 5 days (2)' }).closest('section')!;
    expect(overdue.compareDocumentPosition(soon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(overdue).getByText('6 days late')).toBeInTheDocument();

    const names = () =>
      within(soon)
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('link')[0]!.textContent);
    expect(names()).toEqual(['Zara', 'Amal']);
    expect(within(soon).getByText('Today')).toBeInTheDocument();
    expect(within(soon).getByText('extended')).toBeInTheDocument();
    expect(within(soon).getByRole('link', { name: /0112345678/ })).toHaveAttribute(
      'href',
      'tel:0112345678',
    );

    await userEvent.click(within(soon).getByRole('button', { name: /Member/ }));
    expect(names()).toEqual(['Amal', 'Zara']);
    await userEvent.click(within(soon).getByRole('button', { name: /Member/ }));
    expect(names()).toEqual(['Zara', 'Amal']);

    expect(screen.getByRole('heading', { name: 'Taken back late today (1)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call list (2 members)' })).toHaveAttribute(
      'href',
      '/due/calls?branch=1',
    );
  });

  it('lets a super admin pick a branch', async () => {
    const api = signedIn(superAdmin, {
      'GET /due': { body: { today, branches: [] } },
      'GET /due?branchId=2': { body: { today, branches: [] } },
    });
    renderApp('/due');
    await screen.findByRole('option', { name: 'GL — Galle' });
    await userEvent.selectOptions(screen.getByLabelText('Branch'), '2');
    await waitFor(() =>
      expect(api.calls.some((c) => c.route === 'GET /due?branchId=2')).toBe(true),
    );
  });

  it('puts one card per member on the call list, the longest overdue first', async () => {
    signedIn(librarian, {
      'GET /due?branchId=1': {
        body: {
          ...lists,
          branches: [
            {
              ...lists.branches[0],
              overdue: [
                overdueLoan(1, 10, 'Ajith Perera', 3),
                overdueLoan(2, 9, 'නිමාලි සිල්වා', 9),
                overdueLoan(3, 10, 'Ajith Perera', 1),
              ],
            },
          ],
        },
      },
    });
    renderApp('/due/calls?branch=1');

    expect(await screen.findByRole('heading', { name: 'KS — Kesbewa (2)' })).toBeInTheDocument();
    const cards = screen.getAllByRole('listitem').filter((li) => li.querySelector('section'));
    expect(cards.map((c) => within(c).getAllByRole('link')[0]!.textContent)).toEqual([
      'නිමාලි සිල්වා',
      'Ajith Perera',
    ]);
    expect(within(cards[1]!).getByText('3 days late')).toBeInTheDocument();
    expect(within(cards[1]!).getAllByText(/KS-A1-0000/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Print the call list' })).toBeInTheDocument();
  });
});

describe("a member's panel (FR-NOT-01, FR-NOT-02, FR-NOT-08)", () => {
  it('shows what needs their attention, most urgent first, with a count', async () => {
    signedIn(memberUser, {
      'GET /me/dashboard': {
        body: {
          today,
          items: [
            {
              kind: 'loan_overdue',
              tone: 'urgent',
              loanId: 1,
              title: 'මඩොල් දූව',
              accessionNo: 'KS-A1-00007',
              dueDate: addDays(today, -3),
              daysLate: 3,
            },
            {
              kind: 'loan_due_soon',
              tone: 'warning',
              loanId: 2,
              title: 'ගම්පෙරළිය',
              accessionNo: 'KS-A1-00008',
              dueDate: addDays(today, 1),
              daysLeft: 1,
            },
            {
              kind: 'membership_expiring',
              tone: 'warning',
              expireAt: addDays(today, 20),
              daysLeft: 20,
            },
            { kind: 'late_returns', tone: 'info', count: 2, months: 12 },
          ],
        },
      },
    });
    renderApp('/');

    expect(
      await screen.findByRole('heading', { name: 'For your attention 4' }),
    ).toBeInTheDocument();
    const overdue = screen.getByRole('alert');
    expect(overdue).toHaveTextContent('මඩොල් දූව is 3 days late');
    expect(overdue).toHaveTextContent('Nothing more can be borrowed until it is returned.');
    expect(screen.getByText('ගම්පෙරළිය is due back tomorrow')).toBeInTheDocument();
    expect(screen.getByText('Your membership ends in 20 days')).toBeInTheDocument();
    expect(screen.getByText('2 late returns in the last 12 months')).toBeInTheDocument();
  });

  it('is calm when there is nothing to do', async () => {
    signedIn(memberUser, { 'GET /me/dashboard': { body: { today, items: [] } } });
    renderApp('/');
    expect(
      await screen.findByText('Nothing needs your attention. Enjoy your books.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'For your attention 0' })).toBeInTheDocument();
  });
});

describe("the top of a member's record (FR-NOT-11)", () => {
  it('shows a suspension and late returns before anything else', async () => {
    signedIn(librarian, {
      'GET /members/9': {
        body: {
          id: 9,
          fullName: 'නිමාලි සිල්වා',
          whatsappPhone: '0771234567',
          branchId: 1,
          status: 'suspended',
          state: 'suspended',
          age: 36,
          area: null,
          organisation: null,
          introducedByName: null,
          introducedByPhone: null,
          appliedAt: null,
          expireAt: addDays(today, 100),
          stale: false,
          address: null,
          otherPhone: null,
          dateOfBirth: null,
          rejectionReason: null,
          approvedAt: null,
          mustChangePassword: false,
          payments: [],
        },
      },
      'GET /members/9/loans': {
        body: {
          standing: {
            openLoans: 0,
            maxBooks: 2,
            overdueLoans: 0,
            lateReturns: 1,
            lateReturnMonths: 12,
            frequentlyLate: false,
          },
          loans: [],
        },
      },
    });
    renderApp('/members/9');

    const top = await screen.findByTestId('standing');
    expect(within(top).getByText('Suspended')).toBeInTheDocument();
    expect(within(top).getByText('1 late return in the last 12 months.')).toBeInTheDocument();
  });
});
