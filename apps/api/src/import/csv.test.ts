import { describe, expect, it } from 'vitest';
import { decodeUtf8, NotUtf8Error, parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes and line breaks inside quotes', () => {
    const text =
      'title,writer\r\n"Gam, Peraliya","Martin ""M"" Wickramasinghe"\r\n"Two\nlines",x\n';
    expect(parseCsv(text)).toEqual([
      { line: 1, fields: ['title', 'writer'] },
      { line: 2, fields: ['Gam, Peraliya', 'Martin "M" Wickramasinghe'] },
      { line: 3, fields: ['Two\nlines', 'x'] },
    ]);
  });

  it('takes a semicolon or tab separator from the heading row, and skips blank lines', () => {
    expect(parseCsv('title;category\n\nගම් මඟ;A1')).toEqual([
      { line: 1, fields: ['title', 'category'] },
      { line: 3, fields: ['ගම් මඟ', 'A1'] },
    ]);
    expect(parseCsv('title\tcategory\nx\tA1\n')[1]!.fields).toEqual(['x', 'A1']);
  });

  it('keeps empty fields and a last line without a line break', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      { line: 1, fields: ['a', 'b', 'c'] },
      { line: 2, fields: ['1', '', '3'] },
    ]);
  });
});

describe('decodeUtf8', () => {
  it('drops the byte-order mark Excel writes', () => {
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
  });

  it('refuses a file saved in another encoding', () => {
    expect(() => decodeUtf8(new Uint8Array([0x61, 0xe9, 0x62]))).toThrow(NotUtf8Error);
  });
});
