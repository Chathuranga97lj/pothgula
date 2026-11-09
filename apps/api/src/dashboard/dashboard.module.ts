import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { MemberDashboardController, StaffDashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [PdfModule],
  controllers: [StaffDashboardController, MemberDashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
