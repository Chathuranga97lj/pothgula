import { addDays, todayColombo } from '@pothgula/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, type Route, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';
const weekAgo = addDays(todayColombo(), -6);
const branches = [
  { id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null },
  { id: 2, code: 'GL', name: 'Galle', logoImageId: null },
];
const librarian = user({ id: 2, fullName: 'කමල්', userType: 'admin', branchId: 1 });
const superAdmin = user({ id: 1, fullName: 'Boss', userType: 'super_admin', branchId: null });

const entry = (over: Record<string, unknown> = {}) => ({
  id: 40,
  at: '2026-11-10T03:35:00.000Z', // 09:05 in Colombo
  actorId: 2,
  actorName: 'කමල්',
  actorRole: 'admin',
  branchId: 1,
  branchCode: 'KS',
  action: 'copy.update',
  entity: 'copy',
  entityId: '7',
  before: { condition: 'useable' },
  after: { condition: 'missing' },
  ipAddress: '10.0.0.5',
  redactedAt: null,
  ...over,
});

const page = (entries: object[], nextBefore: number | null = null) => ({
  body: { entries, nextBefore },
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

const requested = (calls: { route: string }[]) =>
  calls.map((c) => c.route).filter((r) => r.startsWith('GET /log'));

describe('the activity log screen (FR-LOG-06, FR-LOG-07)', () => {
  it("opens on the last seven days, in words, with each entry's change", async () => {
    signedIn(librarian, {
      [`GET /log?from=${weekAgo}&limit=50`]: page([
        entry(),
        entry({
          id: 39,
          action: 'borrow.issue_backdated',
          entity: 'borrow',
          entityId: '31',
          before: null,
          after: { dueDate: '2026-11-20' },
        }),
        entry({ id: 38, actorId: null, actorName: null, actorRole: 'system', action: 'job.ran' }),
      ]),
    });
    renderApp('/log');

    const items = await screen.findAllByTestId('log-entry');
    expect(items).toHaveLength(3);
    const first = within(items[0]!);
    expect(first.getByText('2026-11-10 09:05')).toBeInTheDocument();
    expect(first.getByText('කමල් · Librarian')).toBeInTheDocument();
    expect(first.getByText('Copy edited')).toBeInTheDocument();
    expect(first.getByText('condition: useable → missing')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Book issued (paper slip)')).toBeInTheDocument();
    expect(within(items[1]!).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/loans/31',
    );
    // An action with no wording yet shows its code rather than nothing.
    expect(within(items[2]!).getByText('job.ran')).toBeInTheDocument();
    expect(within(items[2]!).getByText('The system')).toBeInTheDocument();
    expect(screen.getByText('Showing 3 entries.')).toBeInTheDocument();
    // Admins read their own branch only, so there is no branch to choose.
    expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Activity log' })).toBeInTheDocument();
  });

  it('fetches older entries a page at a time', async () => {
    const { calls } = signedIn(librarian, {
      [`GET /log?from=${weekAgo}&limit=50`]: page([entry()], 40),
      [`GET /log?from=${weekAgo}&limit=50&before=40`]: page([
        entry({ id: 12, action: 'title.create', entity: 'title', entityId: '5' }),
      ]),
    });
    renderApp('/log');
    await userEvent.click(await screen.findByRole('button', { name: 'Show older' }));
    expect(await screen.findByText('Title added')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older' })).not.toBeInTheDocument();
    expect(requested(calls)).toHaveLength(2);
  });

  it('asks only when Show is pressed, and narrows to a person or a record from the list', async () => {
    const { calls } = signedIn(superAdmin, {
      [`GET /log?from=${weekAgo}&limit=50`]: page([entry()]),
      [`GET /log?from=${weekAgo}&role=system&branchId=2&limit=50`]: page([]),
      [`GET /log?from=${weekAgo}&actorId=2&role=system&branchId=2&limit=50`]: page([]),
      [`GET /log?from=${weekAgo}&limit=50&action=borrow`]: page([]),
    });
    renderApp('/log');
    await screen.findAllByTestId('log-entry');

    await userEvent.selectOptions(screen.getByLabelText('Role'), 'system');
    await userEvent.selectOptions(screen.getByLabelText('Branch'), '2');
    expect(requested(calls)).toHaveLength(1); // nothing yet
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(await screen.findByText('No entries match.')).toBeInTheDocument();
    expect(requested(calls).at(-1)).toBe(
      `GET /log?from=${weekAgo}&role=system&branchId=2&limit=50`,
    );

    await userEvent.type(screen.getByLabelText('Person (account number)'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() =>
      expect(requested(calls).at(-1)).toBe(
        `GET /log?from=${weekAgo}&actorId=2&role=system&branchId=2&limit=50`,
      ),
    );
  });

  it('narrows to the record when it is selected in an entry', async () => {
    const { calls } = signedIn(librarian, {
      [`GET /log?from=${weekAgo}&limit=50`]: page([entry()]),
      [`GET /log?from=${weekAgo}&entity=copy&entityId=7&limit=50`]: page([entry()]),
    });
    renderApp('/log');
    await userEvent.click(await screen.findByRole('button', { name: 'Copy #7' }));
    await waitFor(() =>
      expect(requested(calls).at(-1)).toBe(
        `GET /log?from=${weekAgo}&entity=copy&entityId=7&limit=50`,
      ),
    );
    expect(screen.getByLabelText('Record number')).toHaveValue('7');
  });

  it('refuses a backwards date range without asking the server', async () => {
    const { calls } = signedIn(librarian, {
      [`GET /log?from=${weekAgo}&limit=50`]: page([]),
    });
    renderApp('/log');
    await screen.findByText('No entries match.');
    const from = screen.getByLabelText('From');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-11-09');
    await userEvent.type(screen.getByLabelText('To'), '2026-11-01');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(await screen.findByText('The start date is after the end date.')).toBeInTheDocument();
    expect(requested(calls)).toHaveLength(1);
  });

  it('is not offered to members', async () => {
    signedIn(user({ id: 9, userType: 'member', branchId: 1 }), {
      'GET /me/dashboard': { body: { today: todayColombo(), items: [] } },
    });
    renderApp('/log');
    await waitFor(() => expect(screen.queryByText('Activity log')).not.toBeInTheDocument());
  });
});

describe('taking the log away as a file (FR-LOG-08)', () => {
  it('downloads the filter shown, in the chosen format', async () => {
    const createObjectURL = vi.fn(() => 'blob:log');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const { calls } = signedIn(librarian, {
      [`GET /log?from=${weekAgo}&limit=50`]: page([entry()]),
      [`GET /log/export?from=${weekAgo}&format=csv`]: { body: {} },
    });
    renderApp('/log');
    await screen.findAllByTestId('log-entry');
    await userEvent.click(screen.getByRole('button', { name: 'Spreadsheet (CSV)' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(calls.map((c) => c.route)).toContain(`GET /log/export?from=${weekAgo}&format=csv`);
  });

  it('says how many entries matched when a file would be too big', async () => {
    signedIn(librarian, {
      [`GET /log?from=${weekAgo}&limit=50`]: page([entry()]),
      [`GET /log/export?from=${weekAgo}&format=pdf`]: {
        status: 422,
        body: {
          code: 'export_too_large',
          message: 'too many',
          details: { count: 6200, limit: 5000 },
        },
      },
    });
    renderApp('/log');
    await screen.findAllByTestId('log-entry');
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(
      await screen.findByText(
        '6200 entries match, but one file can carry 5000. Narrow the dates or the filter.',
      ),
    ).toBeInTheDocument();
  });
});

describe("a record's history (FR-LOG-09)", () => {
  const loan = {
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
    borrowDate: '2026-11-01',
    dueDate: '2026-11-15',
    originalDueDate: '2026-11-15',
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
  };

  it('reads the log only when the history is opened, since opening it is recorded', async () => {
    const { calls } = signedIn(librarian, {
      'GET /loans/31': { body: loan },
      'GET /log?entity=borrow&entityId=31&limit=20': page([
        entry({
          action: 'borrow.issue',
          entity: 'borrow',
          entityId: '31',
          before: null,
          after: { dueDate: '2026-11-15' },
        }),
      ]),
    });
    renderApp('/loans/31');
    await userEvent.click(await screen.findByRole('button', { name: 'Show history' }));
    expect(requested(calls)).toEqual(['GET /log?entity=borrow&entityId=31&limit=20']);
    expect(await screen.findByText('Book issued')).toBeInTheDocument();
    expect(screen.getByText('dueDate: 2026-11-15')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in the activity log' })).toHaveAttribute(
      'href',
      '/log?entity=borrow&entityId=31',
    );
  });

  it('opens on the log screen with the record already chosen', async () => {
    const { calls } = signedIn(librarian, {
      'GET /log?entity=borrow&entityId=31&limit=50': page([
        entry({ entity: 'borrow', entityId: '31' }),
      ]),
    });
    renderApp('/log?entity=borrow&entityId=31');
    await screen.findAllByTestId('log-entry');
    expect(screen.getByLabelText('Kind of record')).toHaveValue('borrow');
    expect(screen.getByLabelText('Record number')).toHaveValue('31');
    expect(requested(calls)).toEqual(['GET /log?entity=borrow&entityId=31&limit=50']);
  });
});
