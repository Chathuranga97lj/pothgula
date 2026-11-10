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
const librarian = user({ id: 2, fullName: 'කමල්', userType: 'admin', branchId: 1 });
const superAdmin = user({ id: 1, userType: 'super_admin', branchId: null });
const memberUser = user({ id: 9, fullName: 'නිමාලි සිල්වා', userType: 'member', branchId: 1 });

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

const settlement = (over: Record<string, unknown> = {}) => ({
  id: 50,
  borrowId: 31,
  copyId: 11,
  accessionNo: 'KS-A1-00007',
  titleId: 5,
  title: 'මඩොල් දූව',
  categoryCode: 'A1',
  memberId: 9,
  memberName: 'නිමාලි සිල්වා',
  memberPhone: '0771234567',
  memberOtherPhone: null,
  memberStatus: 'active',
  memberBranch: { id: 1, code: 'KS', name: 'Kesbewa' },
  copyBranch: { id: 1, code: 'KS', name: 'Kesbewa' },
  kind: 'lost',
  reason: 'Left on a bus',
  declaredOn: today,
  declaredByName: 'කමල්',
  tariffCents: 150000,
  setAmountCents: 150000,
  amountReason: null,
  amountSetByName: 'කමල්',
  amountDueCents: 150000,
  reductionReason: null,
  windowEnds: addDays(today, 100),
  daysLeft: 100,
  windowPassed: false,
  windowExtendedDays: null,
  windowExtensionReason: null,
  status: 'open',
  settledOn: null,
  daysToSettle: null,
  handledByName: null,
  waiverReason: null,
  replacementCopyId: null,
  replacementAccessionNo: null,
  foundOn: null,
  foundReason: null,
  payments: [],
  paidCents: 0,
  ...over,
});

function signedIn(me: object, extra: Record<string, Route> = {}) {
  localStorage.setItem(TOKEN_KEY, 'tok');
  return fakeApi({
    'GET /auth/me': { body: { user: me, warnings: [] } },
    'GET /library': { body: { name: 'Library', logoImageId: null } },
    'GET /branches': { body: branches },
    'GET /categories': { body: [] },
    ...extra,
  });
}

describe('declaring a book lost (FR-LST-01, FR-LST-02)', () => {
  it('shows the tariff, asks for a reason when the amount differs, and declares', async () => {
    const { calls } = signedIn(librarian, {
      'GET /loans/31': { body: loan() },
      'GET /loans/31/lost': {
        body: {
          loanId: 31,
          copyBranch: { id: 1, code: 'KS', name: 'Kesbewa' },
          categoryCode: 'A1',
          tariffCents: 150000,
          windowDays: 100,
          windowEnds: addDays(today, 100),
        },
      },
      'POST /loans/31/lost': { status: 201, body: settlement({ setAmountCents: 100000 }) },
    });
    renderApp('/loans/31');
    await userEvent.click(await screen.findByRole('button', { name: 'Declare it lost…' }));
    expect(await screen.findByText(/KS’s tariff for A1 is Rs. 1,500\.00\./)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('What happened, briefly'), 'Left on a bus');
    await userEvent.type(screen.getByLabelText('Amount (Rs.)'), '1000');
    const confirm = screen.getByRole('button', { name: 'Declare lost' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Why this amount'), 'Old paperback');
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.route === 'POST /loans/31/lost')?.body).toEqual({
        kind: 'lost',
        reason: 'Left on a bus',
        amountCents: 100000,
        amountReason: 'Old paperback',
      }),
    );
    expect(await screen.findByText('Declared lost. The settlement is open.')).toBeInTheDocument();
  });

  it('shows a lost loan with its settlement, and nothing more to do on it', async () => {
    signedIn(librarian, {
      'GET /loans/31': {
        body: loan({ status: 'lost', returnedOn: today, settlementId: 50 }),
      },
    });
    renderApp('/loans/31');
    expect(await screen.findByRole('link', { name: 'Open the settlement' })).toHaveAttribute(
      'href',
      '/lost-books/50',
    );
    expect(screen.queryByRole('button', { name: 'Declare it lost…' })).not.toBeInTheDocument();
    expect(screen.queryByText('Correct this loan')).not.toBeInTheDocument();
  });
});

