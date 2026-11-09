import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { CirculationModule } from './circulation/circulation.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ErrorFilter } from './common/error.filter';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { ImagesController } from './images/images.controller';
import { JobsModule } from './jobs/jobs.module';
import { MembersModule } from './members/members.module';
import { StaffModule } from './staff/staff.module';

@Module({
  imports: [
    DbModule,
    AuditModule,
    AuthModule,
    StaffModule,
    BranchesModule,
    MembersModule,
    JobsModule,
    CatalogueModule,
    CirculationModule,
    DashboardModule,
  ],
  controllers: [HealthController, ImagesController],
  providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
})
export class AppModule {}
