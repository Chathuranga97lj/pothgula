/**
 * Accession numbers (FR-CAT-02): branch code, category code and a five-digit
 * running number, printed with hyphens: `KS-A1-01234`.
 * Staff may type them with or without the hyphens, in either case.
 */

export interface AccessionParts {
  branchCode: string;
  categoryCode: string;
  running: number;
}

export const ACCESSION_MAX = 99_999;

const PRINTED = /^([A-Z]{2})-([A-Z][0-9])-([0-9]{5})$/;
const TYPED = /^([A-Z]{2})-?([A-Z][0-9])-?([0-9]{5})$/;

/** The canonical printed form, e.g. `formatAccession('KS', 'A1', 1234)` → `KS-A1-01234`. */
export function formatAccession(branchCode: string, categoryCode: string, running: number): string {
  if (!/^[A-Z]{2}$/.test(branchCode)) throw new RangeError(`Invalid branch code: ${branchCode}`);
  if (!/^[A-Z][0-9]$/.test(categoryCode)) {
    throw new RangeError(`Invalid category code: ${categoryCode}`);
  }
  if (!Number.isInteger(running) || running < 1 || running > ACCESSION_MAX) {
    throw new RangeError(`Running number must be 1 to ${ACCESSION_MAX}: ${running}`);
  }
  return `${branchCode}-${categoryCode}-${String(running).padStart(5, '0')}`;
}

/**
 * Reads an accession number as a member of staff might type it and returns its
 * parts, or `null` if it is not a valid number.
 */
export function parseAccession(input: string): AccessionParts | null {
  const match = TYPED.exec(input.trim().toUpperCase());
  if (!match) return null;
  const [, branchCode, categoryCode, digits] = match as unknown as [string, string, string, string];
  const running = Number(digits);
  if (running < 1) return null;
  return { branchCode, categoryCode, running };
}

/** Returns the canonical printed form of a typed accession number, or `null`. */
export function normalizeAccession(input: string): string | null {
  const parts = parseAccession(input);
  return parts ? formatAccession(parts.branchCode, parts.categoryCode, parts.running) : null;
}

/** True only for the exact printed form, as stored in the database. */
export function isCanonicalAccession(value: string): boolean {
  return PRINTED.test(value) && !value.endsWith('00000');
}
