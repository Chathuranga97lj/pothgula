import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (not esbuild) so that Nest's decorator metadata is emitted in tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    // No background jobs during tests; they call the job functions directly.
    env: { POTHGULA_JOBS: 'off' },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.db.test.ts'],
        },
      },
      {
        // Integration tests against a real PostgreSQL 17 (Testcontainers), so the
        // database's own rules are what is tested (NFR-10).
        extends: true,
        test: {
          name: 'db',
          include: ['src/**/*.db.test.ts'],
          globalSetup: ['./test/postgres.global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
