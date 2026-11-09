// NFR-04: the screen text as a spreadsheet for a translator, and back again.
//
//   pnpm --filter @pothgula/web i18n:export si translations-si.csv
//   (the translator corrects the third column in Excel and saves as CSV UTF-8)
//   pnpm --filter @pothgula/web i18n:import si translations-si.csv
//
// A new language works the same way: `i18n:export ta …` gives an empty third
// column, and importing it creates src/locales/ta.json (docs/translating.md).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LOCALES = fileURLToPath(new URL('../src/locales/', import.meta.url));
const [command, code, file] = process.argv.slice(2);
if (!['export', 'import'].includes(command) || !/^[a-z]{2,3}$/.test(code ?? '') || !file) {
  console.error('Usage: translations.mjs export|import <language code> <file.csv>');
  process.exit(2);
}

const read = (c) => JSON.parse(readFileSync(`${LOCALES}${c}.json`, 'utf8'));
const flatten = (tree, prefix = '') =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefix + k, v]] : flatten(v, `${prefix}${k}.`),
  );
const placeholders = (s) =>
  [...s.matchAll(/\{\{(\w+)\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join();

const en = flatten(read('en'));
const target = existsSync(`${LOCALES}${code}.json`) ? new Map(flatten(read(code))) : new Map();

const cell = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

if (command === 'export') {
  const lines = [['key', 'english', code].join(',')];
  for (const [key, english] of en)
    lines.push([key, english, target.get(key) ?? ''].map(cell).join(','));
  // The byte-order mark makes Excel read the file as UTF-8.
  writeFileSync(file, `\uFEFF${lines.join('\r\n')}\r\n`);
  console.log(`Wrote ${en.length} strings to ${file}.`);
  process.exit(0);
}

// ─── import ──────────────────────────────────────────────────────────────────

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const [heading, ...rows] = parseCsv(text);
if (heading?.[0] !== 'key' || heading.length < 3) {
  console.error('The first row must be: key, english, translation (as exported).');
  process.exit(1);
}

const english = new Map(en);
const problems = [];
let changed = 0;
for (const [key, , value = ''] of rows) {
  if (!english.has(key)) {
    problems.push(`${key}: no such string (renamed or removed); skipped`);
    continue;
  }
  const v = value.normalize('NFC');
  if (v.trim() === '') continue;
  if (placeholders(v) !== placeholders(english.get(key))) {
    problems.push(`${key}: the {{…}} names must stay as in English; skipped`);
    continue;
  }
  if (target.get(key) !== v) changed++;
  target.set(key, v);
}

// Rebuild in the English order, so the file stays easy to compare.
const tree = {};
let missing = 0;
for (const [key, en] of english) {
  const value = target.get(key) ?? (en === '' ? '' : undefined);
  if (value === undefined) {
    missing++;
    continue;
  }
  const parts = key.split('.');
  let node = tree;
  for (const p of parts.slice(0, -1)) node = node[p] ??= {};
  node[parts.at(-1)] = value;
}
writeFileSync(`${LOCALES}${code}.json`, `${JSON.stringify(tree, null, 2)}\n`);
console.log(`${changed} strings changed in src/locales/${code}.json.`);
if (missing) console.log(`${missing} strings still untranslated; English is shown for them.`);
for (const p of problems) console.log(`  ${p}`);
