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
const superAdmin = user({ id: 1, userType: 'super_admin', branchId: null });

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
  writer: 'මාටින් වික්‍රමසිංහ',
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
const standing = (over: Record<string, unknown> = {}) => ({
  openLoans: 1,
  maxBooks: 2,
  overdueLoans: 0,
  lateReturns: 0,
  lateReturnMonths: 12,
  frequentlyLate: false,
  ...over,
});
const check = (over: Record<string, unknown> = {}) => ({
  member: { id: 9, fullName: 'නිමාලි සිල්වා', branchId: 1 },
  copy: {
    id: 12,
    accessionNo: 'KS-A1-00008',
    titleId: 6,
    title: 'ගම්පෙරළිය',
    writer: 'මාටින් වික්‍රමසිංහ',
    branchId: 1,
    state: 'on_shelf',
  },
  borrowDate: today,
  dueDate: addDays(today, 14),
  isBackdated: false,
  standing: standing(),
  refusals: [],
  ...over,
});

function signedIn(me: object, extra: Record<string, Route> = {}) {
  localStorage.setItem(TOKEN_KEY, 'tok');
  return fakeApi({
    'GET /auth/me': { body: { user: me, warnings: [] } },
    'GET /library': { body: { name: 'Library', logoImageId: null } },
    'GET /branches': { body: branches },
    'GET /members/9': { body: member },
    ...extra,
  });
}

const typeAccession = async (value: string) => {
  const box = await screen.findByLabelText('Book number');
  await userEvent.clear(box);
  await userEvent.type(box, value);
};

describe('issuing at the counter (FR-CIR-01, FR-CIR-02, FR-CIR-15)', () => {
  it('shows the member first, checks the book, then issues it', async () => {
    const api = signedIn(librarian, {
      'GET /members/9/loans': {
        body: { standing: standing({ lateReturns: 3, frequentlyLate: true }), loans: [loan()] },
      },
      'POST /loans/check': { body: check() },
      'POST /loans': {
        status: 201,
        body: loan({
          id: 32,
          accessionNo: 'KS-A1-00008',
          title: 'ගම්පෙරළිය',
          dueDate: addDays(today, 14),
        }),
      },
    });
    renderApp('/counter?member=9');

    expect(await screen.findByText('Frequently late')).toBeInTheDocument();
    expect(screen.getByTestId('holding')).toHaveTextContent('1 of 2 books out');
    await typeAccession('ksa100008');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(`Due back on ${addDays(today, 14)}.`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));

    expect(await screen.findByText('Issued KS-A1-00008')).toBeInTheDocument();
    const sent = api.calls.find((c) => c.route === 'POST /loans');
    expect(sent?.body).toEqual({ memberId: 9, accessionNo: 'ksa100008' });
  });

  it('states every reason a book cannot be issued, and offers no way to issue it', async () => {
    signedIn(librarian, {
      'GET /members/9/loans': {
        body: { standing: standing({ openLoans: 2, overdueLoans: 1 }), loans: [] },
      },
      'POST /loans/check': {
        body: check({
          refusals: [
            { code: 'member_overdue', params: { count: 1 } },
            { code: 'member_at_limit', params: { max: 2 } },
          ],
        }),
      },
    });
    renderApp('/counter?member=9');
    expect(await screen.findByText('Holding an overdue book')).toBeInTheDocument();
    await typeAccession('KS-A1-00008');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    const heading = await screen.findByText('This book cannot be issued');
    const refusal = heading.closest<HTMLElement>('[role=alert]')!;
    expect(
      within(refusal).getByText('The member is holding an overdue book; it must come back first.'),
    ).toBeInTheDocument();
    expect(
      within(refusal).getByText('The member already has 2 books, the most allowed.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue' })).not.toBeInTheDocument();
  });

  it('catches a mistyped book number before asking the server', async () => {
    const api = signedIn(librarian, {
      'GET /members/9/loans': { body: { standing: standing(), loans: [] } },
    });
    renderApp('/counter?member=9');
    await typeAccession('hello');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(
      await screen.findByText('That is not a book number. It looks like KS-A1-01234.'),
    ).toBeInTheDocument();
    expect(api.calls.some((c) => c.route.startsWith('POST /loans'))).toBe(false);
  });

  it('enters a paper slip with its real date (FR-CIR-14)', async () => {
    const api = signedIn(librarian, {
      'GET /members/9/loans': { body: { standing: standing(), loans: [] } },
      'POST /loans/check': {
        body: check({ borrowDate: addDays(today, -1), isBackdated: true }),
      },
    });
    renderApp('/counter?member=9');
    await typeAccession('KS-A1-00008');
    await userEvent.click(screen.getByLabelText(/Entering a paper slip/));
    expect(screen.getByLabelText('The date on the slip')).toHaveValue(addDays(today, -1));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/Entered from paper/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.route === 'POST /loans/check')?.body).toMatchObject({
      borrowDate: addDays(today, -1),
    });
  });
});

