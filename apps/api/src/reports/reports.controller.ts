import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  EXPORT_FORMATS,
  type ExportFormat,
  REPORT_KINDS,
  type Report,
  type ReportKind,
  reportQuerySchema,
} from '@pothgula/shared';
import type { Response } from 'express';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { parseBody } from '../common/validate';
import { renderTable, sendFile } from '../exports/table-export';
import { PdfService } from '../pdf/pdf.service';
import { ReportsService } from './reports.service';

function kindOf(value: string): ReportKind {
  if (!REPORT_KINDS.includes(value as ReportKind)) {
    throw AppError.notFound('report_not_found', `No report called ${value}.`);
  }
  return value as ReportKind;
}

/** §15: an admin's own branch; a super admin's any branch or the whole library (FR-RPT-10). */
@Controller('reports')
@Roles('admin', 'super_admin')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly pdf: PdfService,
  ) {}

  @Get(':kind')
  report(
    @Auth() ctx: AuthContext,
    @Param('kind') kind: string,
    @Query() query: Record<string, unknown>,
  ): Promise<Report> {
    return this.reports.report(ctx, kindOf(kind), parseBody(reportQuerySchema, query));
  }

  /** FR-RPT-09: the same report as .txt, .csv or PDF. */
  @Get(':kind/export')
  async export(
    @Auth() ctx: AuthContext,
    @Param('kind') kind: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const format = query.format as ExportFormat;
    if (!EXPORT_FORMATS.includes(format)) {
      throw AppError.badRequest('invalid_request', 'format must be txt, csv or pdf');
    }
    const r = await this.reports.report(ctx, kindOf(kind), parseBody(reportQuerySchema, query));
    const wide = r.columns.length > 7;
    const file = await renderTable(
      this.pdf,
      {
        title: r.title,
        about: r.about,
        columns: r.columns.map((c) => ({ header: c.label, numeric: c.numeric })),
        rows: [...r.rows.map((x) => x.cells), ...(r.total ? [r.total] : [])],
        textLayout: 'columns',
        landscape: wide,
        pdfFontSize: wide ? 8 : 9,
      },
      format,
      {
        branding: await this.pdf.branding(r.branch?.branchId ?? null),
        producedBy: ctx.user.fullName,
        producedAt: r.today,
        filename: `report-${r.kind}-${r.branch?.branchCode ?? 'library'}-${r.today}`,
      },
    );
    sendFile(res, file);
  }
}
