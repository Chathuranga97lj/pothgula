import { expect, test } from '@playwright/test';
import { E2E } from '../fixtures';

/**
 * M8: the old catalogue comes in through the real upload, with a probable
 * duplicate decided, and the new spine labels download (FR-CAT-13, FR-CAT-10).
 */
const FILE = [
  'Old No.,Title,Author,Category,Price',
  'K/101,The Lighthouse Keeper,Anne Fernando,B1,350',
  'K/102,සඳ එළිය,නිරෝෂා පෙරේරා,A1,',
].join('\r\n');

test('a librarian imports the old catalogue', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('WhatsApp number').fill(E2E.librarian.whatsappPhone);
  await page.getByLabel('Password').fill(E2E.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('link', { name: 'Import the old catalogue' }).click();
  await page.getByLabel('The file').setInputFiles({
    name: 'old-catalogue.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('﻿' + FILE, 'utf8'),
  });
  await page.getByRole('button', { name: 'Check the file' }).click();

  await expect(page.getByText('2 rows, making 2 titles')).toBeVisible();
  const importButton = page.getByRole('button', { name: 'Import 2 copies' });
  await expect(importButton).toBeDisabled();
  await page.getByRole('radio', { name: /More copies of The Lighthouse Keeper/ }).check();
  await importButton.click();

  await expect(page.getByText('2 copies imported')).toBeVisible();
  const row = (old: string) => page.getByRole('row').filter({ hasText: old });
  await expect(row('K/101')).toContainText('KS-B1-00002');
  await expect(row('K/102')).toContainText('KS-A1-00004');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Print the spine labels' }).click();
  expect((await download).suggestedFilename()).toBe('spine-labels.pdf');

  await row('K/102').getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'සඳ එළිය' })).toBeVisible();
});
