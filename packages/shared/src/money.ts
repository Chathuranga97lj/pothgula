/**
 * Money is whole cents of LKR, always an integer (NFR-14). Amounts typed by
 * people are parsed from text, never through floating-point arithmetic.
 */

const RUPEES = /^\s*(?:Rs\.?\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*$/i;

/** `'1,250.50'` → `125050`; `'500'` → `50000`. Null if it is not an amount. */
export function parseRupees(input: string): number | null {
  const match = RUPEES.exec(input);
  if (!match) return null;
  const whole = Number(match[1]!.replace(/,/g, ''));
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const total = whole * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

/** `125050` → `'1,250.50'`. */
export function formatRupees(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Not a whole number of cents: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${whole}.${String(abs % 100).padStart(2, '0')}`;
}
