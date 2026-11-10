import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { RequestsModule } from '../requests/requests.module';
import { SettlementsModule } from '../settlements/settlements.module';
import { MemberDashboardController, StaffDashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [PdfModule, RequestsModule, SettlementsModule],
  controllers: [StaffDashboardController, MemberDashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
