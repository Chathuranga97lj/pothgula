import { addDays, todayColombo } from '@pothgula/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeApi, type Route, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';
const today = todayColombo();
const branches = [
  { id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null },
  { id: 2, code: 'GL', name: 'Galle', logoImageId: null },
];
const librarian = user({ id: 2, fullName: 'කමල්', userType: 'admin', branchId: 1 });
const memberUser = user({ id: 9, fullName: 'නිමාලි සිල්වා', userType: 'member', branchId: 1 });
const ks = { id: 1, code: 'KS', name: 'Kesbewa' };

const week = (open: string | null, close: string | null) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    weekday === 7 ? { weekday, open: null, close: null } : { weekday, open, close },
  );
const hours = (over: Record<string, unknown> = {}) => ({
  branch: ks,
  configured: true,
  week: week('09:00', '17:00'),
  closures: [],
  today,
  status: { kind: 'open', until: '17:00' },
  ...over,
});
const notice = (over: Record<string, unknown> = {}) => ({
  id: 70,
  kind: 'notice',
  branch: ks,
  title: 'Book fair',
  body: 'Bring a friend. Details at https://example.org/fair',
  imageId: null,
  eventDate: null,
  startTime: null,
  endTime: null,
  venue: null,
  showFrom: null,
  showUntil: null,
  isImportant: false,
  withdrawnAt: null,
  createdByName: 'කමල්',
  createdAt: `${today}T03:00:00.000Z`,
  updatedAt: `${today}T03:00:00.000Z`,
  state: 'shown',
  past: false,
  opened: false,
  ...over,
});

function signedIn(me: object, extra: Record<string, Route> = {}) {
  localStorage.setItem(TOKEN_KEY, 'tok');
  return fakeApi({
    'GET /auth/me': { body: { user: me, warnings: [] } },
    'GET /library': { body: { name: 'Library', logoImageId: null } },
    'GET /branches': { body: branches },
    'GET /me/dashboard': { body: { today, items: [] } },
    ...extra,
  });
}

describe('a member’s home (FR-SCH-03, FR-SCH-04, FR-PUB-04)', () => {
  it('shows the home branch’s hours, today’s status, events and notices', async () => {
    signedIn(memberUser, {
      'GET /branches/1/hours': {
        body: hours({ closures: [{ id: 1, date: addDays(today, 3), reason: 'Poya day' }] }),
      },
      'GET /notices': {
        body: {
          branch: ks,
          notices: [notice()],
          events: [
            notice({
              id: 71,
              kind: 'event',
              title: 'Story hour',
              eventDate: addDays(today, 2),
              startTime: '10:00',
              venue: 'Children’s corner',
            }),
          ],
        },
      },
    });
    renderApp('/');
    expect(await screen.findByText('Open until 5.00 pm')).toBeInTheDocument();
    expect(screen.getByText(/Poya day/)).toBeInTheDocument();
    const events = screen.getByRole('heading', { name: 'Events' }).closest('div')!;
    expect(within(events).getByRole('link', { name: 'Story hour' })).toHaveAttribute(
      'href',
      '/notices/71',
    );
    expect(within(events).getByText(/10\.00 am · Children’s corner/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book fair' })).toBeInTheDocument();
  });

  it('says plainly when the branch is closed today, why, and when it opens', async () => {
    signedIn(memberUser, {
      'GET /branches/1/hours': {
        body: hours({
          status: {
            kind: 'closed',
            reason: 'Stock-taking',
            next: { date: addDays(today, 1), at: '09:00' },
          },
        }),
      },
      'GET /notices': { body: { branch: ks, notices: [], events: [] } },
    });
    renderApp('/');
    expect(await screen.findByText('Closed today: Stock-taking')).toBeInTheDocument();
    expect(screen.getByText(`Opens again ${addDays(today, 1)} at 9.00 am`)).toBeInTheDocument();
  });

  it('opens a notice, with its link going elsewhere safely', async () => {
    signedIn(memberUser, { 'GET /notices/70': { body: notice({ opened: true }) } });
    renderApp('/notices/70');
    const link = await screen.findByRole('link', { name: 'https://example.org/fair' });
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });
});

describe('staff set the hours (FR-SCH-01, FR-SCH-02, FR-SCH-05)', () => {
  const branchDetail = {
    id: 1,
    code: 'KS',
    name: 'Kesbewa',
    address: 'x',
    phone: '0112000001',
    logoImageId: null,
    codeLocked: false,
    settings: {
      loanDays: 14,
      maxBooks: 2,
      maxBooksWhileSettling: 1,
      settlementWindowDays: 100,
      staffDueWarningDays: 5,
      memberDueWarningDays: 5,
      declineGraceDays: 3,
      holdDays: 7,
      transitAlertDays: 7,
      applicationStaleDays: 30,
      applicationAnonymiseDays: 90,
      renewalGraceDays: 90,
      frequentLateCount: 3,
      frequentLateMonths: 12,
      annualFeeCents: 50000,
      logRetentionMonths: 24,
    },
  };

  it('saves the week and closes a run of dates with a reason', async () => {
    const { calls } = signedIn(librarian, {
      'GET /branches/1': { body: branchDetail },
      'GET /branches/1/hours': {
        body: hours({ configured: false, week: week(null, null), status: { kind: 'unknown' } }),
      },
      'PATCH /branches/1/hours': { body: hours() },
      'POST /branches/1/closures': { status: 201, body: hours() },
    });
    renderApp('/branches/1');
    const monday = await screen.findByRole('checkbox', { name: 'Monday' });
    await userEvent.click(monday);
    expect(screen.getByLabelText('Monday opens')).toHaveValue('09:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save the weekly hours' }));
    await waitFor(() =>
      expect(calls.find((c) => c.route === 'PATCH /branches/1/hours')?.body).toEqual({
        week: [
          { weekday: 1, open: '09:00', close: '17:00' },
          ...[2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, open: null, close: null })),
        ],
      }),
    );
    expect(await screen.findByText('Opening hours saved.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('To (optional)'), addDays(today, 2));
    await userEvent.type(screen.getByLabelText('Reason'), 'Stock-taking');
    await userEvent.click(screen.getByRole('button', { name: 'Close the branch' }));
    await waitFor(() =>
      expect(calls.find((c) => c.route === 'POST /branches/1/closures')?.body).toEqual({
        from: today,
        to: addDays(today, 2),
        reason: 'Stock-taking',
      }),
    );
  });
});

