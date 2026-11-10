import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { PdfModule } from '../pdf/pdf.module';
import { OwnRequestsController, RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [MembersModule, PdfModule],
  controllers: [RequestsController, OwnRequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
