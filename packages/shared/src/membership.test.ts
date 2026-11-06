import { describe, expect, it } from 'vitest';
import { addYears, ageOn } from './dates.js';
import { applicationRequestSchema, areaOf, renewedExpiry } from './membership.js';

describe('addYears / ageOn', () => {
  it('adds a year, and never gains a day from 29 February', () => {
    expect(addYears('2026-11-06', 1)).toBe('2027-11-06');
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
  });

  it('counts whole years of age', () => {
    expect(ageOn('2010-11-07', '2026-11-06')).toBe(15);
    expect(ageOn('2010-11-06', '2026-11-06')).toBe(16);
  });
});

describe('renewedExpiry (FR-MEM-02)', () => {
  it('runs from the old expiry when paid early or within the grace period', () => {
    expect(renewedExpiry('2026-12-31', '2026-12-01', 90)).toBe('2027-12-31');
    expect(renewedExpiry('2026-12-31', '2027-03-31', 90)).toBe('2027-12-31');
  });

  it('starts a new year from payment when paid after the grace period', () => {
    expect(renewedExpiry('2026-01-31', '2026-11-06', 90)).toBe('2027-11-06');
  });

  it('starts from payment when there is no expiry on record', () => {
    expect(renewedExpiry(null, '2026-11-06', 90)).toBe('2027-11-06');
  });
});

describe('areaOf', () => {
  it('takes the last part of the address', () => {
    expect(areaOf('12 Temple Road, Kesbewa')).toBe('Kesbewa');
    expect(areaOf('No. 5,\nගාලු පාර,\nපානදුර')).toBe('පානදුර');
    expect(areaOf(null)).toBeNull();
  });
});

describe('applicationRequestSchema (FR-AUT-03)', () => {
  const valid = {
    fullName: 'නිමාලි සිල්වා',
    address: '12 Temple Road, Kesbewa',
    whatsappPhone: '077 123 4567',
    otherPhone: '',
    dateOfBirth: '1990-04-12',
    organisation: '',
    introducedByName: 'සුනිල් පෙරේරා',
    introducedByPhone: '+94 71 222 3333',
    homeBranchId: 1,
    password: 'river-lamp-71',
    introducerConsent: true,
    privacyAccepted: true,
  };

  it('normalises phones and turns empty optional fields into null', () => {
    expect(applicationRequestSchema.parse(valid)).toMatchObject({
      whatsappPhone: '0771234567',
      introducedByPhone: '0712223333',
      otherPhone: null,
      organisation: null,
    });
  });

  it('requires the introducer phone and consent, the date of birth and the privacy notice', () => {
    const fails = (change: object) =>
      applicationRequestSchema.safeParse({ ...valid, ...change }).success === false;
    expect(fails({ introducedByPhone: '' })).toBe(true);
    expect(fails({ introducerConsent: false })).toBe(true);
    expect(fails({ privacyAccepted: false })).toBe(true);
    expect(fails({ dateOfBirth: '' })).toBe(true);
  });
});
