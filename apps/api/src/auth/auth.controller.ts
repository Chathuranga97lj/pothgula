import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  changePasswordRequestSchema,
  type MeResponse,
  type SignInResponse,
  signInRequestSchema,
} from '@pothgula/shared';
import type { Request } from 'express';
import { parseBody } from '../common/validate';
import { AllowWhileMustChange, Auth, type AuthContext, clientMeta, Public } from './auth-context';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('sign-in')
  @Public()
  @HttpCode(200)
  signIn(@Body() body: unknown, @Req() req: Request): Promise<SignInResponse> {
    return this.auth.signIn(parseBody(signInRequestSchema, body), clientMeta(req));
  }

  @Post('sign-out')
  @AllowWhileMustChange()
  @HttpCode(204)
  async signOut(@Auth() ctx: AuthContext): Promise<void> {
    await this.auth.signOut(ctx);
  }

  @Get('me')
  @AllowWhileMustChange()
  me(@Auth() ctx: AuthContext): Promise<MeResponse> {
    return this.auth.me(ctx);
  }

  @Post('change-password')
  @AllowWhileMustChange()
  @HttpCode(204)
  async changePassword(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<void> {
    await this.auth.changePassword(ctx, parseBody(changePasswordRequestSchema, body));
  }
}
