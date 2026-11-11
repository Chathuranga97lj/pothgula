import { expect, type Page, test } from '@playwright/test';
import { E2E } from '../fixtures';

/** Every picture in the README, from the demonstration data (invented, NFR-17). */
test.describe.configure({ mode: 'serial' });

const OUT = '../docs/screenshots';

async function signIn(page: Page, phone: string) {
  await page.goto('/sign-in');
  await page.getByLabel('WhatsApp number').fill(phone);
  await page.getByLabel('Password').fill(E2E.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

async function shoot(page: Page, name: string, fullPage = false) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}

test('librarian screens', async ({ page }) => {
  await signIn(page, E2E.librarian.whatsappPhone);
  await expect(page.getByTestId('panel-KS')).toBeVisible();
  await shoot(page, 'staff-home');

  await page.goto('/counter');
  await page.getByLabel('Who is borrowing?').fill(E2E.member.whatsappPhone);
  await page.getByRole('button', { name: new RegExp(E2E.member.fullName) }).click();
  await expect(page.getByRole('heading', { name: E2E.member.fullName })).toBeVisible();
  await page.getByLabel('Book number').fill(E2E.shelfCopy);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Holding an overdue book').first()).toBeVisible();
  await shoot(page, 'counter');

  await page.goto('/due');
  await expect(page.getByText(E2E.member.fullName).first()).toBeVisible();
  await shoot(page, 'due');

  await page.goto('/catalogue');
  await expect(page.getByRole('heading', { name: 'Catalogue' })).toBeVisible();
  await shoot(page, 'catalogue');

  await page.goto('/reports');
  await shoot(page, 'reports');

  await page.goto('/log');
  await shoot(page, 'activity-log');

  // Every screen is also in Sinhala (each test starts a fresh browser, so this does not carry over).
  await page.goto('/catalogue');
  await page.getByLabel('Language').selectOption('si');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeHidden();
  await shoot(page, 'catalogue-sinhala');
});

test('member screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, E2E.member.whatsappPhone);
  await shoot(page, 'member-phone');
});
