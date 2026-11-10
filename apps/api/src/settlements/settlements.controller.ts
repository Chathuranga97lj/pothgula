import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  copyFoundSchema,
  declareLostSchema,
  EXPORT_FORMATS,
  type ExportFormat,
  extendSettlementSchema,
  type LostQuote,
  reduceSettlementSchema,
  reverseSettlementPaymentSchema,
  saveTariffSchema,
  type Settlement,
  type SettlementBoard,
  settlementPaymentSchema,
  settlementReplacementSchema,
  type Tariff,
  todayColombo,
  waiveSettlementSchema,
} from '@pothgula/shared';
import type { Response } from 'express';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { parseBody, parseId } from '../common/validate';
import { optionalBranchId } from '../dashboard/dashboard.service';
import { renderTable, sendFile } from '../exports/table-export';
import { PdfService } from '../pdf/pdf.service';
import { SettlementsService } from './settlements.service';
import { TariffsService } from './tariffs.service';

/** §9, staff side. Branch scope is checked in the service. */
@Controller()
@Roles('admin', 'super_admin')
export class SettlementsController {
  constructor(
    private readonly settlements: SettlementsService,
    private readonly tariffs: TariffsService,
    private readonly pdf: PdfService,
  ) {}

  /** FR-LST-02: the tariff amount and window a declaration would set. */
  @Get('loans/:id/lost')
  quote(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<LostQuote> {
    return this.settlements.quote(ctx, parseId(id));
  }

  /** FR-LST-01, FR-LST-02: declare the copy on an open loan lost or damaged beyond use. */
  @Post('loans/:id/lost')
  declare(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Settlement> {
    return this.settlements.declare(ctx, parseId(id), parseBody(declareLostSchema, body));
  }

  /** FR-LST-10: open settlements per branch, windows passed first. */
  @Get('settlements')
  board(@Auth() ctx: AuthContext, @Query('branchId') branchId?: string): Promise<SettlementBoard> {
    return this.settlements.board(ctx, optionalBranchId(branchId));
  }

  @Get('settlements/:id')
  detail(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Settlement> {
    return this.settlements.detail(ctx, parseId(id));
  }

  /** FR-LST-07: payment of the amount due, with its receipt number. */
  @Post('settlements/:id/pay')
  @HttpCode(200)
  pay(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.settlements.pay(ctx, parseId(id), parseBody(settlementPaymentSchema, body));
  }

  /** FR-LST-05, FR-LST-06: a copy of the same title accepted as the replacement. */
  @Post('settlements/:id/replace')
  @HttpCode(200)
  replace(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.settlements.replace(
      ctx,
      parseId(id),
      parseBody(settlementReplacementSchema, body ?? {}),
    );
  }

  /** FR-LST-09 (super admin, checked in the service). */
  @Post('settlements/:id/waive')
  @HttpCode(200)
  waive(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.settlements.waive(ctx, parseId(id), parseBody(waiveSettlementSchema, body).reason);
  }

  @Post('settlements/:id/reduce')
  @HttpCode(200)
  reduce(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.settlements.reduce(ctx, parseId(id), parseBody(reduceSettlementSchema, body));
  }

  @Post('settlements/:id/extend')
  @HttpCode(200)
  extend(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.settlements.extend(ctx, parseId(id), parseBody(extendSettlementSchema, body));
  }

  /** FR-LST-07, FR-LST-12: a reversing entry, for a mistake or a refund (super admin). */
  @Post('settlements/:id/payments/:paymentId/reverse')
  @HttpCode(200)
  reverse(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() body: unknown,
  ) {
    return this.settlements.reversePayment(
      ctx,
      parseId(id),
      parseId(paymentId),
      parseBody(reverseSettlementPaymentSchema, body).reason,
    );
  }

  /** FR-LST-12: a copy recorded as missing is back (super admin). */
  @Post('copies/:id/found')
  @HttpCode(200)
  found(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.settlements.found(ctx, parseId(id), parseBody(copyFoundSchema, body).reason);
  }

  /** FR-LST-13: every settlement a member has had. */
  @Get('members/:id/settlements')
  forMember(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Settlement[]> {
    return this.settlements.forMember(ctx, parseId(id));
  }

  // ─── The tariff (FR-LST-16) ────────────────────────────────────────────────

  @Get('branches/:id/tariff')
  tariff(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Tariff> {
    return this.tariffs.get(ctx, parseId(id));
  }

  @Patch('branches/:id/tariff')
  saveTariff(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Tariff> {
    return this.tariffs.save(ctx, parseId(id), parseBody(saveTariffSchema, body));
  }

  /** The current tariff, to print for the counter. */
  @Get('branches/:id/tariff/export')
  async exportTariff(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Query('format') format: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
      throw AppError.badRequest('invalid_request', 'format must be txt, csv or pdf');
    }
    const { tariff, table } = await this.tariffs.table(ctx, parseId(id));
    const today = todayColombo();
    sendFile(
      res,
      await renderTable(this.pdf, table, format as ExportFormat, {
        branding: await this.pdf.branding(tariff.branch.id),
        producedBy: ctx.user.fullName,
        producedAt: today,
        filename: `lost-book-tariff-${tariff.branch.code}-${today}`,
      }),
    );
  }
}

/** §9, member side: their own settlements (FR-LST-03, FR-LST-13). */
@Controller('me/settlements')
@Roles('member')
export class OwnSettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get()
  mine(@Auth() ctx: AuthContext): Promise<Settlement[]> {
    return this.settlements.mine(ctx);
  }
}
