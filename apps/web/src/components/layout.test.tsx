import { todayColombo } from '@pothgula/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeApi, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';
const today = todayColombo();
const branches = [{ id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null }];

function signedIn(me: object) {
  localStorage.setItem(TOKEN_KEY, 'tok');
  return fakeApi({
    'GET /auth/me': { body: { user: me, warnings: [] } },
    'GET /library': { body: { name: 'Library', logoImageId: null } },
    'GET /branches': { body: branches },
    'GET /dashboard': { body: { today, monthEnd: today, branches: [] } },
    'GET /me/dashboard': { body: { today, items: [] } },
    'GET /categories': { body: [] },
  });
}

const nav = async () => screen.findByRole('navigation', { name: 'Main' });
const names = (el: HTMLElement) =>
  within(el)
    .getAllByRole('link')
    .map((l) => l.textContent);

describe('the main navigation', () => {
  it('keeps a member’s five links in one row, with no More', async () => {
    signedIn(user({ id: 9, userType: 'member', branchId: 1 }));
    renderApp('/catalogue');
    const n = await nav();
    expect(names(n)).toEqual([
      'Home',
      'Hours and notices',
      'Catalogue',
      'My membership',
      'Change password',
    ]);
    expect(within(n).queryByRole('button', { name: /More/ })).not.toBeInTheDocument();
  });

  it('gives staff the everyday screens in the row and the rest in More, in groups', async () => {
    signedIn(user({ id: 1, userType: 'super_admin', branchId: null }));
    renderApp('/');
    const n = await nav();
    expect(names(n)).toEqual([
      'Home',
      'Counter',
      'Due books',
      'Members',
      'Catalogue',
      'Requests',
      'Lost books',
    ]);
    const more = within(n).getByRole('button', { name: /More/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(within(n).getByText('Set-up')).toBeInTheDocument();
    expect(names(n).slice(7)).toEqual([
      'Hours and notices',
      'Reports',
      'Activity log',
      'Branches',
      'Categories',
      'Staff',
      'Change password',
    ]);
  });

  it('closes on Escape, giving the focus back, and on a choice', async () => {
    signedIn(user({ id: 2, userType: 'admin', branchId: 1 }));
    renderApp('/');
    const n = await nav();
    const more = within(n).getByRole('button', { name: /More/ });
    await userEvent.click(more);
    await userEvent.keyboard('{Escape}');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveFocus();
    await userEvent.click(more);
    await userEvent.click(within(n).getByRole('link', { name: 'Categories' }));
    expect(more).toHaveAttribute('aria-expanded', 'false');
    // Where the person is now is inside More, so More says so.
    expect(more).toHaveClass('bg-emerald-50');
  });
});
