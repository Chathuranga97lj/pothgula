import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { declineExtensionRequestSchema, type Loan } from '@pothgula/shared';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { parseBody, parseId } from '../common/validate';
import { optionalBranchId } from '../dashboard/dashboard.service';
import { ExtensionsService } from './extensions.service';

/** FR-CIR-10 to FR-CIR-13, staff side. Branch scope is checked in the service. */
@Controller()
@Roles('admin', 'super_admin')
export class StaffExtensionsController {
  constructor(private readonly extensions: ExtensionsService) {}

  /** FR-CIR-12: requests waiting for a decision, the soonest due first. */
  @Get('extensions')
  waiting(@Auth() ctx: AuthContext, @Query('branchId') branchId?: string): Promise<Loan[]> {
    return this.extensions.waiting(ctx, optionalBranchId(branchId));
  }

  /** FR-CIR-11: granted directly, for a member who asks in person or by telephone. */
  @Post('loans/:id/extension')
  @HttpCode(200)
  grant(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Loan> {
    return this.extensions.grant(ctx, parseId(id));
  }

  @Post('loans/:id/extension/approve')
  @HttpCode(200)
  approve(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Loan> {
    return this.extensions.approve(ctx, parseId(id));
  }

  @Post('loans/:id/extension/decline')
  @HttpCode(200)
  decline(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown): Promise<Loan> {
    const { reason } = parseBody(declineExtensionRequestSchema, body);
    return this.extensions.decline(ctx, parseId(id), reason);
  }
}

/** FR-CIR-10: the member asks from their dashboard, and may withdraw the request. */
@Controller('me/loans')
@Roles('member')
export class OwnExtensionsController {
  constructor(private readonly extensions: ExtensionsService) {}

  @Post(':id/extension')
  @HttpCode(200)
  request(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Loan> {
    return this.extensions.request(ctx, parseId(id));
  }

  @Post(':id/extension/cancel')
  @HttpCode(200)
  cancel(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Loan> {
    return this.extensions.cancel(ctx, parseId(id));
  }
}
