import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeApi, type Route, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';

const superAdmin = user({ id: 1, fullName: 'Chandima', userType: 'super_admin', branchId: null });
const librarian = user({ id: 2, fullName: 'කමල්', userType: 'admin', branchId: 1 });

const settings = {
  loanDays: 14,
  maxBooks: 2,
  maxBooksWhileSettling: 1,
  settlementWindowDays: 100,
  staffDueWarningDays: 5,
  memberDueWarningDays: 5,
  declineGraceDays: 3,
  holdDays: 7,
  applicationStaleDays: 30,
  applicationAnonymiseDays: 90,
  renewalGraceDays: 90,
  frequentLateCount: 3,
  frequentLateMonths: 12,
  annualFeeCents: 50_000,
  logRetentionMonths: 24,
};
const ks = {
  id: 1,
  code: 'KS',
  name: 'Kesbewa',
  address: '12 Temple Road',
  phone: '0112000001',
  logoImageId: null,
  codeLocked: true,
  settings,
};

function signedInAs(me: object, extra: Record<string, Route> = {}) {
  localStorage.setItem(TOKEN_KEY, 'tok');
  return fakeApi({
    'GET /auth/me': { body: { user: me, warnings: [] } },
    'GET /library': { body: { name: 'කැස්බෑව පුස්තකාලය', logoImageId: 5 } },
    'GET /branches': { body: [{ id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null }] },
    'GET /branches/1': { body: ks },
    ...extra,
  });
}

describe('branding (FR-BRN-04)', () => {
  it("shows the library's name and logo when the home branch has none", async () => {
    signedInAs(librarian);
    renderApp('/');
    expect(await screen.findByText('කැස්බෑව පුස්තකාලය')).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector('header img')?.getAttribute('src')).toBe(
        '/api/images/5?size=thumb',
      ),
    );
  });

  it('shows the library name and logo on the sign-in page', async () => {
    fakeApi({ 'GET /library': { body: { name: 'කැස්බෑව පුස්තකාලය', logoImageId: 5 } } });
    renderApp('/sign-in');
    expect(await screen.findByRole('heading', { name: 'කැස්බෑව පුස්තකාලය' })).toBeInTheDocument();
  });
});

describe('branches (FR-BRN-01 – FR-BRN-03, FR-MEM-06)', () => {
  it('lets a super admin add a branch and opens it', async () => {
    const created = { ...ks, id: 3, code: 'GL', name: 'Galle', codeLocked: false };
    const api = signedInAs(superAdmin, {
      'POST /branches': { status: 201, body: created },
      'GET /branches/3': { body: created },
    });
    renderApp('/branches');
    await userEvent.click(await screen.findByRole('button', { name: 'Add a branch' }));
    const form = screen.getByRole('heading', { name: 'New branch' }).closest('form')!;
    await userEvent.type(within(form).getByLabelText('Branch name'), 'Galle');
    await userEvent.type(within(form).getByLabelText('Branch code'), 'gl');
    await userEvent.type(within(form).getByLabelText('Address'), '5 Fort Street');
    await userEvent.type(within(form).getByLabelText('Phone'), '091 200 0002');
    await userEvent.click(within(form).getByRole('button', { name: 'Create branch' }));

    expect(await screen.findByRole('heading', { name: /Galle/ })).toBeInTheDocument();
    expect(api.calls.find((c) => c.route === 'POST /branches')?.body).toEqual({
      branchName: 'Galle',
      branchCode: 'GL',
      address: '5 Fort Street',
      phone: '0912000002',
    });
  });

  it('explains that a code printed on books cannot change', async () => {
    signedInAs(superAdmin);
    renderApp('/branches/1');
    const code = await screen.findByLabelText('Branch code');
    expect(code).toBeDisabled();
    expect(
      screen.getByText('Books already carry this code, so it can no longer change.'),
    ).toBeInTheDocument();
  });

  it('sends only the settings that changed, with the fee in whole cents', async () => {
    const api = signedInAs(superAdmin, {
      'PATCH /branches/1/settings': (body) => ({
        body: { ...ks, settings: { ...settings, ...(body as object) } },
      }),
    });
    renderApp('/branches/1');
    const fee = await screen.findByLabelText('Annual fee');
    expect(fee).toHaveValue('500.00');
    await userEvent.clear(fee);
    await userEvent.type(fee, '750.50');
    const loan = screen.getByLabelText('Loan period (days)');
    await userEvent.clear(loan);
    await userEvent.type(loan, '21');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findAllByText('Saved.')).not.toHaveLength(0);
    expect(api.calls.find((c) => c.route === 'PATCH /branches/1/settings')?.body).toEqual({
      annualFeeCents: 75_050,
      loanDays: 21,
    });
    expect(screen.getByLabelText('Annual fee')).toHaveValue('750.50');
  });

  it('refuses a fee that is not an amount before sending it', async () => {
    const api = signedInAs(superAdmin);
    renderApp('/branches/1');
    const fee = await screen.findByLabelText('Annual fee');
    await userEvent.clear(fee);
    await userEvent.type(fee, '5,00.0x');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '"Annual fee" is not a valid number.',
    );
    expect(api.calls.some((c) => c.route.startsWith('PATCH'))).toBe(false);
  });

  it('shows a librarian the branch without anything to change', async () => {
    signedInAs(librarian);
    renderApp('/branches/1');
    expect(await screen.findByLabelText('Annual fee')).toBeDisabled();
    expect(screen.getByLabelText('Branch name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /logo/i })).not.toBeInTheDocument();
  });
});