describe('taking back (FR-CIR-03, FR-CIR-04, FR-CIR-08)', () => {
  it('calls out a late return before it is confirmed, and can set a damaged book aside', async () => {
    const late = loan({ dueDate: addDays(today, -3), overdue: true, daysLate: 3 });
    const api = signedIn(librarian, {
      'GET /loans/open?accession=KS-A1-00007': { body: late },
      'POST /loans/31/return': {
        body: { ...late, status: 'returned', returnedOn: today, overdue: false },
      },
    });
    renderApp('/counter?tab=return');
    await typeAccession('ks-a1-00007');
    await userEvent.click(screen.getByRole('button', { name: 'Find the loan' }));

    const callout = await screen.findByTestId('late-callout');
    expect(within(callout).getByText('3 days late')).toBeInTheDocument();
    expect(api.calls.some((c) => c.route.endsWith('/return'))).toBe(false);

    await userEvent.click(screen.getByLabelText(/came back damaged/));
    await userEvent.click(screen.getByRole('button', { name: 'Take back' }));
    expect(await screen.findByText('Taken back KS-A1-00007')).toBeInTheDocument();
    expect(screen.getByText(/returned 3 days late/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.route === 'POST /loans/31/return')?.body).toEqual({
      notUseable: true,
    });
  });

  it('says so when the book is not on loan', async () => {
    signedIn(librarian, {
      'GET /loans/open?accession=KS-A1-00007': {
        status: 404,
        body: { code: 'no_open_loan', message: 'x' },
      },
    });
    renderApp('/counter?tab=return');
    await typeAccession('KS-A1-00007');
    await userEvent.click(screen.getByRole('button', { name: 'Find the loan' }));
    expect(await screen.findByText('This copy is not on loan.')).toBeInTheDocument();
  });
});

describe("a member's books (FR-CIR-04, FR-CIR-09)", () => {
  it('shows the history on the member page, newest first, with late and void loans', async () => {
    signedIn(librarian, {
      'GET /branches/1': { status: 404, body: { code: 'not_found', message: '' } },
      'GET /members/9/loans': {
        body: {
          standing: standing({ lateReturns: 3, frequentlyLate: true }),
          loans: [
            loan(),
            loan({
              id: 30,
              status: 'returned',
              returnedOn: '2026-10-20',
              daysLate: 4,
              returnBackdated: true,
            }),
            loan({
              id: 29,
              status: 'void',
              voidReason: 'Mistake',
              voidedAt: '2026-10-01T05:00:00.000Z',
            }),
          ],
        },
      },
    });
    renderApp('/members/9');
    expect(await screen.findByText('Frequently late')).toBeInTheDocument();
    expect(screen.getByText('4 days late')).toBeInTheDocument();
    expect(screen.getByText('Void')).toBeInTheDocument();
    expect(screen.getByText('paper')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Issue a book' })).toHaveAttribute(
      'href',
      '/counter?member=9',
    );
  });

  it('shows a member their own books and late returns', async () => {
    signedIn(user({ id: 9, userType: 'member', branchId: 1 }), {
      'GET /me/membership': { body: member },
      'GET /me/loans': {
        body: {
          standing: standing({ openLoans: 1, overdueLoans: 1, lateReturns: 1 }),
          loans: [
            loan({ overdue: true, daysLate: 2, dueDate: addDays(today, -2) }),
            loan({ id: 30, status: 'returned', returnedOn: '2026-10-20', daysLate: 4 }),
          ],
        },
      },
    });
    renderApp('/my-membership');
    expect(await screen.findByText('My books')).toBeInTheDocument();
    expect(screen.getByText('Holding an overdue book')).toBeInTheDocument();
    expect(screen.getByText('1 late return in the last 12 months.')).toBeInTheDocument();
    expect(screen.getByText('4 days late')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'මඩොල් දූව' })).not.toBeInTheDocument();
  });
});

describe('correcting and voiding a loan (FR-CIR-05)', () => {
  it('sends only what changed, with the reason', async () => {
    const api = signedIn(librarian, {
      'GET /loans/31': { body: loan() },
      'PATCH /loans/31': { body: loan({ borrowDate: addDays(today, -4) }) },
    });
    renderApp('/loans/31');
    const date = await screen.findByLabelText('Borrowed');
    await userEvent.clear(date);
    await userEvent.type(date, addDays(today, -4));
    await userEvent.type(screen.getByLabelText('Reason for the correction'), 'Slip said Monday');
    await userEvent.click(screen.getByRole('button', { name: 'Save the correction' }));

    expect(await screen.findByText('The loan is corrected.')).toBeInTheDocument();
    expect(api.calls.find((c) => c.route === 'PATCH /loans/31')?.body).toEqual({
      borrowDate: addDays(today, -4),
      reason: 'Slip said Monday',
    });
    expect(screen.queryByText('Void this loan')).not.toBeInTheDocument();
  });

  it('lets a super admin void a loan with a reason', async () => {
    const api = signedIn(superAdmin, {
      'GET /loans/31': { body: loan() },
      'POST /loans/31/void': { body: loan({ status: 'void', voidReason: 'Wrong person' }) },
    });
    renderApp('/loans/31');
    await userEvent.type(await screen.findByLabelText('Reason for voiding'), 'Wrong person');
    await userEvent.click(screen.getByRole('button', { name: 'Void the loan' }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.route === 'POST /loans/31/void')?.body).toEqual({
        reason: 'Wrong person',
      }),
    );
    expect(await screen.findByText('The loan is void.')).toBeInTheDocument();
  });
});
