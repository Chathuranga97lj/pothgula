import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { passwordProblems } from '@pothgula/shared';
import { AppError } from '../common/app-error';

/**
 * argon2id with the library's defaults — 19 MiB, 2 passes, 1 lane — which are
 * the OWASP recommendation (NFR-06). Passwords are never stored or logged in
 * any other form (FR-AUT-02).
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false; // a malformed stored hash never matches
  }
}

/**
 * Hashed once, used to spend the same time on an unknown phone number as on a
 * known one, so sign-in timing does not reveal which numbers have accounts.
 */
let dummyHash: Promise<string> | undefined;
export async function burnVerifyTime(password: string): Promise<void> {
  dummyHash ??= hash('pothgula-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}

/** Refuses a new password that breaks FR-AUT-15, with the reasons. */
export function assertAcceptablePassword(password: string, phone?: string | null): void {
  const problems = passwordProblems(password, phone);
  if (problems.length > 0) {
    throw AppError.unprocessable(
      'password_not_acceptable',
      'Choose a password of at least eight characters that is not a common one.',
      { problems },
    );
  }
}

/** Letters and digits that cannot be mistaken for one another when read aloud or copied. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A temporary password shown once at the counter (FR-AUT-12), e.g. `k7mq-x3vt-9hpa`. */
export function generateTemporaryPassword(): string {
  const group = () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}