describe('the lost-books list (FR-LST-10)', () => {
  it('lists what is owed, passed windows first, with a link to the tariff', async () => {
    signedIn(librarian, {
      'GET /settlements': {
        body: {
          today,
          branches: [
            {
              branchId: 1,
              branchCode: 'KS',
              branchName: 'Kesbewa',
              open: [
                settlement({
                  id: 51,
                  title: 'Gamperaliya',
                  daysLeft: -3,
                  windowPassed: true,
                  windowEnds: addDays(today, -3),
                }),
                settlement(),
              ],
              recent: [],
            },
          ],
        },
      },
    });
    renderApp('/lost-books');
    const open = await screen.findByRole('heading', { name: 'Not yet settled (2)' });
    const items = within(open.closest('div')!).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Gamperaliya');
    expect(items[0]).toHaveTextContent('Window passed');
    expect(items[0]).toHaveTextContent('window passed 3 days ago');
    expect(items[1]).toHaveTextContent('Rs. 1,500.00 · 100 days left');
    expect(screen.getByRole('link', { name: 'The lost-book tariff' })).toHaveAttribute(
      'href',
      '/lost-books/tariff/1',
    );
  });
});

describe('settling (FR-LST-05 to FR-LST-09)', () => {
  it('records a payment of the amount due with its receipt', async () => {
    const { calls } = signedIn(librarian, {
      'GET /settlements/50': { body: settlement() },
      'POST /settlements/50/pay': {
        body: settlement({
          status: 'paid',
          settledOn: today,
          daysToSettle: 0,
          paidCents: 150000,
          payments: [
            {
              id: 1,
              kind: 'payment',
              amountCents: 150000,
              paidOn: today,
              receiptNo: 'R-1',
              collectedByName: 'කමල්',
              reason: null,
              reversesPaymentId: null,
              reversed: false,
            },
          ],
        }),
      },
    });
    renderApp('/lost-books/50');
    expect(await screen.findByText('Payment of Rs. 1,500.00')).toBeInTheDocument();
    // Admins do not see the super admin's decisions.
    expect(screen.queryByText('Super admin')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Receipt number'), 'R-1');
    await userEvent.click(screen.getByRole('button', { name: 'Record the payment' }));
    await waitFor(() =>
      expect(calls.find((c) => c.route === 'POST /settlements/50/pay')?.body).toEqual({
        amountCents: 150000,
        receiptNo: 'R-1',
      }),
    );
    expect(
      await screen.findByText('Payment recorded. The settlement is closed.'),
    ).toBeInTheDocument();
  });

  it('accepts a copy of the same book as the replacement', async () => {
    const { calls } = signedIn(librarian, {
      'GET /settlements/50': { body: settlement() },
      'POST /settlements/50/replace': {
        body: settlement({
          status: 'replaced',
          settledOn: today,
          replacementCopyId: 12,
          replacementAccessionNo: 'KS-A1-00009',
        }),
      },
    });
    renderApp('/lost-books/50');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Accept a copy of the same book…' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Accept it and give it a number' }));
    await waitFor(() =>
      expect(calls.some((c) => c.route === 'POST /settlements/50/replace')).toBe(true),
    );
    expect(
      await screen.findByText('Accepted as copy KS-A1-00009. The settlement is closed.'),
    ).toBeInTheDocument();
  });

  it('lets a super admin extend a passed window once, with a reason', async () => {
    const { calls } = signedIn(superAdmin, {
      'GET /settlements/50': {
        body: settlement({ daysLeft: -2, windowPassed: true, windowEnds: addDays(today, -2) }),
      },
      'POST /settlements/50/extend': {
        body: settlement({ windowExtendedDays: 30, windowExtensionReason: 'Hospital' }),
      },
    });
    renderApp('/lost-books/50');
    await userEvent.click(await screen.findByRole('button', { name: 'Extend the window once' }));
    await userEvent.type(screen.getByLabelText('Extra days'), '30');
    await userEvent.type(screen.getByLabelText('Reason'), 'Hospital');
    await userEvent.click(screen.getByRole('button', { name: 'Extend the window once' }));
    await waitFor(() =>
      expect(calls.find((c) => c.route === 'POST /settlements/50/extend')?.body).toEqual({
        days: 30,
        reason: 'Hospital',
      }),
    );
    expect(await screen.findByText('Window extended.')).toBeInTheDocument();
  });
});

