import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [SessionService, AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [SessionService, AuthService],
})
export class AuthModule {}
