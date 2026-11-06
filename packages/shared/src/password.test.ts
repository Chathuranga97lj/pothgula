import { describe, expect, it } from 'vitest';
import { passwordProblems } from './password.js';

describe('passwordProblems (FR-AUT-15)', () => {
  it('accepts a reasonable password', () => {
    expect(passwordProblems('පොත් කියවමු 2026')).toEqual([]);
    expect(passwordProblems('river-lamp-71')).toEqual([]);
  });

  it('wants at least eight characters, counted as characters not bytes', () => {
    expect(passwordProblems('short1')).toContain('too_short');
    expect(passwordProblems('පොත්ගුල')).toContain('too_short'); // 7 code points
  });

  it('refuses the most common passwords in any case', () => {
    expect(passwordProblems('Password123')).toContain('too_common');
    expect(passwordProblems('12345678')).toContain('too_common');
    expect(passwordProblems('SriLanka123')).toContain('too_common');
  });

  it('refuses the sign-in phone number as the password', () => {
    expect(passwordProblems('0771234567', '0771234567')).toContain('same_as_phone');
    expect(passwordProblems('077-123-4567', '0771234567')).toContain('same_as_phone');
    expect(passwordProblems('0771234568', '0771234567')).toEqual([]);
  });
});
