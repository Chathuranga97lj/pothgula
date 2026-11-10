import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { parseId } from '../common/validate';
import { sendFile } from '../exports/table-export';
import { ReceiptsService } from './receipts.service';

/** FR-MEM-07: a receipt as a PDF, for staff of the member's branch or the member. */
@Controller('receipts')
@Roles('member', 'admin', 'super_admin')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get('membership/:id')
  async membership(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.receipts.membership(ctx, parseId(id)));
  }

  @Get('settlement/:id')
  async settlement(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.receipts.settlement(ctx, parseId(id)));
  }
}