describe('logos (FR-BRN-04, NFR-16)', () => {
  it('uploads the chosen image as a file, and refuses other types before sending', async () => {
    const api = signedInAs(superAdmin, {
      'POST /branches/1/logo': { body: { ...ks, logoImageId: 9 } },
    });
    renderApp('/branches/1');
    const input = await screen.findByLabelText('Add a logo');

    await userEvent.upload(input, new File(['GIF89a'], 'x.gif', { type: 'image/gif' }), {
      applyAccept: false,
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PNG, JPEG or WebP image.');

    const png = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
    await userEvent.upload(input, png);
    await waitFor(() =>
      expect(api.calls.some((c) => c.route === 'POST /branches/1/logo')).toBe(true),
    );
    const sent = api.calls.find((c) => c.route === 'POST /branches/1/logo')!.body as FormData;
    expect(sent).toBeInstanceOf(FormData);
    expect((sent.get('file') as File).name).toBe('logo.png');
    await waitFor(() =>
      expect(document.querySelector('main img')?.getAttribute('src')).toBe('/api/images/9'),
    );
  });
});

describe('categories (FR-BRN-05 – FR-BRN-07)', () => {
  it('adds, and retires, categories', async () => {
    const list = [{ code: 'A1', name: 'Sinhala novels', isActive: true, inUse: true }];
    const api = signedInAs(superAdmin, {
      'GET /categories': () => ({ body: list }),
      'POST /categories': (body) => {
        list.push({ ...(body as { code: string; name: string }), isActive: true, inUse: false });
        return { status: 201, body: list.at(-1) };
      },
      'POST /categories/C1/retire': () => {
        list[1] = { ...list[1]!, isActive: false };
        return { body: list[1] };
      },
    });
    renderApp('/categories');
    expect(await screen.findByText('Sinhala novels')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Code'), 'c1');
    await userEvent.type(screen.getByLabelText('Name'), 'Tamil novels');
    await userEvent.click(screen.getByRole('button', { name: 'Add category' }));
    expect(api.calls.find((c) => c.route === 'POST /categories')?.body).toEqual({
      code: 'C1',
      name: 'Tamil novels',
    });

    const row = (await screen.findByText('Tamil novels')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Retire' }));
    expect(await within(row).findByText('Retired')).toBeInTheDocument();
  });

  it('will not offer to change a code that is in use', async () => {
    signedInAs(superAdmin, {
      'GET /categories': {
        body: [{ code: 'A1', name: 'Sinhala novels', isActive: true, inUse: true }],
      },
    });
    renderApp('/categories');
    const row = (await screen.findByText('Sinhala novels')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    const codes = screen.getAllByLabelText('Code');
    expect(codes.at(-1)).toBeDisabled();
  });
});
