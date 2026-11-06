import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? 'postgres://pothgula:pothgula-dev-only@localhost:5433/pothgula',
  },
  strict: true,
  verbose: true,
});
