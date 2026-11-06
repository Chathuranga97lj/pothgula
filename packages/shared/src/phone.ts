/**
 * Phone numbers are text, never numbers (NFR-15). The WhatsApp number is the
 * sign-in name, so the same number must always be written the same way:
 * spaces, hyphens, dots and brackets are dropped, and a Sri Lankan number with
 * the country code (+94 / 94) is written in the local form with its leading 0.
 */

const STORED = /^\+?[0-9]{9,15}$/;
const SRI_LANKA_INTERNATIONAL = /^\+?94([0-9]{9})$/;

/** The stored form of a typed phone number, or `null` if it is not one. */
export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s\-.()]/g, '');
  const local = SRI_LANKA_INTERNATIONAL.exec(compact);
  const value = local ? `0${local[1]}` : compact;
  return STORED.test(value) ? value : null;
}
