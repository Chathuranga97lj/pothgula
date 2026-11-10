import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, type Route, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';
const branches = [
  { id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null },
  { id: 2, code: 'GL', name: 'Galle', logoImageId: null },
];
const categories = [
  { code: 'A1', name: 'Sinhala novels', isActive: true, inUse: true },
  { code: 'B1', name: 'English', isActive: true, inUse: true },
];
const librarian = user({ id: 2, fullName: 'කමල්', userType: 'admin', branchId: 1 });
const superAdmin = user({ id: 1, userType: 'super_admin', branchId: null });
const ks = { branchId: 1, branchCode: 'KS', branchName: 'Kesbewa' };

const report = (over: Record<string, unknown>) => ({
  kind: 'summary',
  title: 'Summary',
  about: [],
  branch: ks,
  from: null,
  to: null,
  today: '2026-11-10',
  columns: [],
  rows: [],
  total: null,
  ...over,
});
const col = (key: string, label: string, numeric = false) => ({ key, label, numeric });
const row = (cells: unknown[], extra: { key?: string; link?: string } = {}) => ({
  cells,
  key: extra.key ?? null,
  link: extra.link ?? null,
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

const asked = (calls: { route: string }[]) =>
  calls.map((c) => c.route).filter((r) => r.startsWith('GET /reports'));

describe('the reports (§15)', () => {
  it('lists every report, each with what it answers', async () => {
    signedIn(librarian);
    renderApp('/reports');
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    for (const name of [
      'At a glance',
      'Stock',
      'Books out',
      'Most and least borrowed',
      'Borrowing by month',
      'Late returns',
      'Members by age',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /Late returns/ })).toHaveAttribute(
      'href',
      '/reports/late',
    );
  });

  it("shows an admin their branch's figures, worded, with no branch to choose (FR-RPT-06, FR-RPT-10)", async () => {
    signedIn(librarian, {
      'GET /reports/summary': {
        body: report({
          columns: [col('measure', 'Measure'), col('value', 'Value', true)],
          rows: [
            row(['Titles held', 3], { key: 'titles' }),
            row(['Most borrowed title this month', 'කලියුගය (4)'], { key: 'topThisMonth' }),
          ],
        }),
      },
    });
    renderApp('/reports/summary');
    expect(await screen.findByText('Titles held')).toBeInTheDocument();
    expect(screen.getByText('කලියුගය (4)')).toBeInTheDocument();
    expect(screen.getByText('As at 2026-11-10 · KS — Kesbewa')).toBeInTheDocument();
    expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
  });

  it('lets a super admin compare branches, or look at one', async () => {
    const { calls } = signedIn(superAdmin, {
      'GET /reports/stock': {
        body: report({
          kind: 'stock',
          branch: null,
          columns: [
            col('category', 'Category'),
            col('name', 'Name'),
            col('copies', 'All copies', true),
          ],
          rows: [row(['A1', 'Sinhala novels', 7])],
          total: ['Total', null, 7],
        }),
      },
      'GET /reports/stock?by=branch': {
        body: report({
          kind: 'stock',
          branch: null,
          columns: [
            col('branch', 'Branch'),
            col('name', 'Name'),
            col('copies', 'All copies', true),
          ],
          rows: [row(['GL', 'Galle', 1]), row(['KS', 'Kesbewa', 6])],
          total: ['Total', null, 7],
        }),
      },
      'GET /reports/stock?branchId=1': {
        body: report({
          kind: 'stock',
          columns: [col('category', 'Category'), col('copies', 'All copies', true)],
          rows: [row(['A1', 6])],
        }),
      },
    });
    renderApp('/reports/stock');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Total')).toBeInTheDocument();
    expect(screen.getByText(/Whole library/, { selector: 'p' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'branch');
    expect(await screen.findByText('Galle')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Branch'), '1');
    await waitFor(() => expect(asked(calls)).toContain('GET /reports/stock?branchId=1&by=branch'));
  });

  it('asks for the least borrowed in one category, and opens a title from the list (FR-RPT-05)', async () => {
    const popular = report({
      kind: 'popular',
      from: '2025-11-11',
      to: '2026-11-10',
      columns: [
        col('rank', 'No.', true),
        col('title', 'Title'),
        col('timesBorrowed', 'Times taken out', true),
      ],
      rows: [row([1, 'කලියුගය', 4], { link: '/titles/5' })],
    });
    const { calls } = signedIn(librarian, {
      'GET /reports/popular': { body: popular },
      'GET /reports/popular?order=least': { body: popular },
      'GET /reports/popular?order=least&category=B1': {
        body: { ...popular, rows: [row([1, 'Matilda', 0], { link: '/titles/6' })] },
      },
    });
    renderApp('/reports/popular');
    expect(await screen.findByRole('link', { name: 'කලියුගය' })).toHaveAttribute(
      'href',
      '/titles/5',
    );
    expect(screen.getByText('2025-11-11 to 2026-11-10 · KS — Kesbewa')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveValue('2025-11-11');

    await userEvent.selectOptions(screen.getByLabelText('Show'), 'least');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'B1');
    expect(await screen.findByRole('link', { name: 'Matilda' })).toBeInTheDocument();
    expect(asked(calls).at(-1)).toBe('GET /reports/popular?order=least&category=B1');
  });

  it('downloads the report as chosen (FR-RPT-09)', async () => {
    const createObjectURL = vi.fn(() => 'blob:report');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const { calls } = signedIn(librarian, {
      'GET /reports/late': {
        body: report({ kind: 'late', from: '2025-11-11', to: '2026-11-10' }),
      },
      'GET /reports/late/export?format=pdf': { body: {} },
    });
    renderApp('/reports/late');
    expect(await screen.findByText('Nothing to show for these choices.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(calls.map((c) => c.route)).toContain('GET /reports/late/export?format=pdf');
  });

  it('sends an unknown report back to the list', async () => {
    signedIn(librarian);
    renderApp('/reports/salaries');
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument();
  });
});
