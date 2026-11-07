import { describe, expect, it } from 'vitest';
import { splitByScript } from './scripts';

describe('splitByScript', () => {
  it('gives each script its own font', () => {
    expect(splitByScript('Name: ප්‍රියංකා / பொத்குல')).toEqual([
      { text: 'Name: ', font: 'NotoSans' },
      { text: 'ප්‍රියංකා', font: 'NotoSansSinhala' },
      { text: ' / ', font: 'NotoSans' },
      { text: 'பொத்குல', font: 'NotoSansTamil' },
    ]);
  });

  it('keeps the zero-width joiner inside its Sinhala run, so conjuncts shape', () => {
    const runs = splitByScript('ශ්‍රී');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.font).toBe('NotoSansSinhala');
  });

  it('puts spaces between Sinhala words in the Latin font, which has the right width', () => {
    expect(splitByScript('ගම් මඟ').map((r) => r.font)).toEqual([
      'NotoSansSinhala',
      'NotoSans',
      'NotoSansSinhala',
    ]);
  });
});
