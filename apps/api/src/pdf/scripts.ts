/**
 * pdfmake has no automatic font fallback, so mixed-script text is split into
 * runs, each with the font for its script (docs/adr/0001-pdf-engine.md).
 * Joiners stay with their run so conjuncts shape correctly; spaces, digits and
 * punctuation go to the Latin font, whose space is the right width.
 */

export type ScriptFont = 'NotoSans' | 'NotoSansSinhala' | 'NotoSansTamil';

export interface TextRun {
  text: string;
  font: ScriptFont;
}

function scriptOf(cp: number): ScriptFont | 'joiner' | 'neutral' {
  if (cp >= 0x0d80 && cp <= 0x0dff) return 'NotoSansSinhala';
  if (cp >= 0x0b80 && cp <= 0x0bff) return 'NotoSansTamil';
  if (cp === 0x200c || cp === 0x200d) return 'joiner'; // ZWNJ, ZWJ
  return 'NotoSans';
}

export function splitByScript(text: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const ch of text) {
    const kind = scriptOf(ch.codePointAt(0)!);
    const last = runs.at(-1);
    const font: ScriptFont =
      kind === 'joiner' || kind === 'neutral' ? (last?.font ?? 'NotoSans') : kind;
    if (last && last.font === font) last.text += ch;
    else runs.push({ text: ch, font });
  }
  return runs;
}
