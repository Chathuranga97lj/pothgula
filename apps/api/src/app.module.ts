import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { CirculationModule } from './circulation/circulation.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ImportModule } from './import/import.module';
import { ErrorFilter } from './common/error.filter';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { ImagesController } from './images/images.controller';
import { JobsModule } from './jobs/jobs.module';
import { LogModule } from './log/log.module';
import { MembersModule } from './members/members.module';
import { ReportsModule } from './reports/reports.module';
import { RequestsModule } from './requests/requests.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { SettlementsModule } from './settlements/settlements.module';
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
    ImportModule,
    LogModule,
    ReportsModule,
    RequestsModule,
    SettlementsModule,
    ReceiptsModule,
  ],
  controllers: [HealthController, ImagesController],
  providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
})
export class AppModule {}
