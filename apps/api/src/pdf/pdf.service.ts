import { resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { branch, image, library } from '../db/schema';
import { splitByScript } from './scripts';

// pdfmake 0.3 is CommonJS and ships no types for its server entry.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfmake = require('pdfmake') as PdfMake;

interface PdfMake {
  setFonts(fonts: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(policy: (url: string) => boolean): void;
  setLocalAccessPolicy(policy: (path: string) => boolean): void;
  createPdf(doc: object): { getBuffer(): Promise<Buffer> };
}

/** `apps/api/assets/fonts`, from both `src/pdf` and `dist/pdf`. */
export const FONTS_DIR = resolve(__dirname, '../../assets/fonts');

let configured = false;
function configure(): void {
  if (configured) return;
  const f = (file: string) => resolve(FONTS_DIR, file);
  const family = (name: string) => ({
    normal: f(`${name}-Regular.ttf`),
    bold: f(`${name}-Bold.ttf`),
    italics: f(`${name}-Regular.ttf`),
    bolditalics: f(`${name}-Bold.ttf`),
  });
  pdfmake.setFonts({
    NotoSans: family('NotoSans'),
    // The variable font: with the static Sinhala files, fontkit leaves a gap after
    // සු (seen in සුනිල්, සූර්ය). See docs/adr/0001-pdf-engine.md.
    NotoSansSinhala: {
      normal: f('NotoSansSinhala-Variable.ttf'),
      bold: f('NotoSansSinhala-Variable.ttf'),
      italics: f('NotoSansSinhala-Variable.ttf'),
      bolditalics: f('NotoSansSinhala-Variable.ttf'),
    },
    NotoSansTamil: family('NotoSansTamil'),
  });
  // Nothing is ever fetched from outside (NFR-11), and only the fonts are read from disk.
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((path) => resolve(path).startsWith(FONTS_DIR));
  configured = true;
}

/** Text with each script in its own font (Sinhala, Tamil, Latin). */
export function txt(value: string | number | null | undefined, style: object = {}) {
  const text = value === null || value === undefined || value === '' ? '—' : String(value);
  return { text: splitByScript(text).map((r) => ({ text: r.text, font: r.font })), ...style };
}

export interface Branding {
  libraryName: string;
  branchName: string | null;
  /** PNG data URL of the branch logo, else the library logo, else null (FR-BRN-04). */
  logo: string | null;
}

/**
 * The one place PDFs are made (docs/adr/0001-pdf-engine.md): pdfmake in this
 * process, fonts from disk, with the branch's name and logo on every document.
 */
@Injectable()
export class PdfService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async branding(branchId: number | null): Promise<Branding> {
    const [lib] = await this.db.select().from(library).where(eq(library.id, 1));
    const [br] =
      branchId === null ? [] : await this.db.select().from(branch).where(eq(branch.id, branchId));
    const logoId = br?.logoImageId ?? lib?.logoImageId ?? null;
    let logo: string | null = null;
    if (logoId !== null) {
      const [img] = await this.db
        .select({ data: image.data, mimeType: image.mimeType })
        .from(image)
        .where(eq(image.id, logoId));
      if (img && (img.mimeType === 'image/png' || img.mimeType === 'image/jpeg')) {
        logo = `data:${img.mimeType};base64,${img.data.toString('base64')}`;
      }
    }
    return { libraryName: lib?.name ?? 'Pothgula', branchName: br?.branchName ?? null, logo };
  }

  /** A document with the branded header and a footer giving when and by whom it was made. */
  async render(opts: {
    branding: Branding;
    title: string;
    content: object[];
    producedBy: string;
    producedAt: string;
  }): Promise<Buffer> {
    configure();
    const { branding } = opts;
    const doc = {
      pageSize: 'A4',
      pageMargins: [40, 90, 40, 50],
      defaultStyle: { font: 'NotoSans', fontSize: 10, lineHeight: 1.25 },
      info: { title: opts.title, creator: 'Pothgula', producer: 'Pothgula' },
      header: {
        margin: [40, 24, 40, 0],
        columns: [
          ...(branding.logo ? [{ image: branding.logo, fit: [44, 44], width: 52 }] : []),
          {
            stack: [
              txt(branding.libraryName, { fontSize: 13, bold: true, color: '#164537' }),
              txt(branding.branchName, { fontSize: 9, color: '#5c6763' }),
            ],
            margin: [0, 6, 0, 0],
          },
        ],
      },
      footer: (page: number, pages: number) => ({
        margin: [40, 16, 40, 0],
        columns: [
          txt(`${opts.title} · produced ${opts.producedAt} by ${opts.producedBy}`, {
            fontSize: 8,
            color: '#5c6763',
          }),
          { text: `${page} / ${pages}`, alignment: 'right', fontSize: 8, color: '#5c6763' },
        ],
      }),
      content: [
        txt(opts.title, { fontSize: 16, bold: true, margin: [0, 0, 0, 12] }),
        ...opts.content,
      ],
    };
    return pdfmake.createPdf(doc).getBuffer();
  }
}
