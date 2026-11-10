import { describe, expect, it } from 'vitest';
import { displayWidth, toCsv } from './table-export';

describe('toCsv (FR-LOG-08, FR-RPT-09)', () => {
  it('starts with a byte-order mark and ends lines with CRLF', () => {
    expect(
      toCsv([
        ['a', 1],
        ['b', null],
      ]),
    ).toBe('\uFEFFa,1\r\nb,\r\n');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(toCsv([['x, y', 'say "hi"', 'one\ntwo']])).toBe(
      '\uFEFF"x, y","say ""hi""","one\ntwo"\r\n',
    );
  });

  it('keeps typed text from running as a spreadsheet formula, but leaves numbers alone', () => {
    expect(toCsv([['=1+2', '+94', '-x', '@SUM(A1)', -500]])).toBe(
      "\uFEFF'=1+2,'+94,'-x,'@SUM(A1),-500\r\n",
    );
  });

  it('keeps Sinhala and Tamil as written', () => {
    expect(toCsv([['කලියුගය', 'தமிழ்']])).toBe('\uFEFFකලියුගය,தமிழ்\r\n');
  });
});

describe('displayWidth', () => {
  it('counts a Sinhala cluster as one character', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('ශ්‍රී')).toBeLessThan('ශ්‍රී'.length);
  });
});
