import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  applicationRequestSchema,
  approveRequestSchema,
  type MemberDetail,
  type MembershipOverview,
  type MemberSummary,
  registerMemberRequestSchema,
  rejectRequestSchema,
  renewRequestSchema,
  updateApplicationRequestSchema,
  updateProfileRequestSchema,
} from '@pothgula/shared';
import type { Request } from 'express';
import { Auth, type AuthContext, clientMeta, Public, Roles } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { parseBody, parseId } from '../common/validate';
import { MembersService } from './members.service';

/** FR-AUT-03, FR-AUT-17 – FR-AUT-18: applying, and deciding applications. */
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly members: MembersService) {}

  /** Public: anyone may apply. The account starts pending. */
  @Post()
  @Public()
  apply(@Body() body: unknown, @Req() req: Request): Promise<{ userId: number }> {
    return this.members.apply(parseBody(applicationRequestSchema, body), clientMeta(req).ipAddress);
  }

  @Get()
  @Roles('admin', 'super_admin')
  list(@Auth() ctx: AuthContext, @Query('status') status?: string): Promise<MemberSummary[]> {
    if (status !== undefined && status !== 'pending' && status !== 'rejected') {
      throw AppError.badRequest('invalid_request', 'status must be pending or rejected');
    }
    return this.members.applications(ctx, status ?? 'pending');
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('admin', 'super_admin')
  approve(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.members.approve(ctx, parseId(id), parseBody(approveRequestSchema, body));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('admin', 'super_admin')
  reject(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.members.reject(ctx, parseId(id), parseBody(rejectRequestSchema, body).reason);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @Roles('admin', 'super_admin')
  reopen(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<MemberDetail> {
    return this.members.reopen(ctx, parseId(id));
  }
}

/** FR-AUT-05, FR-MEM-02, FR-MEM-03, FR-MEM-09: members, for staff. */
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @Roles('admin', 'super_admin')
  search(@Auth() ctx: AuthContext, @Query('q') q?: string): Promise<MemberSummary[]> {
    return this.members.search(ctx, q ?? '');
  }

  /** Registering a member at the counter. */
  @Post()
  @Roles('admin', 'super_admin')
  register(@Auth() ctx: AuthContext, @Body() body: unknown) {
    return this.members.register(ctx, parseBody(registerMemberRequestSchema, body));
  }

  @Get('overview')
  @Roles('admin', 'super_admin')
  overview(@Auth() ctx: AuthContext): Promise<MembershipOverview> {
    return this.members.overview(ctx);
  }

  @Get(':id')
  @Roles('admin', 'super_admin')
  detail(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<MemberDetail> {
    return this.members.detail(ctx, parseId(id));
  }

  @Post(':id/renew')
  @HttpCode(200)
  @Roles('admin', 'super_admin')
  renew(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    return this.members.renew(ctx, parseId(id), parseBody(renewRequestSchema, body));
  }
}

/** FR-AUT-21, FR-MEM-09: the applicant or member themselves. */
@Controller('me')
export class MeController {
  constructor(private readonly members: MembersService) {}

  @Get('membership')
  own(@Auth() ctx: AuthContext): Promise<MemberDetail> {
    return this.members.ownRecord(ctx);
  }

  @Patch('application')
  updateApplication(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<MemberDetail> {
    return this.members.updateOwnApplication(ctx, parseBody(updateApplicationRequestSchema, body));
  }

  @Patch('profile')
  updateProfile(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<MemberDetail> {
    return this.members.updateOwnProfile(ctx, parseBody(updateProfileRequestSchema, body));
  }
}
