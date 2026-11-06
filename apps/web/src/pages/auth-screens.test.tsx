import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeApi, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';

describe('sign-in (FR-AUT-01, FR-AUT-02)', () => {
  it('sends someone not signed in to the sign-in page, which has no role choice', async () => {
    fakeApi({});
    renderApp('/staff');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('WhatsApp number')).toBeInTheDocument();
    expect(screen.queryByText(/super admin/i)).not.toBeInTheDocument();
  });

  it('explains a failed sign-in in plain words', async () => {
    fakeApi({
      'POST /auth/sign-in': {
        status: 401,
        body: { code: 'invalid_credentials', message: 'x' },
      },
    });
    renderApp('/sign-in');
    await userEvent.type(screen.getByLabelText('WhatsApp number'), '077 123 4567');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-one');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That WhatsApp number and password do not match.',
    );
  });

  it('says how long to wait when the account is locked', async () => {
    fakeApi({
      'POST /auth/sign-in': {
        status: 401,
        body: { code: 'account_locked', message: 'x', details: { retryAfterSeconds: 840 } },
      },
    });
    renderApp('/sign-in');
    await userEvent.type(screen.getByLabelText('WhatsApp number'), '0771234567');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 14 minutes');
  });

  it('signs in, keeps the token, and sends it with every request', async () => {
    const api = fakeApi({
      'POST /auth/sign-in': { body: { token: 'tok-123', user: user() } },
      'GET /auth/me': { body: { user: user(), warnings: [] } },
    });
    renderApp('/sign-in');
    await userEvent.type(screen.getByLabelText('WhatsApp number'), '0771234567');
    await userEvent.type(screen.getByLabelText('Password'), 'river-lamp-71');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Welcome, නිමල් පෙරේරා' }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-123');
    const me = api.calls.find((c) => c.route === 'GET /auth/me');
    expect(me?.authorization).toBe('Bearer tok-123');
  });

  it('returns to the sign-in page when the session has ended elsewhere', async () => {
    localStorage.setItem(TOKEN_KEY, 'expired');
    fakeApi({
      'GET /auth/me': { status: 401, body: { code: 'not_signed_in', message: 'x' } },
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('shows the sign-in page in Sinhala', async () => {
    fakeApi({});
    renderApp('/sign-in');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'si');
    expect(await screen.findByRole('heading', { name: 'ඇතුළු වන්න' })).toBeInTheDocument();
    expect(screen.getByLabelText('WhatsApp අංකය')).toBeInTheDocument();
  });
});

describe('temporary password (FR-AUT-12, FR-AUT-15)', () => {
  it('makes the person choose their own password before anything else', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    let mustChange = true;
    const api = fakeApi({
      'GET /auth/me': () => ({
        body: { user: user({ mustChangePassword: mustChange }), warnings: [] },
      }),
      'POST /auth/change-password': () => {
        mustChange = false;
        return { status: 204 };
      },
    });
    renderApp('/staff');

    expect(await screen.findByText('Choose your own password')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Change password' });
    await userEvent.type(screen.getByLabelText('Current password'), 'k7mq-x3vt-9hpa');
    await userEvent.type(screen.getByLabelText('New password'), 'password123');
    await userEvent.type(screen.getByLabelText('New password again'), 'password123');
    expect(screen.getByText('Not a commonly used password')).toHaveClass('text-red-700');
    expect(submit).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.clear(screen.getByLabelText('New password again'));
    await userEvent.type(screen.getByLabelText('New password'), 'blue-kite-under-trees');
    await userEvent.type(screen.getByLabelText('New password again'), 'blue-kite-under-trees');
    await userEvent.click(submit);

    expect(await screen.findByRole('heading', { name: /^Welcome/ })).toBeInTheDocument();
    expect(api.calls.find((c) => c.route === 'POST /auth/change-password')?.body).toEqual({
      currentPassword: 'k7mq-x3vt-9hpa',
      newPassword: 'blue-kite-under-trees',
    });
  });
});

describe('staff screen (FR-AUT-05, FR-AUT-09, FR-AUT-11, FR-AUT-14)', () => {
  const superAdmin = user({ id: 1, fullName: 'Chandima', userType: 'super_admin', branchId: null });
  const librarian = {
    id: 2,
    fullName: 'කමල් බණ්ඩාර',
    userType: 'admin',
    status: 'active',
    branchId: 1,
    whatsappPhone: '0775550101',
    mustChangePassword: false,
    lockedUntil: null,
  };

  function staffApi(extra: Record<string, unknown> = {}) {
    localStorage.setItem(TOKEN_KEY, 'tok');
    return fakeApi({
      'GET /auth/me': { body: { user: superAdmin, warnings: ['fewer_than_two_super_admins'] } },
      'GET /staff': {
        body: [{ ...superAdmin, lockedUntil: null, whatsappPhone: '0770001111' }, librarian],
      },
      'GET /branches': { body: [{ id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null }] },
      ...(extra as Record<string, never>),
    });
  }

  it('warns a lone super admin on the home screen', async () => {
    staffApi();
    renderApp('/');
    expect(await screen.findByText('Only one super admin')).toBeInTheDocument();
  });

  it('adds a librarian and shows the temporary password once', async () => {
    const api = staffApi({
      'POST /staff': {
        status: 201,
        body: {
          user: {
            ...librarian,
            id: 3,
            fullName: 'සුනීතා',
            whatsappPhone: '0775550199',
            mustChangePassword: true,
          },
          temporaryPassword: 'k7mq-x3vt-9hpa',
        },
      },
    });
    renderApp('/staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Add staff member' }));
    const form = screen.getByRole('heading', { name: 'New staff member' }).closest('form')!;
    await userEvent.type(within(form).getByLabelText('Full name'), 'සුනීතා');
    await userEvent.type(within(form).getByLabelText('WhatsApp number'), '077 555 0199');
    await userEvent.selectOptions(within(form).getByLabelText('Branch'), '1');
    await userEvent.click(within(form).getByRole('button', { name: 'Create account' }));

    expect(await screen.findByTestId('temporary-password')).toHaveTextContent('k7mq-x3vt-9hpa');
    expect(api.calls.find((c) => c.route === 'POST /staff')?.body).toEqual({
      fullName: 'සුනීතා',
      whatsappPhone: '0775550199',
      userType: 'admin',
      branchId: 1,
    });

    await userEvent.click(screen.getByRole('button', { name: 'I have handed it over' }));
    expect(screen.queryByTestId('temporary-password')).not.toBeInTheDocument();
  });

  it('asks for a reason before deactivating, and shows the minimum-two refusal', async () => {
    const api = staffApi({
      'POST /users/2/deactivate': {
        status: 409,
        body: { code: 'minimum_super_admins', message: 'x' },
      },
    });
    renderApp('/staff');
    const row = (await screen.findByText('කමල් බණ්ඩාර')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Deactivate' }));
    const confirm = screen.getByRole('button', { name: 'Deactivate account' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Why is/), 'Moved to another library');
    await userEvent.click(confirm);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'At least two super admin accounts must stay active.',
      ),
    );
    expect(api.calls.find((c) => c.route === 'POST /users/2/deactivate')?.body).toEqual({
      reason: 'Moved to another library',
    });
  });

  it('keeps members off the staff screen', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    fakeApi({
      'GET /auth/me': { body: { user: user({ userType: 'member' }), warnings: [] } },
    });
    renderApp('/staff');
    expect(await screen.findByRole('heading', { name: /^Welcome/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();
  });
});
