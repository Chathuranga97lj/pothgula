import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
} from '@nestjs/common';
import { type Notice, type NoticeBoard, noticeInputSchema } from '@pothgula/shared';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { AppError } from '../common/app-error';
import { parseBody, parseId } from '../common/validate';
import { optionalBranchId } from '../dashboard/dashboard.service';
import { ImageUpload } from '../images/upload';
import { NoticesService } from './notices.service';

/** §12: notices and events. Everyone signed in reads; staff publish (scope in the service). */
@Controller('notices')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  /** FR-PUB-04: a branch's notices and events as its members see them; the caller's own by default. */
  @Get()
  board(@Auth() ctx: AuthContext, @Query('branchId') branchId?: string): Promise<NoticeBoard> {
    const id = optionalBranchId(branchId) ?? ctx.user.branchId;
    if (id === null) {
      throw AppError.badRequest('branch_required', 'Choose the branch whose notices to show.');
    }
    return this.notices.board(ctx, id);
  }

  /** Every notice the staff member can see, whatever its state. */
  @Get('manage')
  @Roles('admin', 'super_admin')
  manage(@Auth() ctx: AuthContext, @Query('branchId') branchId?: string): Promise<Notice[]> {
    return this.notices.manage(ctx, optionalBranchId(branchId));
  }

  @Get(':id')
  detail(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Notice> {
    return this.notices.detail(ctx, parseId(id));
  }

  @Post()
  @Roles('admin', 'super_admin')
  create(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<Notice> {
    return this.notices.create(ctx, parseBody(noticeInputSchema, body));
  }

  /** FR-PUB-06: an edit sends the whole notice again. */
  @Patch(':id')
  @Roles('admin', 'super_admin')
  update(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Notice> {
    return this.notices.update(ctx, parseId(id), parseBody(noticeInputSchema, body));
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @Roles('admin', 'super_admin')
  withdraw(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Notice> {
    return this.notices.setWithdrawn(ctx, parseId(id), true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Roles('admin', 'super_admin')
  restore(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Notice> {
    return this.notices.setWithdrawn(ctx, parseId(id), false);
  }

  /** FR-PUB-05: the picture, uploaded as a file. */
  @Post(':id/image')
  @HttpCode(200)
  @Roles('admin', 'super_admin')
  @ImageUpload()
  setImage(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<Notice> {
    return this.notices.setImage(ctx, parseId(id), file?.buffer ?? Buffer.alloc(0));
  }

  @Post(':id/image/remove')
  @HttpCode(200)
  @Roles('admin', 'super_admin')
  removeImage(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<Notice> {
    return this.notices.setImage(ctx, parseId(id), null);
  }
}
