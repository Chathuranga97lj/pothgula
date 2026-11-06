import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BranchesController } from './branches/branches.controller';
import { ErrorFilter } from './common/error.filter';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { StaffModule } from './staff/staff.module';

@Module({
  imports: [DbModule, AuditModule, AuthModule, StaffModule],
  controllers: [HealthController, BranchesController],
  providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
})
export class AppModule {}
