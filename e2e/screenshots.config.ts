import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Takes the pictures in the README (`docs/screenshots/`), on the same throwaway
 * database and built apps as the browser tests. Not part of CI:
 * `pnpm screenshots` from the repository root builds first, then runs this.
 */
export default defineConfig({
  ...base,
  testDir: './screenshots',
  reporter: 'list',
  use: {
    ...base.use,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    trace: 'off',
    screenshot: 'off',
  },
  projects: undefined,
});
