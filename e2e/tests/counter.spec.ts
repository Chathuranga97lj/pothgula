import { addDays, todayColombo } from '@pothgula/shared';
import { expect, type Page, test } from '@playwright/test';
import { E2E } from '../fixtures';

/**
 * M6: the counter, end to end. The member starts with a book six days overdue,
 * so they are refused until it comes back (R21); it is taken back with the
 * late notice shown first (FR-CIR-04), and then a book is issued (FR-CIR-01).
 */
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('WhatsApp number').fill(E2E.librarian.whatsappPhone);
  await page.getByLabel('Password').fill(E2E.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

async function pickMember(page: Page) {
  await page.getByLabel('Who is borrowing?').fill(E2E.member.whatsappPhone);
  await page.getByRole('button', { name: new RegExp(E2E.member.fullName) }).click();
  await expect(page.getByRole('heading', { name: E2E.member.fullName })).toBeVisible();
}

/** The page fits the window: nothing scrolls sideways except inside its own box. */
async function expectNoSidewaysScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `page is ${scroll}px wide in a ${client}px window`).toBeLessThanOrEqual(client);
}

test('a librarian refuses, takes back late, then issues', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Counter' }).click();
  await expect(page.getByRole('heading', { name: 'Counter' })).toBeVisible();

  await test.step('the overdue book blocks borrowing', async () => {
    await pickMember(page);
    await expect(page.getByText('Holding an overdue book')).toBeVisible();
    await expect(page.getByTestId('holding')).toHaveText(`1 of ${E2E.maxBooks} books out`);

    // Hyphens may be left out (FR-CAT-02).
    await page.getByLabel('Book number').fill(E2E.shelfCopy.replaceAll('-', '').toLowerCase());
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('This book cannot be issued')).toBeVisible();
    await expect(page.getByText('The member is holding an overdue book')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Issue', exact: true })).toHaveCount(0);
  });

  await test.step('taking it back shows how late it is before confirming', async () => {
    await page.getByRole('tab', { name: 'Take back' }).click();
    await page.getByLabel('Book number').fill(E2E.overdueCopy);
    await page.getByRole('button', { name: 'Find the loan' }).click();

    const callout = page.getByTestId('late-callout');
    await expect(callout).toContainText(`${E2E.overdueDays} days late`);
    await expect(callout).toContainText(addDays(todayColombo(), -E2E.overdueDays));
    await expect(page.getByRole('link', { name: E2E.member.fullName })).toBeVisible();

    await page.getByRole('button', { name: 'Take back', exact: true }).click();
    await expect(page.getByText(`Taken back ${E2E.overdueCopy}`)).toBeVisible();
    await expect(page.getByText(`returned ${E2E.overdueDays} days late`)).toBeVisible();
    await expect(callout).toHaveCount(0);
  });

  await test.step('with the book back, a new one can be issued', async () => {
    await page.getByRole('tab', { name: 'Issue a book' }).click();
    await pickMember(page);
    await expect(page.getByText('Holding an overdue book')).toHaveCount(0);
    await expect(page.getByTestId('holding')).toHaveText(`0 of ${E2E.maxBooks} books out`);

    const due = addDays(todayColombo(), E2E.loanDays);
    await page.getByLabel('Book number').fill(E2E.shelfCopy);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText(`Due back on ${due}.`)).toBeVisible();
    await page.getByRole('button', { name: 'Issue', exact: true }).click();

    await expect(page.getByText(`Issued ${E2E.shelfCopy}`)).toBeVisible();
    await expect(page.getByTestId('holding')).toHaveText(`1 of ${E2E.maxBooks} books out`);
    await expect(page.getByLabel('Book number')).toHaveValue('');
    await expect(page.getByLabel('Book number')).toBeFocused();
  });

  await test.step("the member's record shows both loans", async () => {
    await page.getByRole('link', { name: E2E.member.fullName }).click();
    const rows = page.getByRole('row');
    await expect(rows.filter({ hasText: E2E.shelfCopy })).toContainText('Out');
    await expect(rows.filter({ hasText: E2E.overdueCopy })).toContainText(
      `${E2E.overdueDays} days late`,
    );
  });
});

test('the counter screens fit a 390 px phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expectNoSidewaysScroll(page);

  await page.goto('/counter');
  await pickMember(page);
  await page.getByLabel('Book number').fill('KS-A1-00003');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText(/^Due back on /)).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.goto('/counter?tab=return');
  await page.getByLabel('Book number').fill(E2E.shelfCopy);
  await page.getByRole('button', { name: 'Find the loan' }).click();
  await expect(page.getByRole('button', { name: 'Take back', exact: true })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.getByRole('link', { name: E2E.member.fullName }).click();
  await expect(page.getByRole('heading', { name: E2E.member.fullName })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.getByRole('row').filter({ hasText: E2E.shelfCopy }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Correct this loan' })).toBeVisible();
  await expectNoSidewaysScroll(page);
});
