import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PdfModule } from '../pdf/pdf.module';
import { MemberExportService } from './member-export';
import { ApplicationsController, MeController, MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [AuthModule, PdfModule],
  controllers: [ApplicationsController, MembersController, MeController],
  providers: [MembersService, MemberExportService],
  exports: [MembersService],
})
export class MembersModule {}