describe('staff publish notices (FR-PUB-01, FR-PUB-02, FR-PUB-06)', () => {
  it('writes an event for the admin’s own branch and opens it', async () => {
    const { calls } = signedIn(librarian, {
      'POST /notices': {
        status: 201,
        body: notice({
          id: 72,
          kind: 'event',
          title: 'Story hour',
          eventDate: today,
          startTime: '10:00',
        }),
      },
      'GET /notices/72': {
        body: notice({
          id: 72,
          kind: 'event',
          title: 'Story hour',
          eventDate: today,
          startTime: '10:00',
        }),
      },
    });
    renderApp('/notices/new');
    await userEvent.selectOptions(await screen.findByLabelText('What it is'), 'event');
    expect(screen.getByLabelText('For')).toHaveValue('Your branch');
    await userEvent.type(screen.getByLabelText('Title'), 'Story hour');
    await userEvent.type(screen.getByLabelText('Text'), 'For children under ten.');
    await userEvent.type(screen.getByLabelText('Date'), today);
    await userEvent.type(screen.getByLabelText('Starts'), '10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(calls.find((c) => c.route === 'POST /notices')?.body).toMatchObject({
        kind: 'event',
        branchId: 1,
        title: 'Story hour',
        body: 'For children under ten.',
        eventDate: today,
        startTime: '10:00',
        isImportant: false,
      }),
    );
    expect(await screen.findByRole('heading', { name: /Story hour/ })).toBeInTheDocument();
  });

  it('withdraws one, which is kept and can be shown again', async () => {
    const { calls } = signedIn(librarian, {
      'GET /notices/70': { body: notice() },
      'POST /notices/70/withdraw': {
        body: notice({ withdrawnAt: `${today}T05:00:00.000Z`, state: 'withdrawn' }),
      },
    });
    renderApp('/notices/70');
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    await waitFor(() =>
      expect(calls.some((c) => c.route === 'POST /notices/70/withdraw')).toBe(true),
    );
    expect(
      await screen.findByText('Withdrawn. It is kept and can be shown again.'),
    ).toBeInTheDocument();
  });
});

describe('the member’s panel (FR-NOT-08, FR-PUB-07)', () => {
  it('names a closure this week and an important notice not yet opened', async () => {
    signedIn(memberUser, {
      'GET /me/dashboard': {
        body: {
          today,
          items: [
            {
              kind: 'closure',
              tone: 'warning',
              date: addDays(today, 1),
              reason: 'Poya day',
              branchName: 'Kesbewa',
            },
            {
              kind: 'notice',
              tone: 'info',
              noticeId: 73,
              noticeKind: 'notice',
              title: 'Water leak',
            },
          ],
        },
      },
      'GET /branches/1/hours': { body: hours() },
      'GET /notices': { body: { branch: ks, notices: [], events: [] } },
    });
    renderApp('/');
    expect(
      await screen.findByText(`Kesbewa is closed on ${addDays(today, 1)}`),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Water leak' })).toHaveAttribute('href', '/notices/73');
  });
});