describe('the tariff (FR-LST-16)', () => {
  it('saves only the amounts that changed', async () => {
    const tariff = {
      branch: { id: 1, code: 'KS', name: 'Kesbewa' },
      rows: [
        {
          categoryCode: 'A1',
          categoryName: 'Novels',
          categoryActive: true,
          amountCents: 150000,
          updatedAt: `${today}T03:00:00.000Z`,
          updatedByName: 'කමල්',
        },
        {
          categoryCode: 'B2',
          categoryName: 'Poetry',
          categoryActive: true,
          amountCents: null,
          updatedAt: null,
          updatedByName: null,
        },
      ],
    };
    const { calls } = signedIn(librarian, {
      'GET /branches/1/tariff': { body: tariff },
      'PATCH /branches/1/tariff': { body: tariff },
    });
    renderApp('/lost-books/tariff/1');
    const poetry = await screen.findByLabelText('Poetry');
    expect(screen.getByLabelText('Novels')).toHaveValue('1,500.00');
    await userEvent.type(poetry, '750');
    await userEvent.click(screen.getByRole('button', { name: 'Save the tariff' }));
    await waitFor(() =>
      expect(calls.find((c) => c.route === 'PATCH /branches/1/tariff')?.body).toEqual({
        amounts: [{ categoryCode: 'B2', amountCents: 75000 }],
      }),
    );
    expect(await screen.findByText('Tariff saved.')).toBeInTheDocument();
  });
});

describe('the member’s side (FR-LST-03, FR-NOT-08)', () => {
  it('shows the amount and the days left on their panel and their own page', async () => {
    signedIn(memberUser, {
      'GET /me/dashboard': {
        body: {
          today,
          items: [
            {
              kind: 'settlement',
              tone: 'warning',
              settlementId: 50,
              title: 'මඩොල් දූව',
              accessionNo: 'KS-A1-00007',
              amountDueCents: 150000,
              windowEnds: addDays(today, 40),
              daysLeft: 40,
            },
          ],
        },
      },
    });
    renderApp('/');
    expect(
      await screen.findByText('A lost book to settle: මඩොල් දූව — Rs. 1,500.00'),
    ).toBeInTheDocument();
    expect(screen.getByText(/40 days left/)).toBeInTheDocument();
  });
});

describe('receipts (FR-MEM-07)', () => {
  it('prints the receipt for a lost-book payment', async () => {
    const createObjectURL = vi.fn(() => 'blob:receipt');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const { calls } = signedIn(librarian, {
      'GET /settlements/50': {
        body: settlement({
          status: 'paid',
          settledOn: today,
          paidCents: 150000,
          payments: [
            {
              id: 7,
              kind: 'payment',
              amountCents: 150000,
              paidOn: today,
              receiptNo: 'R-1',
              collectedByName: 'කමල්',
              reason: null,
              reversesPaymentId: null,
              reversed: false,
            },
          ],
        }),
      },
      'GET /receipts/settlement/7': { body: {} },
    });
    renderApp('/lost-books/50');
    await userEvent.click(await screen.findByRole('button', { name: 'Receipt' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(calls.some((c) => c.route === 'GET /receipts/settlement/7')).toBe(true);
  });
});
