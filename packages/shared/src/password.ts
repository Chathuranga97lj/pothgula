/**
 * Password rules (FR-AUT-15): at least eight characters, and not one of the
 * passwords people use most. Checked on both sides: the web form explains, the
 * API decides.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Most-used passwords of eight or more characters, plus obvious local ones.
 * Compared case-insensitively.
 */
const COMMON = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '0123456789',
  '987654321',
  '11111111',
  '00000000',
  '12341234',
  '11223344',
  '12121212',
  '88888888',
  '99999999',
  '87654321',
  '123123123',
  '1q2w3e4r',
  '1qaz2wsx',
  'qwertyui',
  'qwertyuiop',
  'asdfghjk',
  'zxcvbnm1',
  'q1w2e3r4',
  'password',
  'password1',
  'password12',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword',
  'iloveyou',
  'iloveyou1',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'whatever',
  'trustno1',
  'welcome1',
  'welcome123',
  'letmein1',
  'abcd1234',
  'abc12345',
  'abcdefgh',
  'qwerty123',
  'qwerty12',
  'admin123',
  'administrator',
  'changeme',
  'default1',
  'starwars',
  'computer',
  'internet',
  'michelle',
  'jennifer',
  'master123',
  'monkey123',
  'dragon123',
  'shadow123',
  'football1',
  'liverpool',
  'chelsea1',
  'samsung1',
  'iloveu123',
  // Local and project-specific
  'srilanka',
  'srilanka1',
  'srilanka123',
  'colombo1',
  'colombo123',
  'kandy123',
  'galle123',
  'library1',
  'library123',
  'pothgula',
  'pothgula1',
  'pothgula123',
  'books123',
  'mybooks1',
]);

export type PasswordProblem = 'too_short' | 'too_long' | 'too_common' | 'same_as_phone';

/** What is wrong with a proposed password; an empty list means it is acceptable. */
export function passwordProblems(password: string, phone?: string | null): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) problems.push('too_short');
  if (length > PASSWORD_MAX_LENGTH) problems.push('too_long');
  if (COMMON.has(password.toLowerCase())) problems.push('too_common');
  if (phone && password.replace(/\D/g, '') === phone.replace(/\D/g, '') && /\d/.test(password)) {
    problems.push('same_as_phone');
  }
  return problems;
}
