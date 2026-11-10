import { Controller, Get, Query, Res } from '@nestjs/common';
import { EXPORT_FORMATS, type LogPage, logFilterSchema, logQuerySchema } from '@pothgula/shared';
import type { Response } from 'express';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { parseBody } from '../common/validate';
import { sendFile } from '../exports/table-export';
import { LogService } from './log.service';

/** §14: the log screen and the history tab of every record. */
@Controller('log')
@Roles('admin', 'super_admin')
export class LogController {
  constructor(private readonly log: LogService) {}

  /** FR-LOG-06, FR-LOG-07, FR-LOG-09: one page, newest first. */
  @Get()
  page(@Auth() ctx: AuthContext, @Query() query: Record<string, unknown>): Promise<LogPage> {
    const filter = parseBody(logFilterSchema, query);
    const { before, limit } = parseBody(logQuerySchema, query);
    return this.log.page(ctx, filter, { before, limit });
  }

  /** FR-LOG-08: the same view as .txt, .csv or PDF. */
  @Get('export')
  async export(
    @Auth() ctx: AuthContext,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const format = query.format;
    if (!EXPORT_FORMATS.includes(format as never)) {
      throw AppError.badRequest('invalid_request', 'format must be txt, csv or pdf');
    }
    const filter = parseBody(logFilterSchema, query);
    sendFile(res, await this.log.export(ctx, filter, format as (typeof EXPORT_FORMATS)[number]));
  }
}
