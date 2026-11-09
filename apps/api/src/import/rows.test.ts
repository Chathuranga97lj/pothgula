import type { ImportGroup } from '@pothgula/shared';
import { describe, expect, it } from 'vitest';
import { resolveDecisions } from './import.service';
import { groupRows, type ImportRow, looseText, readImportFile } from './rows';

const categories = new Map([
  ['A1', true],
  ['B1', true],
]);
const bytes = (text: string) => new TextEncoder().encode(text);

describe('reading the file', () => {
  it('accepts other spellings of the headings and ignores the rest', () => {
    const read = readImportFile(
      bytes('Accession No,Book Title,Author,Category Code,Rs,Rack\nK-12,x,y,a1,250.00,3\n'),
      categories,
    );
    expect(read.ignoredColumns).toEqual(['Accession No', 'Rack']);
    expect(read.rows[0]).toMatchObject({
      title: 'x',
      writer: 'y',
      categoryCode: 'A1',
      priceCents: 25_000,
      oldNumber: null,
    });
  });
});

describe('grouping copies into titles', () => {
  const row = (line: number, over: Partial<ImportRow>): ImportRow => ({
    line,
    oldNumber: null,
    title: 'x',
    writer: null,
    publisher: null,
    isbn: null,
    edition: null,
    categoryCode: 'A1',
    priceCents: null,
    source: null,
    ...over,
  });

  it('ignores case, spacing and punctuation, and groups by ISBN first', () => {
    expect(looseText('  Madol  Doova! ')).toBe('madol doova');
    const { groups } = groupRows([
      row(2, { title: 'Madol Doova', writer: 'M. Wickramasinghe' }),
      row(3, { title: 'madol doova.', writer: 'M Wickramasinghe' }),
      row(4, { title: 'Madol Doova', writer: 'M. Wickramasinghe', edition: '2nd' }),
      row(5, { title: 'Madol Duwa', isbn: '9789550000001' }),
      row(6, { title: 'Madol Doova', isbn: '9789550000001' }),
    ]);
    expect(groups.map((g) => g.rows.map((r) => r.line))).toEqual([[2, 3], [4], [5, 6]]);
  });
});

describe('the review decisions', () => {
  const group = (key: string, over: Partial<ImportGroup> = {}): ImportGroup => ({
    key,
    title: key,
    writer: null,
    publisher: null,
    isbn: null,
    edition: null,
    categoryCode: 'A1',
    lines: [],
    oldNumbers: [],
    candidates: [],
    similarKeys: [],
    ...over,
  });

  it('follows a merge to the group it lands in', () => {
    const groups = [
      group('a', { similarKeys: ['b'] }),
      group('b', { similarKeys: ['a', 'c'] }),
      group('c', { similarKeys: ['b'] }),
    ];
    const targets = resolveDecisions(groups, [
      { key: 'a', action: 'merge', intoKey: 'b' },
      { key: 'b', action: 'merge', intoKey: 'c' },
      { key: 'c', action: 'new' },
    ]);
    expect(targets.get('a')).toEqual({ kind: 'new', rootKey: 'c' });
  });

  it('refuses groups merged into each other', () => {
    const groups = [group('a', { similarKeys: ['b'] }), group('b', { similarKeys: ['a'] })];
    expect(() =>
      resolveDecisions(groups, [
        { key: 'a', action: 'merge', intoKey: 'b' },
        { key: 'b', action: 'merge', intoKey: 'a' },
      ]),
    ).toThrow(/merged into each other/);
  });
});
