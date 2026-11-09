import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  correctLoanRequestSchema,
  type IssueCheck,
  issueRequestSchema,
  type Loan,
  type MemberLoans,
  returnRequestSchema,
  voidLoanRequestSchema,
} from '@pothgula/shared';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { parseBody, parseId } from '../common/validate';
import { CirculationService } from './circulation.service';

/** §7: the counter. Staff only; branch scope is checked in the service. */
@Controller('loans')
@Roles('admin', 'super_admin')
export class LoansController {
  constructor(private readonly circulation: CirculationService) {}

  /** FR-CIR-02: whether this copy can go to this member, and why not. Writes nothing. */
  @Post('check')
  @HttpCode(200)
  check(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<IssueCheck> {
    return this.circulation.check(ctx, parseBody(issueRequestSchema, body));
  }

  /** FR-CIR-01, FR-CIR-14. */
  @Post()
  issue(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<Loan> {
    return this.circulation.issue(ctx, parseBody(issueRequestSchema, body));
  }

  /** FR-CIR-04: the open loan on a copy, with its days late, before taking it back. */
  @Get('open')
  open(@Auth() ctx: AuthContext, @Query('accession') accession?: string): Promise<Loan> {
    if (!accession) throw AppError.badRequest('invalid_request', 'accession is required');
    return this.circulation.openLoanByAccession(ctx, accession);
  }

  @Get(':id')
  detail(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Loan> {
    return this.circulation.detail(ctx, parseId(id));
  }

  /** FR-CIR-03, FR-CIR-08, FR-CIR-14. */
  @Post(':id/return')
  @HttpCode(200)
  takeBack(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.circulation.takeBack(ctx, parseId(id), parseBody(returnRequestSchema, body ?? {}));
  }

  /** FR-CIR-05: corrections keep the old values in the log. */
  @Patch(':id')
  correct(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.circulation.correct(ctx, parseId(id), parseBody(correctLoanRequestSchema, body));
  }

  /** FR-CIR-05: only a super admin voids a loan entered by mistake. */
  @Post(':id/void')
  @HttpCode(200)
  @Roles('super_admin')
  void(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.circulation.void(ctx, parseId(id), parseBody(voidLoanRequestSchema, body).reason);
  }
}

/** FR-CIR-09, FR-CIR-15: a member's borrowing history, for staff. */
@Controller('members')
export class MemberLoansController {
  constructor(private readonly circulation: CirculationService) {}

  @Get(':id/loans')
  @Roles('admin', 'super_admin')
  loans(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<MemberLoans> {
    return this.circulation.memberLoans(ctx, parseId(id));
  }
}

/** FR-CIR-04: the member's own books and late returns. */
@Controller('me')
export class OwnLoansController {
  constructor(private readonly circulation: CirculationService) {}

  @Get('loans')
  @Roles('member')
  loans(@Auth() ctx: AuthContext): Promise<MemberLoans> {
    return this.circulation.ownLoans(ctx);
  }
}
