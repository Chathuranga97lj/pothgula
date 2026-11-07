import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeApi, type Route, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';
const branches = [
  { id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null },
  { id: 2, code: 'GL', name: 'Galle', logoImageId: null },
];
const categories = [
  { code: 'A1', name: 'Sinhala novels', isActive: true, inUse: true },
  { code: 'A2', name: 'Retired stuff', isActive: false, inUse: false },
];
const summary = {
  id: 5,
  title: 'මඩොල් දූව',
  writer: 'මාටින් වික්‍රමසිංහ',
  publisher: 'සරසවි',
  isbn: '9789555731234',
  edition: null,
  categoryCode: 'A1',
  categoryName: 'Sinhala novels',
  holdings: [
    { branchId: 1, total: 3, onShelf: 1 },
    { branchId: 2, total: 1, onShelf: 1 },
  ],
};
const copyRow = (over: Record<string, unknown> = {}) => ({
  id: 11,
  accessionNo: 'KS-A1-00001',
  branchId: 1,
  accessionedBranchId: 1,
  condition: 'useable',
  state: 'on_shelf',
  withdrawnAt: null,
  withdrawnReason: null,
  priceCents: 75_000,
  source: 'Donation',
  legacyNo: null,
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  ...summary,
  mergedIntoId: null,
  copies: [copyRow()],
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

const member = user({ id: 9, userType: 'member', branchId: 1 });
const librarian = user({ id: 2, userType: 'admin', branchId: 1 });
const superAdmin = user({ id: 1, userType: 'super_admin', branchId: null });

describe('browsing (FR-CAT-05 – FR-CAT-07)', () => {
  it('starts at the home branch, shows copies on the shelf, and searches as you type', async () => {
    const api = signedIn(member, {
      'GET /catalogue?branchId=1': { body: { titles: [summary], more: false } },
      [`GET /catalogue?q=${encodeURIComponent('මඩොල්').replace(/%20/g, '+')}&branchId=1`]: {
        body: { titles: [summary], more: false },
      },
    });
    renderApp('/catalogue');
    expect(await screen.findByText('මඩොල් දූව')).toBeInTheDocument();
    expect(screen.getByText('Kesbewa: 1 of 3 on the shelf')).toBeInTheDocument();
    expect(screen.getByText('Also on the shelf at Galle')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a book' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Retired stuff' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search the catalogue'), 'මඩොල්');
    await waitFor(() =>
      expect(api.calls.some((c) => c.route.startsWith('GET /catalogue?q='))).toBe(true),
    );
  });

  it('shows a member the copies without prices or staff actions', async () => {
    signedIn(member, {
      'GET /titles/5': { body: detail({ copies: [copyRow({ priceCents: null })] }) },
    });
    renderApp('/titles/5');
    expect(await screen.findByText('KS-A1-00001')).toBeInTheDocument();
    expect(screen.getByText('On the shelf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Rs /)).not.toBeInTheDocument();
  });
});

describe('cataloguing (FR-CAT-01, FR-CAT-02)', () => {
  it('warns of a possible duplicate, then creates the book and shows the numbers to write', async () => {
    const api = signedIn(librarian, {
      'GET /titles/similar?title=%E0%B6%B8%E0%B6%A9%E0%B7%9C%E0%B6%BD%E0%B7%8A&isbn=': {
        body: [{ ...summary, reason: 'similar_title' }],
      },
      'POST /titles': {
        status: 201,
        body: { title: detail({ id: 6 }), accessionNumbers: ['KS-A1-00004', 'KS-A1-00005'] },
      },
    });
    renderApp('/titles/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'මඩොල්');
    expect(
      await screen.findByText('This book may already be in the catalogue'),
    ).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'A1');
    const count = screen.getByLabelText('How many copies');
    await userEvent.clear(count);
    await userEvent.type(count, '2');
    await userEvent.type(screen.getByLabelText('Price each (Rs, optional)'), '750');
    await userEvent.click(screen.getByRole('button', { name: 'Add to the catalogue' }));

    expect(await screen.findByTestId('accession-numbers')).toHaveTextContent(
      'KS-A1-00004 KS-A1-00005',
    );
    expect(api.calls.find((c) => c.route === 'POST /titles')?.body).toMatchObject({
      title: 'මඩොල්',
      categoryCode: 'A1',
      copies: { branchId: 1, count: 2, priceCents: 75_000 },
    });
  });
});

describe('looking after copies (FR-CAT-03, FR-CAT-11, FR-CAT-14)', () => {
  it('asks a librarian for a reason before withdrawing a copy', async () => {
    const api = signedIn(librarian, {
      'GET /titles/5': { body: detail() },
      'POST /copies/11/withdraw': {
        body: detail({
          copies: [copyRow({ state: 'withdrawn', withdrawnReason: 'Pages missing' })],
        }),
      },
    });
    renderApp('/titles/5');
    const row = (await screen.findByText('KS-A1-00001')).closest('tr')!;
    expect(within(row).getByText('Rs 750.00')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Move' })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Withdraw' }));
    const confirm = screen.getByRole('button', { name: 'Withdraw this copy' });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText('Why is KS-A1-00001 leaving the collection?'),
      'Pages missing',
    );
    await userEvent.click(confirm);
    expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
    expect(api.calls.find((c) => c.route === 'POST /copies/11/withdraw')?.body).toEqual({
      reason: 'Pages missing',
    });
  });

  it('lets a super admin move a copy to another branch', async () => {
    const api = signedIn(superAdmin, {
      'GET /titles/5': { body: detail() },
      'POST /copies/11/move': { body: detail({ copies: [copyRow({ branchId: 2 })] }) },
    });
    renderApp('/titles/5');
    const row = (await screen.findByText('KS-A1-00001')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Move' }));
    await userEvent.selectOptions(screen.getByLabelText('Move KS-A1-00001 to'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Move this copy' }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.route === 'POST /copies/11/move')?.body).toEqual({
        branchId: 2,
      }),
    );
    expect(await screen.findByText('Galle', { selector: 'td' })).toBeInTheDocument();
  });
});
