import { Inject, Injectable } from '@nestjs/common';
import { normalizeAccession } from '@pothgula/shared';
import { eq, inArray } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { assertBranchAccess } from '../common/scope';
import type { Db } from '../db/client';
import { DB } from '../db/db.module';
import { copy, title } from '../db/schema';
import { PdfService } from '../pdf/pdf.service';
import { labelsContent } from './labels';

@Injectable()
export class LabelsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly pdf: PdfService,
  ) {}

  /** Labels in the order asked for; every copy must be one the caller's branch holds. */
  async render(ctx: AuthContext, input: string[]): Promise<Buffer> {
    const numbers = input.map((n) => normalizeAccession(n));
    const bad = input.filter((_, i) => numbers[i] === null);
    if (bad.length > 0) {
      throw AppError.badRequest('copy_not_found', 'Not accession numbers.', { numbers: bad });
    }
    const wanted = numbers as string[];
    const found = new Map<
      string,
      { accessionNo: string; title: string; legacyNo: string | null; branchId: number }
    >();
    for (let i = 0; i < wanted.length; i += 5000) {
      const rows = await this.db
        .select({
          accessionNo: copy.accessionNo,
          title: title.title,
          legacyNo: copy.legacyNo,
          branchId: copy.branchId,
        })
        .from(copy)
        .innerJoin(title, eq(title.id, copy.titleId))
        .where(inArray(copy.accessionNo, wanted.slice(i, i + 5000)));
      for (const r of rows) found.set(r.accessionNo, r);
    }
    const missing = wanted.filter((n) => !found.has(n));
    if (missing.length > 0) {
      throw AppError.notFound('copy_not_found', `No copy has the number ${missing[0]}.`);
    }
    for (const b of new Set([...found.values()].map((c) => c.branchId))) {
      assertBranchAccess(ctx.user, b);
    }
    return this.pdf.renderBare({
      title: 'Spine labels',
      pageMargins: [20, 20, 20, 20],
      content: labelsContent(wanted.map((n) => found.get(n)!)),
    });
  }
}
