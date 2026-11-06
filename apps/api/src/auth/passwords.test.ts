import { passwordProblems } from '@pothgula/shared';
import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword, hashPassword, verifyPassword } from './passwords';

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const stored = await hashPassword('blue-kite-under-trees');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(stored, 'blue-kite-under-trees')).toBe(true);
    expect(await verifyPassword(stored, 'blue-kite-under-tree')).toBe(false);
  });

  it('treats a malformed stored hash as a mismatch, not an error', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('makes readable temporary passwords that pass the password rules', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
      expect(passwordProblems(p)).toEqual([]);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});
