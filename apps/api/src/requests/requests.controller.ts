import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import {
  acceptBookRequestSchema,
  type BookRequest,
  type BookRequestDetail,
  createBookRequestSchema,
  declineBookRequestSchema,
  dispatchRequestSchema,
  markLostRequestSchema,
  type RequestBoard,
  todayColombo,
} from '@pothgula/shared';
import type { Response } from 'express';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { parseBody, parseId } from '../common/validate';
import { optionalBranchId } from '../dashboard/dashboard.service';
import { sendFile } from '../exports/table-export';
import { PdfService } from '../pdf/pdf.service';
import { RequestsService } from './requests.service';
import { transitSlipContent } from './transit-slip';

/** §8, staff side. Each step checks the branch it happens at, in the service. */
@Controller('requests')
@Roles('admin', 'super_admin')
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly pdf: PdfService,
  ) {}

  /** FR-REQ-09: each branch's requests, by what needs doing. */
  @Get()
  board(@Auth() ctx: AuthContext, @Query('branchId') branchId?: string): Promise<RequestBoard> {
    return this.requests.board(ctx, optionalBranchId(branchId));
  }

  /** FR-REQ-13: one dispatch of any number of copies, out or home. */
  @Post('dispatch')
  @HttpCode(200)
  dispatch(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<BookRequest[]> {
    return this.requests.dispatch(ctx, parseBody(dispatchRequestSchema, body).requestIds);
  }

  /** FR-REQ-13: the transit slip for copies just sent, `?ids=1,2,3`. */
  @Get('slip')
  async slip(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('ids') ids?: string,
  ): Promise<void> {
    const list = (ids ?? '').split(',').filter(Boolean).map(parseId);
    if (list.length === 0 || list.length > 100) {
      throw AppError.badRequest('invalid_request', 'ids must list 1 to 100 requests');
    }
    const requests = await this.requests.forSlip(ctx, list);
    const today = todayColombo();
    const body = await this.pdf.render({
      branding: await this.pdf.branding(ctx.user.branchId),
      title: `Transit slip — ${today}`,
      producedBy: ctx.user.fullName,
      producedAt: today,
      content: transitSlipContent(requests, today),
    });
    sendFile(res, {
      body,
      contentType: 'application/pdf',
      filename: `transit-slip-${today}.pdf`,
    });
  }

  /** FR-REQ-03: the request with its member in full. */
  @Get(':id')
  detail(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<BookRequestDetail> {
    return this.requests.detail(ctx, parseId(id));
  }

  /** FR-REQ-04: accept by choosing the copy to send. */
  @Post(':id/accept')
  @HttpCode(200)
  accept(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.requests.accept(ctx, parseId(id), parseBody(acceptBookRequestSchema, body).copyId);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.requests.decline(
      ctx,
      parseId(id),
      parseBody(declineBookRequestSchema, body).reason,
    );
  }

  /** FR-REQ-05 to FR-REQ-07: record an arrival at either end. */
  @Post(':id/arrive')
  @HttpCode(200)
  arrive(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<BookRequest> {
    return this.requests.arrive(ctx, parseId(id));
  }

  /** FR-REQ-14: a copy lost on the road; the library's loss. */
  @Post(':id/lost')
  @HttpCode(200)
  @Roles('super_admin')
  lost(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.requests.markLost(ctx, parseId(id), parseBody(markLostRequestSchema, body).reason);
  }
}

/** FR-REQ-01, FR-REQ-11: the member asks, sees their requests, and may cancel. */
@Controller('me/requests')
@Roles('member')
export class OwnRequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  mine(@Auth() ctx: AuthContext): Promise<BookRequest[]> {
    return this.requests.mine(ctx);
  }

  @Post()
  create(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<BookRequest> {
    return this.requests.create(ctx, parseBody(createBookRequestSchema, body));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<BookRequest> {
    return this.requests.cancel(ctx, parseId(id));
  }
}
