import { Body, Controller, Get, HttpCode, Param, Patch, Post, UploadedFile } from '@nestjs/common';
import {
  type BranchDetail,
  type BranchSummary,
  createBranchRequestSchema,
  updateBranchRequestSchema,
  updateBranchSettingsRequestSchema,
} from '@pothgula/shared';
import { Auth, type AuthContext, Roles } from '../auth/auth-context';
import { parseBody, parseId } from '../common/validate';
import { ImageUpload } from '../images/upload';
import { BranchesService } from './branches.service';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  /** Every signed-in person: members choose and view branches too. */
  @Get()
  list(): Promise<BranchSummary[]> {
    return this.branches.list();
  }

  @Get(':id')
  @Roles('admin', 'super_admin')
  detail(@Param('id') id: string): Promise<BranchDetail> {
    return this.branches.detail(parseId(id));
  }

  @Post()
  @Roles('super_admin')
  create(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<BranchDetail> {
    return this.branches.create(ctx, parseBody(createBranchRequestSchema, body));
  }

  @Patch(':id')
  @Roles('super_admin')
  update(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<BranchDetail> {
    return this.branches.update(ctx, parseId(id), parseBody(updateBranchRequestSchema, body));
  }

  @Post(':id/logo')
  @HttpCode(200)
  @Roles('super_admin')
  @ImageUpload()
  setLogo(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<BranchDetail> {
    return this.branches.setLogo(ctx, parseId(id), file?.buffer ?? Buffer.alloc(0));
  }

  @Patch(':id/settings')
  @Roles('super_admin')
  updateSettings(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<BranchDetail> {
    return this.branches.updateSettings(
      ctx,
      parseId(id),
      parseBody(updateBranchSettingsRequestSchema, body),
    );
  }
}
