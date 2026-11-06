import { describe, expect, it } from 'vitest';
import { databaseUrl } from './config';

describe('databaseUrl', () => {
  it('uses DATABASE_URL when set', () => {
    expect(databaseUrl({ DATABASE_URL: 'postgres://x@db/y' })).toBe('postgres://x@db/y');
  });

  it('falls back to the local development database outside production', () => {
    expect(databaseUrl({})).toContain('localhost:5433/pothgula');
  });

  it('refuses to guess in production', () => {
    expect(() => databaseUrl({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });
});
