import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { LogController } from './log.controller';
import { LogService } from './log.service';

@Module({
  imports: [PdfModule],
  controllers: [LogController],
  providers: [LogService],
})
export class LogModule {}
