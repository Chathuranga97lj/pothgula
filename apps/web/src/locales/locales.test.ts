import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** NFR-04: every screen string exists in every language, with the same placeholders. */

type Tree = { [key: string]: string | Tree };
const files = import.meta.glob<Tree>('./*.json', { eager: true, import: 'default' });
const locales = Object.fromEntries(
  Object.entries(files).map(([path, tree]) => [path.replace(/^\.\/(\w+)\.json$/, '$1'), tree]),
);

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out.set(prefix + k, v);
    else for (const [kk, vv] of flatten(v, `${prefix}${k}.`)) out.set(kk, vv);
  }
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const en = flatten(locales.en!);

describe.each(Object.keys(locales).filter((c) => c !== 'en'))('the %s translation', (code) => {
  const other = flatten(locales[code]!);

  it('has exactly the English keys', () => {
    expect([...other.keys()].filter((k) => !en.has(k))).toEqual([]);
    expect([...en.keys()].filter((k) => !other.has(k))).toEqual([]);
  });

  it('keeps every placeholder, and leaves nothing untranslated', () => {
    const wrong = [...en].filter(
      ([k, v]) => other.has(k) && placeholders(v).join() !== placeholders(other.get(k)!).join(),
    );
    expect(wrong.map(([k]) => k)).toEqual([]);
    // Empty only where the English is empty too (a setting with no hint).
    const blank = [...other].filter(([k, v]) => v.trim() === '' && en.get(k)?.trim() !== '');
    expect(blank.map(([k]) => k)).toEqual([]);
  });
});

describe('the strings the screens use', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return sources(p);
      return /\.tsx?$/.test(f) && !f.includes('.test.') ? [p] : [];
    });
  }

  it('all exist in English', () => {
    const used = new Set<string>();
    for (const file of sources(join(process.cwd(), 'src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(m[1]!);
    }
    const known = (k: string) => en.has(k) || en.has(`${k}_one`) || en.has(`${k}_other`);
    expect([...used].filter((k) => !known(k))).toEqual([]);
    expect(used.size).toBeGreaterThan(300);
  });
});
