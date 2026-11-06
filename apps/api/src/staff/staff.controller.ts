import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  createStaffRequestSchema,
  deactivateRequestSchema,
  type StaffMember,
  type TemporaryPasswordResponse,
} from '@pothgula/shared';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { AuthService } from '../auth/auth.service';
import { parseBody, parseId } from '../common/validate';
import { StaffService } from './staff.service';

@Controller()
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly auth: AuthService,
  ) {}

  @Get('staff')
  @Roles('admin', 'super_admin')
  list(@Auth() ctx: AuthContext): Promise<StaffMember[]> {
    return this.staff.list(ctx);
  }

  @Post('staff')
  @Roles('super_admin')
  create(@Auth() ctx: AuthContext, @Body() body: unknown) {
    return this.staff.create(ctx, parseBody(createStaffRequestSchema, body));
  }

  /** FR-AUT-11, FR-AUT-12. Members' passwords are reset here too. */
  @Post('users/:id/reset-password')
  @HttpCode(200)
  @Roles('admin', 'super_admin')
  async resetPassword(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
  ): Promise<TemporaryPasswordResponse> {
    const userId = parseId(id);
    const temporaryPassword = await this.auth.resetPassword(ctx, userId);
    return { userId, temporaryPassword };
  }

  @Post('users/:id/deactivate')
  @HttpCode(204)
  @Roles('super_admin')
  async deactivate(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    await this.staff.deactivate(ctx, parseId(id), parseBody(deactivateRequestSchema, body).reason);
  }

  @Post('users/:id/reactivate')
  @HttpCode(204)
  @Roles('super_admin')
  async reactivate(@Auth() ctx: AuthContext, @Param('id') id: string) {
    await this.staff.reactivate(ctx, parseId(id));
  }
}
