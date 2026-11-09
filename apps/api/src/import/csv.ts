/**
 * A small RFC 4180 reader for the catalogue import: quoted fields, doubled
 * quotes, line breaks inside quotes, CRLF or LF, and a UTF-8 byte-order mark.
 * Excel saves with a comma, or a semicolon in some regional settings, or a tab
 * for "Unicode text"; the separator is taken from the heading row.
 */

export class NotUtf8Error extends Error {}

/** The file's text, refusing anything that is not valid UTF-8 (FR-CAT-13, NFR-04). */
export function decodeUtf8(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    throw new NotUtf8Error('The file is not UTF-8 text');
  }
}

function separatorOf(text: string): string {
  const first = text.slice(0, text.search(/\r?\n|$/));
  let best = ',';
  let most = -1;
  for (const sep of [',', ';', '\t']) {
    let count = 0;
    let quoted = false;
    for (const ch of first) {
      if (ch === '"') quoted = !quoted;
      else if (ch === sep && !quoted) count++;
    }
    if (count > most) {
      most = count;
      best = sep;
    }
  }
  return best;
}

/** Each record with the line it starts on (1-based). Blank lines are skipped. */
export function parseCsv(text: string): { line: number; fields: string[] }[] {
  const sep = separatorOf(text);
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;

  const endRecord = () => {
    fields.push(field);
    if (fields.some((f) => f.trim() !== '')) records.push({ line: start, fields });
    fields = [];
    field = '';
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === sep) {
      fields.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else {
      field += ch;
    }
  }
  if (field !== '' || fields.length > 0) endRecord();
  return records;
}
